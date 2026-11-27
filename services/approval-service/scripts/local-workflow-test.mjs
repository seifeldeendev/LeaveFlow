// Runs the workflow against the real Neon database and the Cognito users on Floci, then removes its test rows.
// Checks: request.submitted creates a Manager step for Sara, a repeated event changes nothing,
// a fake sender is rejected, escalation hands the request to HR, cancellation closes it.
// Usage (Floci running):  node scripts/local-workflow-test.mjs
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

process.env.AWS_ENDPOINT_URL ||= 'http://localhost:4566';
process.env.AWS_REGION ||= 'us-east-1';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
const cog = JSON.parse(readFileSync(new URL('../../leave-request-service/deploy/cognito-outputs.json', import.meta.url), 'utf8').replace(/^﻿/, ''));
process.env.COGNITO_USER_POOL_ID = cog.userPoolId;
delete process.env.ESCALATION_STATE_MACHINE_ARN; // no timer here; escalation is called directly

const { db } = await import('../src/lib/db.js');
const { allUsers } = await import('../src/lib/directory.js');
const { handleEvent } = await import('../src/events/consumer.js');
const { escalateStep, cancelWorkflow } = await import('../src/services/workflow.js');
const { coverage } = await import('../src/services/coverage.js');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

const users = await allUsers();
const mona = users.find((u) => u.email === 'mona.employee@leaveflow.test');
const sara = users.find((u) => u.email === 'sara.manager@leaveflow.test');
check('Cognito users found on Floci', Boolean(mona && sara), `${users.length} users`);
if (!mona || !sara) process.exit(1);

const sql = await db();
const requestId = randomUUID();
const eventId = randomUUID();
const startedAt = new Date().toISOString();
const event = {
  source: 'leaveflow.requests', 'detail-type': 'request.submitted',
  detail: { eventId, requestId, employeeId: mona.id, employeeName: mona.name, managerId: sara.id, department: mona.dept,
            leaveType: 'Annual', startDate: '2027-03-07', endDate: '2027-03-08', workingDays: 2, certificateRequired: false },
};

try {
  const r1 = await handleEvent(event);
  check('request.submitted processed', r1.ok === true);
  const steps = await sql`SELECT s.id, s.step_order, s.step, s.assigned_user_id, s.status FROM approval_steps s JOIN approval_tasks t ON t.id = s.task_id WHERE t.request_id = ${requestId}`;
  check('Manager step created for Sara, status Pending', steps.length === 1 && steps[0].step === 'Manager' && steps[0].assigned_user_id === sara.id && steps[0].status === 'Pending');

  const r2 = await handleEvent(event);
  check('Same event again is skipped (idempotent)', r2.duplicate === true);

  const r3 = await handleEvent({ ...event, source: 'attacker.fake', detail: { ...event.detail, eventId: randomUUID() } });
  check('Event from an unknown source is rejected', r3.ok === false);

  const [task] = await sql`SELECT request_id, department, start_date::text AS start_date, end_date::text AS end_date FROM approval_tasks WHERE request_id = ${requestId}`;
  const cov = await coverage(task);
  check('Coverage check runs', ['ok', 'warn', 'block'].includes(cov.level), `team ${cov.teamSize}, worst ${cov.worst.pct}%, ${cov.level}`);

  const notes = await sql`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${sara.id} AND created_at >= ${startedAt}`;
  check('Sara got a notification', notes[0].n >= 1);

  const early = await escalateStep(steps[0].id);
  check('A timer that fires early does not escalate (due in 2 min)', early.escalated === false && early.retryInSeconds > 0, `retry in ${early.retryInSeconds} s`);
  const esc = await escalateStep(steps[0].id, { ignoreDue: true });
  const after = await sql`SELECT s.step_order, s.step, s.status FROM approval_steps s JOIN approval_tasks t ON t.id = s.task_id WHERE t.request_id = ${requestId} ORDER BY s.step_order`;
  check('Escalation: Manager step Escalated, HR step Pending', esc.escalated && after[0].status === 'Escalated' && after[1]?.step === 'HR' && after[1]?.status === 'Pending');

  const esc2 = await escalateStep(steps[0].id, { ignoreDue: true });
  check('Escalating twice changes nothing', esc2.escalated === false);

  const c = await cancelWorkflow(requestId);
  const [t2] = await sql`SELECT status FROM approval_tasks WHERE request_id = ${requestId}`;
  const open = await sql`SELECT count(*)::int AS n FROM approval_steps s JOIN approval_tasks t ON t.id = s.task_id WHERE t.request_id = ${requestId} AND s.status = 'Pending'`;
  check('Cancellation closes the request and its open steps', c.changed && t2.status === 'Cancelled' && open[0].n === 0);
} catch (err) {
  fail++; console.log('FAIL  unexpected error:', err.message);
} finally {
  // Remove everything this test created.
  try {
    await sql`DELETE FROM approval_steps WHERE task_id IN (SELECT id FROM approval_tasks WHERE request_id = ${requestId})`;
    await sql`DELETE FROM approval_tasks WHERE request_id = ${requestId}`;
    await sql`DELETE FROM processed_events WHERE event_id = ${eventId}`;
    await sql`DELETE FROM notifications WHERE created_at >= ${startedAt} AND (link LIKE ${'%' + requestId + '%'} OR body LIKE ${'%' + (mona.name || '') + '%'})`;
    console.log('Test rows removed.');
  } catch (err) { console.log('Cleanup warning:', err.message); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
