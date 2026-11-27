// Read-only: shows the timeline of one request in the approval database (by id or the first characters of it).
// Usage: node scripts/inspect-request.mjs 3c9e9b65
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const prefix = (process.argv[2] || '').toLowerCase();
if (!/^[0-9a-f-]{4,36}$/.test(prefix)) { console.error('Give the request id or its first characters, e.g. 3c9e9b65'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const tasks = await sql.query(
  `select id, request_id, status, created_at, updated_at, execution_arn, now() as db_now
   from approval_tasks where request_id::text like $1 order by created_at`, [prefix + '%']);
if (!tasks.length) { console.log('No request found starting with', prefix); process.exit(0); }
for (const t of tasks) {
  console.log(`request ${t.request_id}  status=${t.status}`);
  console.log(`  task created   ${new Date(t.created_at).toISOString()}`);
  console.log(`  db clock now   ${new Date(t.db_now).toISOString()}`);
  console.log(`  timer          ${t.execution_arn || '(none)'}`);
  const steps = await sql.query(
    `select step_order, step, status, created_at, due_at, escalated_at, decided_at,
            extract(epoch from (due_at - created_at)) as due_after_s,
            extract(epoch from (escalated_at - created_at)) as escalated_after_s
     from approval_steps where task_id = $1 order by step_order`, [t.id]);
  for (const s of steps) {
    console.log(`  step ${s.step_order} ${s.step.padEnd(7)} ${s.status.padEnd(9)} created ${new Date(s.created_at).toISOString()}` +
      (s.due_at ? `  due after ${Math.round(s.due_after_s)} s` : '') +
      (s.escalated_at ? `  ESCALATED after ${Math.round(s.escalated_after_s)} s` : ''));
  }
  const events = await sql.query(`select count(*)::int as n from processed_events where processed_at between $1::timestamptz - interval '5 minutes' and $1::timestamptz + interval '5 minutes'`, [t.created_at]);
  console.log(`  events processed around then: ${events[0].n}`);
}
