// End-to-end and security tests against the DEPLOYED approvals-api on Floci.
// It signs in the test users directly with Cognito, puts request.submitted events on leaveflow-bus
// (exactly what the requests service does), and checks the API answers.
// Usage:  node scripts/api-test.mjs                 (about 1 minute)
//         node scripts/api-test.mjs --escalation    (adds the real 2-minute Step Functions escalation, ~3 minutes)
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline/promises';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SFNClient, DescribeExecutionCommand } from '@aws-sdk/client-sfn';

const aws = { region: 'us-east-1', endpoint: 'http://localhost:4566', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/^﻿/, ''));
const cog = readJson('../../leave-request-service/deploy/cognito-outputs.json');
const API = readJson('../deploy/approvals-outputs.json').apiUrl.replace(/\/$/, '');
const withEscalation = process.argv.includes('--escalation');
console.log(`approvals-api: ${API}\n`);

let password = process.env.LEAVEFLOW_TEST_PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Test users password: ');
  rl.close();
  process.stdout.write('\x1b[1A\x1b[2K'); // hide the typed password line
}

const cognito = new CognitoIdentityProviderClient(aws);
const bus = new EventBridgeClient(aws);
async function login(email) {
  const out = await cognito.send(new InitiateAuthCommand({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: cog.clientId, AuthParameters: { USERNAME: email, PASSWORD: password } }));
  if (!out.AuthenticationResult) throw new Error(`${email} needs an MFA code; sign-in here only works for users without an authenticator yet`);
  const token = out.AuthenticationResult.IdToken;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return { token, id: claims.sub, dept: claims['custom:department'], name: email.split('.')[0].replace(/^./, (c) => c.toUpperCase()) };
}
async function call(method, path, user, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  last = data;
  return { status: res.status, data };
}
let pass = 0, fail = 0;
function check(name, got, expected, extra = '') {
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got}, expected ${expected}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok && last) console.log(`        API answered: ${JSON.stringify(last).slice(0, 200)}`);
}
let last = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function futureSunday(weeksMin, weeksMax) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 7 * (weeksMin + Math.floor(Math.random() * (weeksMax - weeksMin))));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
async function submit(employee, manager, day) {
  const requestId = randomUUID();
  const detail = { eventId: randomUUID(), requestId, employeeId: employee.id, employeeName: employee.name, managerId: manager.id,
                   department: employee.dept, leaveType: 'Annual', startDate: day, endDate: day, workingDays: 1, certificateRequired: false };
  const out = await bus.send(new PutEventsCommand({ Entries: [{ EventBusName: 'leaveflow-bus', Source: 'leaveflow.requests', DetailType: 'request.submitted', Detail: JSON.stringify(detail) }] }));
  if (out.FailedEntryCount) throw new Error('PutEvents failed');
  return requestId;
}
async function waitForTask(user, requestId, seconds) {
  for (let i = 0; i < seconds / 3; i++) {
    const q = await call('GET', '/approvals', user);
    const t = Array.isArray(q.data) && q.data.find((x) => x.requestId === requestId);
    if (t) return t;
    await sleep(3000);
  }
  return null;
}

const mona = await login('mona.employee@leaveflow.test');
const omar = await login('omar.employee@leaveflow.test');
const sara = await login('sara.manager@leaveflow.test');
const karim = await login('karim.manager@leaveflow.test');
console.log('Signed in: Mona, Omar (employees, Sales), Sara (manager, Sales), Karim (manager, Engineering)\n');

console.log('-- Authentication and roles');
check('No token -> 401', (await call('GET', '/approvals')).status, 401);
check('Forged token -> 401', (await call('GET', '/approvals', { token: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.bad' })).status, 401);
check('Employee opens the approvals queue -> 403', (await call('GET', '/approvals', mona)).status, 403);
check('Employee opens the team calendar -> 403', (await call('GET', '/team-calendar', mona)).status, 403);
check('Manager opens the queue -> 200', (await call('GET', '/approvals', sara)).status, 200);

console.log('\n-- End to end: request.submitted on the bus -> Sara\'s queue -> decision');
const day = futureSunday(10, 40);
const reqId = await submit(mona, sara, day);
console.log(`   Put request.submitted for Mona on ${day} (request ${reqId.slice(0, 8)}...). Waiting for it in Sara's queue...`);
const task = await waitForTask(sara, reqId, 60);
check('Event reached the service through EventBridge (task in Sara\'s queue)', Boolean(task), true);
if (task) {
  console.log(`   coverage: ${task.coverage.level}, team size ${task.coverage.teamSize}, worst day ${task.coverage.worst.pct}%`);
  check('Karim (another team\'s manager) does not see it', Boolean((await call('GET', '/approvals', karim)).data?.find?.((x) => x.requestId === reqId)), false);
  check('Karim decides Sara\'s task -> 403', (await call('POST', `/approvals/${task.id}/decision`, karim, { decision: 'Approved' })).status, 403);
  check('Mona decides her own task -> 403', (await call('POST', `/approvals/${task.id}/decision`, mona, { decision: 'Approved' })).status, 403);
  check('Reject without a comment -> 400', (await call('POST', `/approvals/${task.id}/decision`, sara, { decision: 'Rejected' })).status, 400);
  check('Unknown decision -> 400', (await call('POST', `/approvals/${task.id}/decision`, sara, { decision: 'Maybe' })).status, 400);
  check('Comment over 300 characters -> 400', (await call('POST', `/approvals/${task.id}/decision`, sara, { decision: 'Approved', comment: 'x'.repeat(301) })).status, 400);
  check('Task id that is not a number -> 404', (await call('POST', `/approvals/abc/decision`, sara, { decision: 'Approved' })).status, 404);
  const script = '<script>alert("xss")</script> Enjoy your leave';
  check('Sara approves (comment contains a script tag) -> 200', (await call('POST', `/approvals/${task.id}/decision`, sara, { decision: 'Approved', comment: script })).status, 200);
  check('Approve the same task twice -> 409', (await call('POST', `/approvals/${task.id}/decision`, sara, { decision: 'Approved' })).status, 409);
  const hist = await call('GET', '/approvals/history', sara);
  const h = hist.data?.find?.((x) => x.requestId === reqId);
  check('Decision is in Sara\'s history', Boolean(h), true);
  check('Script tag stored as plain text, not run (page shows it with textContent)', h?.comment, script);
}

console.log('\n-- Notifications (ownership)');
const inbox = await call('GET', '/notifications', mona);
check('Mona reads her inbox -> 200', inbox.status, 200);
const note = Array.isArray(inbox.data) ? inbox.data[0] : null;
check('Mona got a "request approved" notification', Boolean(note && /approved/i.test(note.title)), true, note?.title || 'none');
if (note) {
  check('Omar marks Mona\'s notification read -> 404', (await call('PATCH', `/notifications/${note.id}`, omar)).status, 404);
  check('Omar deletes Mona\'s notification -> 404', (await call('DELETE', `/notifications/${note.id}`, omar)).status, 404);
  check('Mona marks her notification read -> 200', (await call('PATCH', `/notifications/${note.id}`, mona)).status, 200);
}
const cal = await call('GET', '/team-calendar', sara);
check('Sara sees her team calendar -> 200', cal.status, 200, `${cal.data?.members?.length ?? 0} members`);

if (withEscalation) {
  console.log('\n-- Escalation: Step Functions waits 2 minutes, then moves the request to HR');
  const day2 = futureSunday(41, 80);
  const req2 = await submit(omar, sara, day2);
  const t2 = await waitForTask(sara, req2, 60);
  check('Omar\'s request is in Sara\'s queue', Boolean(t2), true);
  console.log('   Waiting 2 minutes 20 seconds for the timer (do not close the window)...');
  await sleep(140_000);
  // 1. The Step Functions execution itself finished (Wait state, then it called approvals-fn).
  const sfn = new SFNClient(aws);
  const smArn = readJson('../deploy/approvals-outputs.json').stateMachineArn;
  const execArn = smArn.replace(':stateMachine:', ':execution:') + `:escalate-${req2}`;
  let exec = null; try { exec = await sfn.send(new DescribeExecutionCommand({ executionArn: execArn })); } catch (e) { exec = { status: e.name }; }
  check('Step Functions escalation timer ran', exec.status, 'SUCCEEDED');
  // 2. HR now has it, marked as escalated (Hana has no authenticator yet, so Cognito signs her in directly).
  const hana = await login('hana.hr@leaveflow.test');
  const hrTask = await waitForTask(hana, req2, 6);
  check('Request is now in HR\'s (Hana\'s) queue', Boolean(hrTask), true);
  check('It is marked as escalated', hrTask?.escalated, true);
  check('Sara can no longer decide her old step -> 409', (await call('POST', `/approvals/${t2?.id}/decision`, sara, { decision: 'Approved' })).status, 409);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
