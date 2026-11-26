// approvals-api: my approval queue, approve/reject with the coverage check, my decision history.
import { Router } from 'express';
import { cfg } from '../lib/config.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { hrUserIds } from '../lib/directory.js';
import { coverage } from '../services/coverage.js';
import { escalateOverdue } from '../services/workflow.js';
import { publish, audit } from '../services/events.js';
import { notify } from '../services/notify.js';

const router = Router();
router.use(requireAuth, requireRole('Manager', 'HRAdmin'));

const STEP_ID = /^\d{1,18}$/;          // step ids are numbers in the database
const MAX_COMMENT = 300;              // database limit on decision_comment
const isHR = (u) => u.groups.includes('HRAdmin');
const clean = (s) => String(s ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
const plural = (n) => `${Number(n)} working day${Number(n) === 1 ? '' : 's'}`;

// Columns shared by the queue and the decision: dates as text so time zones never shift them.
const TASK_COLS = `t.request_id, t.employee_id, t.employee_name, t.manager_id, t.department, t.leave_type,
  t.start_date::text AS start_date, t.end_date::text AS end_date, t.working_days, t.needs_hr,
  t.certificate_required, t.status AS task_status`;

// Why this step exists, shown on the card.
function noteFor(r) {
  if (r.step_type === 'Manager') return r.needs_hr ? 'HR approves as a second step after you' : undefined;
  if (r.escalated) return 'Escalated: the manager did not decide in time';
  if (Number(r.step_no) === 1) return 'No manager on file, so HR decides';
  return r.leave_type === 'Unpaid' ? 'Unpaid leave needs HR as a second step' : 'Over 5 working days needs HR as a second step';
}

// GET /approvals?status=pending   the steps waiting for the caller (own requests are never shown)
router.get('/', async (req, res) => {
  const u = req.user;
  try { await escalateOverdue(); } catch (err) { log('error', 'ESCALATION_CHECK_FAILED', { message: err.message }); }
  const sql = await db();
  const rows = await sql.query(
    `SELECT s.id, s.step_no, s.step_type, s.created_at, ${TASK_COLS},
            EXISTS (SELECT 1 FROM approval_steps e WHERE e.request_id = t.request_id AND e.status = 'Escalated') AS escalated
     FROM approval_steps s JOIN approval_tasks t ON t.request_id = s.request_id
     WHERE s.status = 'Pending' AND t.status = 'Pending' AND t.employee_id <> $1
       AND ((s.step_type = 'Manager' AND s.approver_id = $1) OR ($2::boolean AND s.step_type = 'HR'))
     ORDER BY s.created_at`, [u.id, isHR(u)]);

  const out = [];
  for (const r of rows) {
    // The page counts down to escalation on a 48-hour scale; in demo mode 2 minutes stand for 48 hours.
    const elapsedSec = (Date.now() - new Date(r.created_at).getTime()) / 1000;
    const ageHours = Math.round((elapsedSec / cfg.escalateAfterSeconds) * 48);
    out.push({
      id: String(r.id), requestId: r.request_id, step: r.step_type, status: 'Pending', createdAt: r.created_at,
      escalated: r.escalated, note: noteFor(r), ageHours,
      needsHR: r.step_type === 'Manager' && r.needs_hr,
      request: {
        id: r.request_id, type: r.leave_type, start: r.start_date, end: r.end_date, workingDays: Number(r.working_days), reason: '',
        employee: { id: r.employee_id, name: r.employee_name || 'Employee', dept: r.department },
      },
      balance: {}, // shown by the balance service pages
      coverage: await coverage(r),
    });
  }
  res.json(out);
});

// POST /approvals/{taskId}/decision   { decision: "Approved" | "Rejected", comment }
router.post('/:id/decision', async (req, res) => {
  const u = req.user;
  const decision = req.body?.decision;
  const comment = clean(req.body?.comment);
  if (!['Approved', 'Rejected'].includes(decision)) throw new HttpError(400, 'BAD_DECISION', 'Choose approve or reject.');
  if (comment.length > MAX_COMMENT) throw new HttpError(400, 'COMMENT_TOO_LONG', `Keep the comment under ${MAX_COMMENT} characters.`);
  if (decision === 'Rejected' && !comment) throw new HttpError(400, 'COMMENT_REQUIRED', 'Add a comment so the employee knows why.');
  if (!STEP_ID.test(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Task not found.');

  const sql = await db();
  const [s] = await sql.query(
    `SELECT s.id, s.step_no, s.step_type, s.status, s.approver_id, ${TASK_COLS}
     FROM approval_steps s JOIN approval_tasks t ON t.request_id = s.request_id WHERE s.id = $1`, [req.params.id]);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Task not found.');

  // Only the assigned approver may decide: the manager for a Manager step, HR for an HR step.
  const assigned = s.step_type === 'Manager' ? s.approver_id === u.id : isHR(u);
  if (!assigned) {
    log('warn', 'ACCESS_DENIED', { path: req.path, userId: u.id, reason: 'not the assigned approver' });
    throw new HttpError(403, 'FORBIDDEN', "This task isn't assigned to you.");
  }
  if (s.employee_id === u.id) {
    log('warn', 'ACCESS_DENIED', { path: req.path, userId: u.id, reason: 'self-approval' });
    throw new HttpError(403, 'FORBIDDEN', "You can't decide your own request.");
  }
  const first = String(s.employee_name || 'The employee').split(' ')[0];
  if (s.task_status !== 'Pending') throw new HttpError(409, 'NOT_PENDING', `${first}'s request is now ${s.task_status.toLowerCase()}, so there's nothing to decide.`);
  if (s.status !== 'Pending') throw new HttpError(409, 'ALREADY_DECIDED', 'This step was already decided.');

  // Coverage rule: a manager cannot approve above 30% of the team off. HR may still decide.
  if (decision === 'Approved' && s.step_type === 'Manager') {
    const cov = await coverage(s);
    if (cov.level === 'block') {
      throw new HttpError(409, 'COVERAGE_BLOCKED', `Approving would put ${cov.worst.pct}% of the team off on ${cov.worst.date}. The limit is ${cfg.coverageBlockPct}%.`, cov);
    }
  }

  // Claim the step atomically: if two clicks race, only one wins and the other gets 409.
  const approverName = String(u.name || 'Approver').slice(0, 100);
  const [claimed] = await sql`
    UPDATE approval_steps
    SET status = ${decision}, decided_by = ${u.id}, decided_by_name = ${approverName}, decision_comment = ${comment || null}, decided_at = now()
    WHERE id = ${String(s.id)} AND status = 'Pending' RETURNING id`;
  if (!claimed) throw new HttpError(409, 'ALREADY_DECIDED', 'This step was already decided.');

  const needsHR = decision === 'Approved' && s.step_type === 'Manager' && s.needs_hr;
  const requestLink = `pages/requests/request.html?id=${s.request_id}`;
  const detail = {
    requestId: s.request_id, employeeId: s.employee_id, department: s.department, leaveType: s.leave_type,
    startDate: s.start_date, endDate: s.end_date, workingDays: Number(s.working_days),
    decidedBy: u.id, decidedByName: approverName, comment: comment || undefined,
  };

  if (needsHR) {
    await sql`
      INSERT INTO approval_steps (request_id, step_no, step_type, approver_id, status)
      VALUES (${s.request_id}, 2, 'HR', NULL, 'Pending')
      ON CONFLICT (request_id, step_no) DO NOTHING`;
    const hr = await hrUserIds().catch(() => []);
    await notify(hr, 'HR step waiting', `${s.employee_name} · ${s.leave_type}, ${plural(s.working_days)}. Approved by ${approverName}.`, 'pages/approvals/queue.html');
  } else {
    // Final decision: tell the other services. If the bus refuses, undo our step so the approver can retry.
    try {
      await publish(decision === 'Approved' ? 'request.approved' : 'request.rejected', detail);
    } catch (err) {
      await sql`UPDATE approval_steps SET status = 'Pending', decided_by = NULL, decided_by_name = NULL, decision_comment = NULL, decided_at = NULL WHERE id = ${String(s.id)}`;
      log('error', 'DECISION_PUBLISH_FAILED', { requestId: s.request_id, message: err.message });
      throw new HttpError(503, 'TRY_AGAIN', 'The decision could not be sent. Try again in a moment.');
    }
    await sql`UPDATE approval_tasks SET status = ${decision}, updated_at = now() WHERE request_id = ${s.request_id}`;
    await notify(s.employee_id, `Request ${decision.toLowerCase()}`,
      `${approverName} ${decision.toLowerCase()} your ${s.leave_type} leave (${s.start_date} to ${s.end_date}).${comment ? ' Comment: ' + comment : ''}`, requestLink);
  }

  log('info', 'DECISION_MADE', { requestId: s.request_id, step: s.step_type, decision, userId: u.id, needsHR });
  await audit(u.id, `REQUEST_${decision.toUpperCase()}`, s.request_id, { step: s.step_type });
  res.json({ ok: true, needsHR });
});

// GET /approvals/history   every decision the caller made, newest first
router.get('/history', async (req, res) => {
  const sql = await db();
  const rows = await sql`
    SELECT s.id, s.status, s.decision_comment, s.decided_at, t.request_id, t.employee_name, t.leave_type,
           t.start_date::text AS start_date, t.end_date::text AS end_date, t.working_days
    FROM approval_steps s JOIN approval_tasks t ON t.request_id = s.request_id
    WHERE s.decided_by = ${req.user.id} AND s.status IN ('Approved', 'Rejected')
    ORDER BY s.decided_at DESC LIMIT 200`;
  res.json(rows.map((r) => ({
    taskId: String(r.id), requestId: r.request_id, decision: r.status, at: r.decided_at, comment: r.decision_comment || '',
    employee: r.employee_name || 'Employee', type: r.leave_type, start: r.start_date, end: r.end_date, days: Number(r.working_days),
  })));
});

export default router;
