process.env.NODE_ENV = 'test';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTestSql } from '../src/lib/db.js';
import { setTestUsers } from '../src/lib/directory.js';
import { setHoldsRepository } from '../src/services/holds-repository.js';
import { setPolicyLoader, resetPolicyCache, loadPolicy } from '../src/services/policy.js';
import { createFakeSql, createTestHoldsRepository, fakeUuid, otherUuid, thirdUuid } from './fake-sql.mjs';

const { default: app } = await import('../src/app.js');
const { handler } = await import('../src/handler.js');
const { handleEvent } = await import('../src/events/consumer.js');
const { handleAuditEvent } = await import('../src/events/audit-consumer.js');
const { projection } = await import('../src/services/projection.js');
const { runAccrual } = await import('../src/services/accrual.js');
const { runCasualGrant, runYearEnd } = await import('../src/services/yearly.js');
const { pendingByEmployee, createHold } = await import('../src/services/holds-repository.js');

let server; let base;
const seed = () => ({
  ledger_entries: [
      { employee_id: fakeUuid(), leave_type: 'Annual', kind: 'Adjustment', amount: '10.00', reason: 'Opening balance 2026 (demo seed)', created_by: 'system:seed', created_by_name: null, created_at: '2026-01-01T00:00:00Z' },
      { employee_id: fakeUuid(), leave_type: 'Casual', kind: 'Adjustment', amount: '3.00', reason: 'Opening balance 2026 (demo seed)', created_by: 'system:seed', created_by_name: null, created_at: '2026-01-01T00:00:00Z' },
      { employee_id: otherUuid(), leave_type: 'Annual', kind: 'Adjustment', amount: '5.00', reason: 'Opening balance 2026 (demo seed)', created_by: 'system:seed', created_by_name: null, created_at: '2026-01-01T00:00:00Z' },
  ],
});
beforeEach(async () => {
  const sql = createFakeSql(seed());
  setTestSql(sql);
  setHoldsRepository(createTestHoldsRepository(sql));
  resetPolicyCache();
  setPolicyLoader(async (path) => {
    if (path === '/leaveflow/balances/annual-monthly-accrual') return '1.75';
    if (path === '/leaveflow/balances/carryover-cap') return '5';
    if (path === '/leaveflow/balances/casual-yearly') return '6';
    return undefined;
  });
  setTestUsers(async () => [
    { id: fakeUuid(), name: 'Nour', dept: 'Sales', role: 'Employee', joinDate: '2023-03-12' },
    { id: otherUuid(), name: 'Omar', dept: 'Sales', role: 'Employee', joinDate: '2024-01-15' },
    { id: thirdUuid(), name: 'Mona', dept: 'HR', role: 'HRAdmin', joinDate: '2015-01-04' },
  ]);
  globalThis.__sql = sql;
  if (!server) {
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  }
});

const employee = { id: fakeUuid(), name: 'Nour', email: 'nour@leaveflow.test', groups: ['Employee'], role: 'Employee', dept: 'Sales' };
const otherEmployee = { id: otherUuid(), name: 'Omar', email: 'omar@leaveflow.test', groups: ['Employee'], role: 'Employee', dept: 'Sales' };
const hr = { id: thirdUuid(), name: 'Mona', email: 'mona@leaveflow.test', groups: ['HRAdmin'], role: 'HRAdmin', dept: 'HR' };

async function call(method, path, { user, body } = {}) {
  const headers = {};
  if (user) headers['x-test-user'] = JSON.stringify(user);
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let seq = 0;
const uid = (n) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const detail = (over = {}) => ({
  eventId: uid(++seq), requestId: uid(++seq), employeeId: fakeUuid(), employeeName: 'Nour',
  department: 'Sales', leaveType: 'Annual', startDate: '2026-12-14', endDate: '2026-12-17',
  workingDays: 4, ...over,
});
const auditDetail = (over = {}) => ({
  eventId: uid(++seq), actor: 'Mona Fathy', action: 'REQUEST_APPROVED', requestId: uid(++seq),
  service: 'approval-service', at: new Date().toISOString(), ...over,
});
function apiEvent(method, path, body, user = employee) {
  return {
    version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: '',
    headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) },
    requestContext: { http: { method, path, protocol: 'HTTP/1.1' }, stage: '$default' },
    isBase64Encoded: false, body: body === undefined ? null : JSON.stringify(body),
  };
}
const sqs = (arn, envelope) => ({ Records: [{ eventSource: 'aws:sqs', eventSourceARN: `arn:aws:sqs:us-east-1:1:${arn}`, body: JSON.stringify(envelope) }] });

test('1. Employee retrieves own balance from balances view', async () => {
  const r = await call('GET', '/balances/me', { user: employee });
  assert.equal(r.status, 200);
  assert.equal(r.body.Annual.available, 10);
  assert.equal(r.body.Casual.available, 3);
  assert.equal(r.body.Annual.yearly, 21);
  assert.equal(r.body.Sick.taken, 0);
});

test('2. Employee cannot list other balances (HR only)', async () => {
  assert.equal((await call('GET', '/balances', { user: employee })).status, 403);
  assert.equal((await call('GET', '/balances', { user: otherEmployee })).status, 403);
  assert.equal((await call('GET', '/balances', { user: hr })).status, 200);
});

test('3. Employee cannot perform HR adjustment', async () => {
  const r = await call('POST', `/balances/${fakeUuid()}/adjustments`, { user: employee, body: { type: 'Annual', amount: 2, reason: 'Sneaky raise' } });
  assert.equal(r.status, 403);
  assert.equal(globalThis.__sql.__db.ledger_entries.length, 3);
});

test('4. HR valid adjustment -> 201 and balance increases', async () => {
  const r = await call('POST', `/balances/${fakeUuid()}/adjustments`, { user: hr, body: { type: 'Annual', amount: 2, reason: 'Payroll correction' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(globalThis.__sql.__db.ledger_entries.length, 4);
  assert.equal((await call('GET', '/balances/me', { user: employee })).body.Annual.available, 12);
  assert.equal(globalThis.__sql.__db.audit_log.length, 1);
});

test('5. Invalid adjustment amounts and reasons -> 400', async () => {
  for (const amount of [0, 11, -11, 'abc', null]) {
    const r = await call('POST', `/balances/${fakeUuid()}/adjustments`, { user: hr, body: { type: 'Annual', amount, reason: 'Valid reason here' } });
    assert.equal(r.status, 400, `amount ${amount}`);
  }
  assert.equal((await call('POST', `/balances/${fakeUuid()}/adjustments`, { user: hr, body: { type: 'Annual', amount: 1, reason: 'x' } })).body.error.code, 'REASON_REQUIRED');
  assert.equal((await call('POST', `/balances/${fakeUuid()}/adjustments`, { user: hr, body: { type: 'Sick', amount: 1, reason: 'Long enough' } })).body.error.code, 'BAD_TYPE');
});

test('6. Accrual idempotency: second run for same period/kind -> 409', async () => {
  const directory = async () => [{ id: fakeUuid(), joinDate: '2020-01-01' }, { id: otherUuid(), joinDate: '2026-11-16' }];
  const first = await runAccrual({ month: '2026-11', actor: hr, directory });
  assert.equal(first.status, 'Done');
  assert.equal(Number(first.total_days), 1.75);
  await assert.rejects(() => runAccrual({ month: '2026-11', actor: hr, directory }), (e) => e.status === 409 && e.code === 'ALREADY_RAN');
  assert.equal(globalThis.__sql.__db.accrual_runs.length, 1);
});

test('7. Approved request -> Deduction and hold released', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  const pending = await call('GET', '/balances/me', { user: employee });
  assert.equal(pending.body.Annual.pending, 4);
  assert.equal(pending.body.Annual.projected, 6);
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: detail({ eventId: uid(++seq), requestId: d.requestId }) });
  const after = await call('GET', '/balances/me', { user: employee });
  assert.equal(after.body.Annual.available, 6);
  assert.equal(after.body.Annual.pending, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction').length, 1);
});

test('8. Rejected request releases hold without deduction', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.rejected', detail: detail({ eventId: uid(++seq), requestId: d.requestId }) });
  assert.equal(globalThis.__sql.__db.pending_holds.length, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction').length, 0);
});

test('9. Cancellation after approval -> Refund', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d });
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled', detail: detail({ eventId: uid(++seq), requestId: d.requestId, previousStatus: 'Approved' }) });
  assert.equal((await call('GET', '/balances/me', { user: employee })).body.Annual.available, 10);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund').length, 1);
});

test('10. Duplicate event -> no duplicate ledger/audit entries or claims', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d });
  const again = await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d });
  assert.equal(again.duplicate, true);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction').length, 1);
  assert.equal(globalThis.__sql.__db.processed_events.length, 1);
});

test('11. Untrusted event source rejected', async () => {
  const r = await handleEvent({ source: 'leaveflow.evil', 'detail-type': 'request.approved', detail: detail() });
  assert.equal(r.ok, false);
  assert.equal(globalThis.__sql.__db.processed_events.length, 0);
});

test('12. Unauthenticated -> 401 on protected endpoints', async () => {
  for (const [m, p] of [['GET', '/balances/me'], ['GET', '/balances/me/ledger'], ['GET', '/balances'], ['GET', '/accrual-runs'], ['POST', '/accrual-runs']]) {
    assert.equal((await call(m, p)).status, 401, `${m} ${p}`);
  }
});

test('12b. CORS echoes only allow-listed origins', async () => {
  const pre = (origin) => fetch(base + '/balances/me', { method: 'OPTIONS', headers: { Origin: origin } });
  const ok = await pre('http://localhost:8080');
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:8080');
  const evil = await pre('https://evil.example');
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example');
  assert.equal(evil.headers.get('vary'), 'Origin');
});

test('13. Ledger newest first with running balance', async () => {
  await call('POST', `/balances/${fakeUuid()}/adjustments`, { user: hr, body: { type: 'Annual', amount: 2, reason: 'First correction' } });
  await call('POST', `/balances/${fakeUuid()}/adjustments`, { user: hr, body: { type: 'Annual', amount: -1, reason: 'Second correction' } });
  const r = await call('GET', '/balances/me/ledger', { user: employee });
  assert.equal(r.status, 200);
  assert.equal(r.body[0].balanceAfter, 11);
  assert.equal(r.body[1].balanceAfter, 12);
});

test('A1. Lambda handler parses POST JSON body', async () => {
  const res = await handler(apiEvent('POST', `/balances/${fakeUuid()}/adjustments`, { type: 'Annual', amount: 2, reason: 'Lambda body test' }, hr));
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(JSON.parse(res.body).amount, 2);
});

test('A2. Malformed JSON -> 400 INVALID_JSON', async () => {
  const ev = apiEvent('POST', `/balances/${fakeUuid()}/adjustments`, {});
  ev.body = '{bad json';
  const res = await handler(ev);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'INVALID_JSON');
});

test('A3. Projection valid input returns {available:number}', async () => {
  const r = await projection({ employeeId: fakeUuid(), leaveType: 'Annual' });
  assert.deepEqual(Object.keys(r), ['available']);
  assert.equal(typeof r.available, 'number');
  assert.equal(r.available, 10);
  assert.equal((await projection({ employeeId: fakeUuid(), leaveType: 'Casual' })).available, 3);
});

test('A4. Confirmed contract: available = balance - existing pending holds; new request not double-subtracted', async () => {
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: detail() });
  const b = (await call('GET', '/balances/me', { user: employee })).body;
  assert.equal(b.Annual.balance, 10);
  assert.equal(b.Annual.pending, 4);
  assert.equal(b.Annual.available, 6);
  assert.equal(b.Annual.projected, 6);
  assert.equal((await projection({ employeeId: fakeUuid(), leaveType: 'Annual' })).available, 6);
});

test('A5. Projection with no holds returns full balance', async () => {
  assert.equal((await projection({ employeeId: fakeUuid(), leaveType: 'Annual' })).available, 10);
  assert.equal((await call('GET', '/balances/me', { user: employee })).body.Annual.pending, 0);
});

test('A6. Projection invalid input fails closed (no fabricated 0)', async () => {
  for (const input of [{}, { employeeId: 'x', leaveType: 'Sick' }, { employeeId: '', leaveType: 'Annual' }, { employeeId: fakeUuid(), leaveType: 'Bogus' }]) {
    await assert.rejects(() => projection(input), (e) => e.status === 400 && e.code === 'BAD_INPUT');
  }
});

test('A6b. Projection invalid policy -> 500 POLICY_UNAVAILABLE (caller maps to 503)', async () => {
  setPolicyLoader(async () => undefined);
  resetPolicyCache();
  await assert.rejects(() => projection({ employeeId: fakeUuid(), leaveType: 'Annual' }), (e) => e.status === 500 && e.code === 'POLICY_MISSING');
  resetPolicyCache();
  setPolicyLoader(async (path) => path === '/leaveflow/balances/annual-monthly-accrual' ? '1.75' : path === '/leaveflow/balances/carryover-cap' ? '5' : '9');
});

test('A7. Projection DB failure propagates', async () => {
  const real = globalThis.__sql;
  const throwing = (strings, ...params) => { throw new Error('db down'); };
  throwing.transaction = async () => { throw new Error('db down'); };
  setTestSql(throwing);
  await assert.rejects(() => projection({ employeeId: fakeUuid(), leaveType: 'Annual' }), /db down/);
  setTestSql(real);
});

test('A8. Hold idempotency uses request_id PK', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  assert.equal(globalThis.__sql.__db.pending_holds.length, 1);
  assert.equal(globalThis.__sql.__db.pending_holds[0].days, 4);
});

test('A9. pendingByEmployee groups by leave type', async () => {
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: detail({ leaveType: 'Annual', workingDays: 2 }) });
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: detail({ leaveType: 'Casual', workingDays: 1 }) });
  const p = await pendingByEmployee(fakeUuid());
  assert.equal(p.Annual, 2);
  assert.equal(p.Casual, 1);
});

test('A10. Failed event NOT acknowledged; SQS retry succeeds', async () => {
  const real = globalThis.__sql;
  const d = detail();
  let fail = true;
  const wrapped = (...args) => {
    const s = args[0]?.join ? args[0].join(' ') : '';
    if (fail && String(s).includes('INSERT INTO audit_log')) { fail = false; throw new Error('temporary db error'); }
    return real(...args);
  };
  wrapped.transaction = real.transaction; wrapped.__db = real.__db;
  setTestSql(wrapped);
  await assert.rejects(() => handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d }), /temporary db error/);
  assert.equal(globalThis.__sql.__db.processed_events.length, 0);
  setTestSql(real);
  const retry = await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d });
  assert.equal(retry.ok, true);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction').length, 1);
});

test('A11. No DELETE privilege on processed_events is required by consumers', async () => {
  const real = globalThis.__sql;
  let deleteAttempted = false;
  const wrapped = (...args) => {
    const s = args[0]?.join ? args[0].join(' ') : '';
    if (String(s).includes('DELETE FROM processed_events')) { deleteAttempted = true; throw new Error('permission denied'); }
    return real(...args);
  };
  wrapped.transaction = real.transaction; wrapped.__db = real.__db;
  setTestSql(wrapped);
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: detail() });
  assert.equal(deleteAttempted, false);
  setTestSql(real);
});

test('A12. balances-inbox via Lambda routes by ARN', async () => {
  const r = await handler(sqs('balances-inbox', { source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: detail() }));
  assert.equal(r.balances.ok, 1);
  assert.equal(globalThis.__sql.__db.pending_holds.length, 1);
});

test('A13. Duplicate SQS delivery acknowledged once', async () => {
  const d = detail();
  const env = { source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d };
  await handler(sqs('balances-inbox', env));
  const second = await handler(sqs('balances-inbox', env));
  assert.equal(second.balances.ok, 1);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction').length, 1);
});

test('A14. Audit event writes real audit_log fields', async () => {
  const d = auditDetail();
  const r = await handleAuditEvent({ source: 'leaveflow.approvals', 'detail-type': 'audit', detail: d });
  assert.equal(r.ok, true);
  const row = globalThis.__sql.__db.audit_log[0];
  assert.equal(row.event_id, d.eventId);
  assert.equal(row.service, 'approval-service');
  assert.equal(row.actor, 'Mona Fathy');
  assert.equal(row.action, 'REQUEST_APPROVED');
});

test('A15. Audit via Lambda routes to audit queue and never affects balances', async () => {
  const r = await handler(sqs('audit-inbox', { source: 'leaveflow.requests', 'detail-type': 'audit', detail: auditDetail() }));
  assert.equal(r.audit.ok, 1);
  assert.equal(globalThis.__sql.__db.audit_log.length, 1);
  assert.equal(globalThis.__sql.__db.ledger_entries.length, 3);
});

test('A16. Audit duplicate deduplicated', async () => {
  const d = auditDetail();
  await handleAuditEvent({ source: 'leaveflow.requests', 'detail-type': 'audit', detail: d });
  assert.equal((await handleAuditEvent({ source: 'leaveflow.requests', 'detail-type': 'audit', detail: d })).duplicate, true);
  assert.equal(globalThis.__sql.__db.audit_log.length, 1);
});

test('A17. Audit invalid source/service rejected', async () => {
  assert.equal((await handleAuditEvent({ source: 'leaveflow.evil', 'detail-type': 'audit', detail: auditDetail() })).ok, false);
  assert.equal((await handleAuditEvent({ source: 'leaveflow.requests', 'detail-type': 'audit', detail: auditDetail({ service: 'evil-service' }) })).ok, false);
  assert.equal(globalThis.__sql.__db.audit_log.length, 0);
});

test('A18. Audit failure not acknowledged', async () => {
  const real = globalThis.__sql;
  const d = auditDetail();
  let fail = true;
  const wrapped = (...args) => {
    const s = args[0]?.join ? args[0].join(' ') : '';
    if (fail && String(s).includes('INSERT INTO audit_log')) { fail = false; throw new Error('audit db error'); }
    return real(...args);
  };
  wrapped.transaction = real.transaction; wrapped.__db = real.__db;
  setTestSql(wrapped);
  await assert.rejects(() => handleAuditEvent({ source: 'leaveflow.requests', 'detail-type': 'audit', detail: d }), /audit db error/);
  assert.equal(globalThis.__sql.__db.processed_events.length, 0);
  setTestSql(real);
  assert.equal((await handleAuditEvent({ source: 'leaveflow.requests', 'detail-type': 'audit', detail: d })).ok, true);
});

test('B1. Sick and Unpaid events create no holds, deductions, refunds or zero ledger rows', async () => {
  for (const leaveType of ['Sick', 'Unpaid']) {
    const d = detail({ leaveType });
    await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
    await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: detail({ eventId: uid(++seq), requestId: d.requestId, leaveType }) });
    await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled', detail: detail({ eventId: uid(++seq), requestId: d.requestId, leaveType, previousStatus: 'Pending' }) });
  }
  assert.equal(globalThis.__sql.__db.pending_holds.length, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.length, 3);
  assert.equal(globalThis.__sql.__db.ledger_entries.some((e) => e.amount === 0), false);
});

test('B2. Casual approval/refund uses balances; Casual never accrues monthly', async () => {
  const d = detail({ leaveType: 'Casual', workingDays: 1 });
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  assert.equal(globalThis.__sql.__db.pending_holds[0].leave_type, 'Casual');
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: detail({ eventId: uid(++seq), requestId: d.requestId, leaveType: 'Casual', workingDays: 1 }) });
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction' && e.leave_type === 'Casual').length, 1);
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled', detail: detail({ eventId: uid(++seq), requestId: d.requestId, leaveType: 'Casual', workingDays: 1, previousStatus: 'Approved' }) });
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund' && e.leave_type === 'Casual').length, 1);
  const runs = await runAccrual({ month: '2026-11', actor: hr, directory: async () => [{ id: fakeUuid(), joinDate: '2020-01-01' }] });
  assert.equal(runs.status, 'Done');
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual' && e.leave_type === 'Casual').length, 0);
});

test('B3. Full-month eligibility: mid-month joiner is not accrued', async () => {
  const run = await runAccrual({ month: '2026-11', actor: hr, directory: async () => [
    { id: fakeUuid(), joinDate: '2026-11-16' },
    { id: otherUuid(), joinDate: '2026-11-01' },
  ] });
  assert.equal(run.employees_count, 1);
  assert.equal(Number(run.total_days), 1.75);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual').length, 1);
});

test('B4. Concurrent duplicate accrual prevented by UNIQUE(period, kind)', async () => {
  const directory = async () => [{ id: fakeUuid(), joinDate: '2020-01-01' }];
  const [a, b] = await Promise.allSettled([
    runAccrual({ month: '2026-12', actor: hr, directory }),
    runAccrual({ month: '2026-12', actor: hr, directory }),
  ]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected');
  assert.equal(b.reason.code, 'ALREADY_RAN');
  assert.equal(globalThis.__sql.__db.accrual_runs.length, 1);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual').length, 1);
});

test('B5. SSM policy: missing and invalid parameter values fail closed', async () => {
  resetPolicyCache();
  setPolicyLoader(async () => undefined);
  await assert.rejects(() => loadPolicy(), (e) => e.code === 'POLICY_MISSING');
  resetPolicyCache();
  setPolicyLoader(async () => 'not-a-number');
  await assert.rejects(() => loadPolicy(), (e) => e.code === 'POLICY_INVALID');
  resetPolicyCache();
  setPolicyLoader(async (path) => path === '/leaveflow/balances/annual-monthly-accrual' ? '1.75' : path === '/leaveflow/balances/carryover-cap' ? '5' : '9');
  const p = await loadPolicy();
  assert.equal(p.annualMonthlyAccrual, 1.75);
  assert.equal(p.carryoverCap, 5);
  assert.equal(p.casualYearly, 9);
});

test('B6. Casual yearly comes from policy, never hardcoded 6', async () => {
  resetPolicyCache();
  setPolicyLoader(async (path) => path === '/leaveflow/balances/annual-monthly-accrual' ? '1.75' : path === '/leaveflow/balances/carryover-cap' ? '5' : '12.5');
  const b = (await call('GET', '/balances/me', { user: employee })).body;
  assert.equal(b.Casual.yearly, 12.5);
  assert.equal(b.Annual.yearly, 21);
});

test('C1. Pending cancellation releases the hold and creates no Refund or Deduction', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  assert.equal(globalThis.__sql.__db.pending_holds.length, 1);
  const r = await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled',
    detail: detail({ eventId: uid(++seq), requestId: d.requestId, previousStatus: 'Pending' }) });
  assert.equal(r.ok, true);
  assert.equal(globalThis.__sql.__db.pending_holds.length, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund').length, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction').length, 0);
});

test('C2. Pending cancellation does not change the ledger balance', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  const before = (await call('GET', '/balances/me', { user: employee })).body.Annual.balance;
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled',
    detail: detail({ eventId: uid(++seq), requestId: d.requestId, previousStatus: 'Pending' }) });
  const after = (await call('GET', '/balances/me', { user: employee })).body.Annual;
  assert.equal(after.balance, before);
  assert.equal(after.pending, 0);
  assert.equal(after.available, before);
});

test('C3. Approved cancellation creates exactly one Refund for the prior Deduction', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d });
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Deduction').length, 1);
  const r = await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled',
    detail: detail({ eventId: uid(++seq), requestId: d.requestId, previousStatus: 'Approved' }) });
  assert.equal(r.ok, true);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund').length, 1);
  assert.equal((await call('GET', '/balances/me', { user: employee })).body.Annual.available, 10);
});

test('C4. Approved cancellation safely releases a remaining hold', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.submitted', detail: d });
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: detail({ eventId: uid(++seq), requestId: d.requestId }) });
  assert.equal(globalThis.__sql.__db.pending_holds.length, 0);
  await createHold({ requestId: d.requestId, employeeId: d.employeeId, leaveType: 'Annual', workingDays: Number(d.workingDays) });
  assert.equal(globalThis.__sql.__db.pending_holds.length, 1);
  await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled',
    detail: detail({ eventId: uid(++seq), requestId: d.requestId, previousStatus: 'Approved' }) });
  assert.equal(globalThis.__sql.__db.pending_holds.length, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund').length, 1);
});

test('C5. Duplicate Approved cancellation cannot create a second Refund', async () => {
  const d = detail();
  await handleEvent({ source: 'leaveflow.approvals', 'detail-type': 'request.approved', detail: d });
  const cancel = detail({ eventId: uid(++seq), requestId: d.requestId, previousStatus: 'Approved' });
  const first = await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled', detail: cancel });
  const second = await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled', detail: cancel });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund').length, 1);
});

test('C6. Missing previousStatus is rejected with no Refund and no claim', async () => {
  const d = detail();
  const r = await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled',
    detail: detail({ eventId: uid(++seq), requestId: d.requestId }) });
  assert.equal(r.ok, false);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund').length, 0);
  assert.equal(globalThis.__sql.__db.processed_events.length, 0);
});

test('C7. Unsupported previousStatus is rejected with no Refund', async () => {
  const r = await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled',
    detail: detail({ eventId: uid(++seq), requestId: uid(++seq), previousStatus: 'Withdrawn' }) });
  assert.equal(r.ok, false);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Refund').length, 0);
  assert.equal(globalThis.__sql.__db.processed_events.length, 0);
});

test('C8. Sick and Unpaid cancellation still acknowledged and skipped (with valid previousStatus)', async () => {
  for (const leaveType of ['Sick', 'Unpaid']) {
    const r = await handleEvent({ source: 'leaveflow.requests', 'detail-type': 'request.cancelled',
      detail: detail({ eventId: uid(++seq), requestId: uid(++seq), leaveType, previousStatus: 'Approved' }) });
    assert.equal(r.ok, true);
  }
  assert.equal(globalThis.__sql.__db.pending_holds.length, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.length, 3);
});

const yearlyDirectory = () => async () => [
  { id: fakeUuid(), name: 'Nour', joinDate: '2023-03-12' },
  { id: otherUuid(), name: 'Omar', joinDate: '2024-01-15' },
];

test('Y1. Jan 1 Casual grant gives exactly the SSM allowance (6) per eligible employee', async () => {
  const run = await runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() });
  assert.equal(run.status, 'Done');
  assert.equal(run.period, '2026-01-01');
  const rows = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual' && e.leave_type === 'Casual');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((e) => Number(e.amount) === 6));
});

test('Y2. Casual grant uses the Accrual ledger kind with deterministic event ids', async () => {
  await runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() });
  const rows = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual' && e.leave_type === 'Casual');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((e) => e.event_id === `casual-grant:YearEnd:2026:${e.employee_id}`));
});

test('Y3. Monthly Annual accrual never grants Casual', async () => {
  await runAccrual({ month: '2026-11', actor: hr, directory: yearlyDirectory() });
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual' && e.leave_type === 'Casual').length, 0);
});

test('Y4. Re-running the same year Casual grant does not grant twice', async () => {
  await runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() });
  await assert.rejects(() => runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() }), (e) => e.code === 'ALREADY_RAN');
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual' && e.leave_type === 'Casual').length, 2);
  assert.equal(globalThis.__sql.__db.accrual_runs.filter((r) => r.kind === 'YearEnd' && r.period === '2026-01-01').length, 1);
});

test('Y5. Concurrent duplicate Casual grants do not grant twice', async () => {
  const [a, b] = await Promise.allSettled([
    runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() }),
    runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() }),
  ]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.status, 'rejected');
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual' && e.leave_type === 'Casual').length, 2);
});

test('Y6. Missing/invalid Casual SSM value fails closed', async () => {
  resetPolicyCache();
  setPolicyLoader(async () => undefined);
  await assert.rejects(() => runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() }), (e) => e.code === 'POLICY_MISSING');
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Accrual' && e.leave_type === 'Casual').length, 0);
  resetPolicyCache();
  setPolicyLoader(async (path) => path === '/leaveflow/balances/casual-yearly' ? 'bad' : path === '/leaveflow/balances/carryover-cap' ? '5' : '1.75');
  await assert.rejects(() => runCasualGrant({ year: '2026', actor: hr, directory: yearlyDirectory() }), (e) => e.code === 'POLICY_INVALID');
  resetPolicyCache();
  setPolicyLoader(async (path) => path === '/leaveflow/balances/annual-monthly-accrual' ? '1.75' : path === '/leaveflow/balances/carryover-cap' ? '5' : '6');
});

async function seedCasual(amount) {
  globalThis.__sql.__db.ledger_entries.push({
    id: 9900, employee_id: otherUuid(), leave_type: 'Casual', kind: 'Accrual', amount: String(amount),
    request_id: null, event_id: `seed-casual-` + amount, accrual_run_id: null,
    reason: 'Test seed', created_by: 'system', created_by_name: null, created_at: '2026-01-01T00:00:00Z',
  });
}

test('Y7. Dec 31 expiry removes only remaining Casual balance', async () => {
  await seedCasual(4);
  const run = await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  assert.equal(run.status, 'Done');
  const exp = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Expiry' && e.leave_type === 'Casual');
  assert.equal(exp.length, 2);
  assert.equal(Number(exp.find((e) => e.employee_id === otherUuid()).amount), -4);
});

test('Y8. Pending Casual holds are not expired', async () => {
  await seedCasual(4);
  await createHold({ requestId: uid(++seq), employeeId: otherUuid(), leaveType: 'Casual', workingDays: 3 });
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  const exp = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Expiry' && e.leave_type === 'Casual');
  assert.equal(exp.length, 2);
  assert.equal(Number(exp.find((e) => e.employee_id === otherUuid()).amount), -1);
  assert.equal(Number(exp.find((e) => e.employee_id === fakeUuid()).amount), -3);
});

test('Y9. Casual expiry never creates a zero-value ledger entry', async () => {
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  assert.equal(globalThis.__sql.__db.ledger_entries.some((e) => e.amount === 0), false);
});

test('Y10. Casual expiry cannot execute twice for the same year', async () => {
  await seedCasual(4);
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  await assert.rejects(() => runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() }), (e) => e.code === 'ALREADY_RAN');
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Expiry' && e.leave_type === 'Casual').length, 2);
});

test('Y11. Casual expiry does not affect Annual balances', async () => {
  const before = (await call('GET', '/balances/me', { user: employee })).body.Annual.balance;
  await seedCasual(4);
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  const after = (await call('GET', '/balances/me', { user: employee })).body.Annual.balance;
  assert.equal(after, before + 5);
  assert.equal(globalThis.__sql.__db.ledger_entries.some((e) => e.kind === 'Expiry' && e.leave_type === 'Annual'), false);
});

test('Y12. Year-end fails closed if required SSM value is unavailable', async () => {
  resetPolicyCache();
  setPolicyLoader(async () => undefined);
  await assert.rejects(() => runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() }), (e) => e.code === 'POLICY_MISSING');
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'CarryOver' || e.kind === 'Expiry').length, 0);
  resetPolicyCache();
  setPolicyLoader(async (path) => path === '/leaveflow/balances/annual-monthly-accrual' ? '1.75' : path === '/leaveflow/balances/carryover-cap' ? '5' : '6');
});

test('Y13. Annual carry-over is capped at 5', async () => {
  globalThis.__sql.__db.ledger_entries.push({ id: 9901, employee_id: fakeUuid(), leave_type: 'Annual', kind: 'Accrual', amount: '50', request_id: null, event_id: 'seed-annual-50', accrual_run_id: null, reason: 'Test seed', created_by: 'system', created_by_name: null, created_at: '2026-01-01T00:00:00Z' });
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  const rows = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'CarryOver' && e.leave_type === 'Annual');
  assert.ok(rows.every((e) => Number(e.amount) <= 5));
  assert.equal(rows.some((e) => Number(e.amount) === 5), true);
});

test('Y14. Annual balance below the cap carries over the actual balance', async () => {
  const run = await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  assert.equal(run.status, 'Done');
  const rows = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'CarryOver' && e.leave_type === 'Annual');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((e) => Number(e.amount) <= 5));
});

test('Y15. Annual carry-over uses exactly 5 for balances above the cap', async () => {
  globalThis.__sql.__db.ledger_entries.push({ id: 9902, employee_id: fakeUuid(), leave_type: 'Annual', kind: 'Accrual', amount: '50', request_id: null, event_id: 'seed-annual-50b', accrual_run_id: null, reason: 'Test seed', created_by: 'system', created_by_name: null, created_at: '2026-01-01T00:00:00Z' });
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  const row = globalThis.__sql.__db.ledger_entries.find((e) => e.kind === 'CarryOver' && e.employee_id === fakeUuid());
  assert.equal(Number(row.amount), 5);
});

test('Y16. Carry-over uses the CarryOver kind and Annual leave type', async () => {
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  const rows = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'CarryOver');
  assert.ok(rows.length > 0);
  assert.ok(rows.every((e) => e.leave_type === 'Annual' && Number(e.amount) > 0));
});

test('Y17. Carry-over never creates zero-value entries', async () => {
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  assert.equal(globalThis.__sql.__db.ledger_entries.some((e) => e.amount === 0), false);
});

test('Y18. Repeated year-end does not carry over twice', async () => {
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  await assert.rejects(() => runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() }), (e) => e.code === 'ALREADY_RAN');
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'CarryOver').length, 2);
});

test('Y19. Carried-over Annual balance is not expired during the following year', async () => {
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Expiry' && e.leave_type === 'Annual').length, 0);
});

test('Y20. Annual carry-over cap does not affect Casual', async () => {
  await seedCasual(6);
  await runYearEnd({ year: '2026', actor: hr, directory: yearlyDirectory() });
  const casualCarry = globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'CarryOver' && e.leave_type === 'Casual');
  assert.equal(casualCarry.length, 0);
  assert.equal(globalThis.__sql.__db.ledger_entries.filter((e) => e.kind === 'Expiry' && e.leave_type === 'Casual').length, 2);
});

const { DEMO_USERS, REASON, CREATED_BY, resolveAll, buildPlan, applyPlan, findUserByEmail } = await import('../src/services/demo-seed.js');

const fakeCognito = (overrides = {}) => ({
  async listUsers({ Filter }) {
    const email = String(Filter || '').match(/email="([^"]+)"/)?.[1];
    const user = overrides[email];
    return { Users: user ? [user] : [] };
  },
});
const validUser = (email, sub) => ({ Enabled: true, Attributes: [{ Name: 'email', Value: email }, { Name: 'sub', Value: sub }] });

test('S1. Exact email lookup resolves the correct Cognito sub', async () => {
  const cognito = fakeCognito({ 'mona.employee@leaveflow.test': validUser('mona.employee@leaveflow.test', fakeUuid()) });
  const sub = await findUserByEmail(cognito, 'pool-id', 'mona.employee@leaveflow.test');
  assert.equal(sub, fakeUuid());
});

test('S2. Missing user fails safely (no sub, no plan)', async () => {
  await assert.rejects(() => findUserByEmail(fakeCognito(), 'pool-id', 'missing@leaveflow.test'), (e) => e.code === 'SEED_USER_NOT_FOUND');
});

test('S3. Duplicate email match fails safely', async () => {
  const dup = fakeCognito();
  dup.listUsers = async () => ({ Users: [validUser('x@leaveflow.test', fakeUuid()), validUser('x@leaveflow.test', otherUuid())] });
  await assert.rejects(() => findUserByEmail(dup, 'pool-id', 'x@leaveflow.test'), (e) => e.code === 'SEED_USER_DUPLICATE');
});

test('S4. Invalid sub fails closed', async () => {
  const bad = fakeCognito({ 'x@leaveflow.test': validUser('x@leaveflow.test', 'not-a-uuid') });
  await assert.rejects(() => findUserByEmail(bad, 'pool-id', 'x@leaveflow.test'), (e) => e.code === 'SEED_SUB_INVALID');
});

test('S5. Dry run creates no writes (resolve + plan only)', async () => {
  const cognito = fakeCognito(Object.fromEntries(DEMO_USERS.map((u) => [u.email, validUser(u.email, uid(++seq))])));
  const resolved = await resolveAll(cognito, 'pool-id');
  const plan = buildPlan(resolved);
  assert.equal(resolved.length, 7);
  assert.equal(plan.length, 14);
  assert.equal(globalThis.__sql.__db.ledger_entries.length, 3);
});

test('S6. Correct 14 entries with exact kind/reason/actor and approved amounts', async () => {
  const cognito = fakeCognito(Object.fromEntries(DEMO_USERS.map((u) => [u.email, validUser(u.email, uid(++seq))])));
  const plan = buildPlan(await resolveAll(cognito, 'pool-id'));
  assert.equal(plan.length, 14);
  assert.ok(plan.every((e) => e.kind === 'Adjustment' && e.reason === REASON && e.createdBy === CREATED_BY));
  assert.equal(REASON, 'Opening balance 2026 (demo seed)');
  assert.equal(CREATED_BY, 'system:seed');
  assert.equal(plan.find((e) => e.leaveType === 'Annual' && e.employeeId === plan[0].employeeId).amount, 15);
  assert.equal(plan.filter((e) => e.leaveType === 'Casual').length, 7);
});

test('S7. Applying the plan inserts 14 rows; re-apply inserts none', async () => {
  const sql = globalThis.__sql;
  const plan = DEMO_USERS.map((u, i) => buildPlan([{ user: u, sub: uid(1000 + i) }])).flat();
  assert.equal(plan.length, 14);
  const first = await applyPlan(sql, plan);
  assert.equal(first, 14);
  assert.equal(sql.__db.ledger_entries.filter((e) => e.kind === 'Adjustment').length, 17);
  const second = await applyPlan(sql, plan);
  assert.equal(second, 0);
  assert.equal(sql.__db.ledger_entries.filter((e) => e.kind === 'Adjustment').length, 17);
});

test('S8. Existing ledger entries are not overwritten', async () => {
  const sql = globalThis.__sql;
  const before = JSON.stringify(sql.__db.ledger_entries);
  const plan = buildPlan([{ user: DEMO_USERS[0], sub: uid(2000) }]);
  await applyPlan(sql, plan);
  const after = JSON.stringify(sql.__db.ledger_entries);
  assert.ok(after.includes(before.slice(1, 50)));
  assert.equal(sql.__db.ledger_entries.filter((e) => e.event_id === plan[0].eventId).length, 1);
});

test('S9. Failure during one user lookup prevents all writes', async () => {
  const cognito = fakeCognito();
  const sql = globalThis.__sql;
  const before = sql.__db.ledger_entries.length;
  await assert.rejects(() => resolveAll(cognito, 'pool-id'), (e) => e.code === 'SEED_USER_NOT_FOUND');
  assert.equal(sql.__db.ledger_entries.length, before);
});

test('S10. Invalid/missing configuration fails closed', async () => {
  await assert.rejects(() => findUserByEmail(fakeCognito(), '', 'x@leaveflow.test'), (e) => e.code === 'SEED_CONFIG_MISSING');
  await assert.rejects(() => applyPlan(null, []), (e) => e.code === 'SEED_DB_MISSING');
  await assert.rejects(() => applyPlan(globalThis.__sql, [{ employeeId: 'bad', leaveType: 'Annual', amount: 1, kind: 'Adjustment', reason: REASON, createdBy: CREATED_BY, eventId: 'x' }]), (e) => e.code === 'SEED_SUB_INVALID');
});

test.after(() => { if (server) server.close(); });
