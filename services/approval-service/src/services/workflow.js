// The approval workflow: create the steps for a new request, escalate a manager step that waits
// too long, and close everything when the employee withdraws or cancels.
// Step Functions runs the escalation timer (Wait 48 h, or 2 min in DEMO_MODE, then call this Lambda).
// The same escalation also runs when a queue loads, so nothing stays stuck if a timer is lost.
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { awsClientConfig, cfg } from '../lib/config.js';
import { db } from '../lib/db.js';
import { log } from '../lib/log.js';
import { hrUserIds } from '../lib/directory.js';
import { notify } from './notify.js';
import { audit } from './events.js';

const sfn = new SFNClient(awsClientConfig());
const fmtRange = (a, b) => (a === b ? a : `${a} to ${b}`);
const plural = (n) => `${Number(n)} working day${Number(n) === 1 ? '' : 's'}`;

async function safeHrIds() {
  try { return await hrUserIds(); } catch (err) { log('error', 'HR_LOOKUP_FAILED', { message: err.message }); return []; }
}

async function startTimer(taskId, stepId) {
  if (!cfg.stateMachineArn) { log('warn', 'ESCALATION_TIMER_SKIPPED', { reason: 'no state machine configured', stepId }); return; }
  try {
    const out = await sfn.send(new StartExecutionCommand({
      stateMachineArn: cfg.stateMachineArn,
      name: `escalate-${stepId}`,
      input: JSON.stringify({ action: 'escalate', stepId, waitSeconds: cfg.escalateAfterSeconds }),
    }));
    const sql = await db();
    await sql`UPDATE approval_tasks SET execution_arn = ${out.executionArn} WHERE id = ${taskId}`;
    log('info', 'ESCALATION_TIMER_STARTED', { stepId, seconds: cfg.escalateAfterSeconds });
  } catch (err) {
    // The queue-load check still escalates late steps, so the request is never stuck.
    log('error', 'ESCALATION_TIMER_FAILED', { stepId, message: err.message });
  }
}

// request.submitted -> create the workflow. Safe to call twice: the second call changes nothing.
export async function startWorkflow(d) {
  const sql = await db();
  const needsHr = d.leaveType === 'Unpaid' || Number(d.workingDays) > cfg.hrOverDays;
  const [task] = await sql`
    INSERT INTO approval_tasks (request_id, employee_id, employee_name, manager_id, department, leave_type,
                                start_date, end_date, working_days, needs_hr)
    VALUES (${d.requestId}, ${d.employeeId}, ${String(d.employeeName || 'Employee').slice(0, 100)}, ${d.managerId || null},
            ${d.department}, ${d.leaveType}, ${d.startDate}, ${d.endDate}, ${d.workingDays}, ${needsHr})
    ON CONFLICT (request_id) DO NOTHING
    RETURNING id`;
  if (!task) return { duplicate: true };

  const what = `${d.employeeName || 'An employee'} · ${d.leaveType}, ${fmtRange(d.startDate, d.endDate)} (${plural(d.workingDays)}).`;
  const dueAt = new Date(Date.now() + cfg.escalateAfterSeconds * 1000).toISOString();

  if (d.managerId) {
    const [step] = await sql`
      INSERT INTO approval_steps (task_id, step_order, step, assigned_user_id, due_at, note)
      VALUES (${task.id}, 1, 'Manager', ${d.managerId}, ${dueAt}, ${needsHr ? 'HR approves as a second step after you' : null})
      RETURNING id`;
    await notify(d.managerId, 'New request to review', what, 'pages/approvals/queue.html');
    await startTimer(task.id, step.id);
  } else {
    // No manager on file (e.g. a manager's own request): HR decides directly.
    await sql`
      INSERT INTO approval_steps (task_id, step_order, step, assigned_group, note)
      VALUES (${task.id}, 1, 'HR', 'HRAdmin', 'No manager on file, so HR decides')`;
    await notify(await safeHrIds(), 'Request waiting for HR', what, 'pages/approvals/queue.html');
  }
  log('info', 'WORKFLOW_STARTED', { requestId: d.requestId, needsHr });
  await audit('approval-service', 'WORKFLOW_STARTED', d.requestId, { needsHr });
  return { taskId: task.id };
}

// Manager step waited too long -> mark it Escalated and hand the request to HR.
export async function escalateStep(stepId) {
  const sql = await db();
  const [step] = await sql`
    UPDATE approval_steps s SET status = 'Escalated', escalated_at = now()
    FROM approval_tasks t
    WHERE s.id = ${stepId} AND s.task_id = t.id AND s.status = 'Pending' AND s.step = 'Manager' AND t.status = 'InProgress'
    RETURNING s.task_id, t.request_id, t.employee_id, t.employee_name, t.leave_type, t.working_days`;
  if (!step) return { escalated: false }; // already decided, cancelled or escalated
  await sql`
    INSERT INTO approval_steps (task_id, step_order, step, assigned_group, note)
    VALUES (${step.task_id}, 2, 'HR', 'HRAdmin', 'Escalated: the manager did not decide in time')
    ON CONFLICT (task_id, step_order) DO NOTHING`;
  log('warn', 'ESCALATED', { requestId: step.request_id, stepId });
  await notify(await safeHrIds(), 'Escalated to HR', `${step.employee_name} · ${step.leave_type}, ${plural(step.working_days)}. The manager did not decide in time.`, 'pages/approvals/queue.html');
  await notify(step.employee_id, 'Request escalated', 'Your manager did not decide in time, so HR will decide your request.', `pages/requests/request.html?id=${step.request_id}`);
  await audit('approval-service', 'REQUEST_ESCALATED', step.request_id);
  return { escalated: true };
}

// Safety net: escalate every manager step that is past its due time.
export async function escalateOverdue() {
  const sql = await db();
  const late = await sql`SELECT id FROM approval_steps WHERE status = 'Pending' AND step = 'Manager' AND due_at < now() LIMIT 20`;
  for (const s of late) await escalateStep(s.id);
}

// request.cancelled (withdrawn or cancelled by the employee) -> close the workflow.
export async function cancelWorkflow(requestId) {
  const sql = await db();
  const [task] = await sql`
    UPDATE approval_tasks SET status = 'Cancelled', updated_at = now()
    WHERE request_id = ${requestId} AND status IN ('InProgress', 'Approved')
    RETURNING id`;
  if (!task) return { changed: false };
  await sql`UPDATE approval_steps SET status = 'Cancelled' WHERE task_id = ${task.id} AND status = 'Pending'`;
  log('info', 'WORKFLOW_CANCELLED', { requestId });
  return { changed: true };
}
