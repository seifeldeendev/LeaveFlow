// Leave requests: submit through the policy engine, list, details, withdraw/cancel, certificates.
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { requireAuth } from '../lib/auth.js';
import { validateInput, evaluate, LEAVE_TYPES } from '../services/policy.js';
import { isIsoDate, today, dateCol } from '../services/dates.js';
import { publish, audit } from '../services/events.js';
import { uploadLink, viewLink, removeCertificate, certificateKey } from '../services/certificates.js';

const router = Router();
router.use(requireAuth);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['Pending', 'Approved', 'Rejected', 'Withdrawn', 'Cancelled'];
const isHR = (u) => u.groups.includes('HRAdmin');

// Response shape used by the frontend pages (pages/requests/*).
const out = (r) => ({
  id: r.id, employeeId: r.employee_id, managerId: r.manager_id,
  type: r.leave_type, start: dateCol(r.start_date), end: dateCol(r.end_date),
  workingDays: Number(r.working_days), reason: r.reason || '', status: r.status,
  hasCertificate: Boolean(r.certificate_key), createdAt: r.created_at, updatedAt: r.updated_at,
  employee: { id: r.employee_id, name: r.employee_name || 'Employee', dept: r.department },
});

// Event payload agreed with the Approval and Balance services (section 4 of the plan).
const eventDetail = (r) => ({
  requestId: r.id, employeeId: r.employee_id, employeeName: r.employee_name, managerId: r.manager_id, department: r.department,
  leaveType: r.leave_type, startDate: dateCol(r.start_date), endDate: dateCol(r.end_date), workingDays: Number(r.working_days),
});

// Loads a request the caller may see. Anyone else gets 404, so ids cannot be probed.
async function loadVisible(req, { ownerOnly = false } = {}) {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Request not found');
  const sql = await db();
  const [r] = await sql`SELECT * FROM leave_requests WHERE id = ${req.params.id}`;
  const u = req.user;
  const allowed = r && (r.employee_id === u.id || (!ownerOnly && (r.manager_id === u.id || isHR(u))));
  if (!allowed) {
    if (r) log('warn', 'ACCESS_DENIED', { path: req.path, userId: u.id, reason: 'not owner, manager or HR' });
    throw new HttpError(404, 'NOT_FOUND', 'Request not found');
  }
  return r;
}

// GET /working-days?start=&end=&type=   preview before submitting (mounted at the app root)
export async function workingDaysPreview(req, res) {
  const input = { type: req.query.type || 'Annual', start: req.query.start, end: req.query.end };
  validateInput(input);
  res.json(await evaluate(req.user, input));
}

// POST /leave-requests  { type, start, end, reason }
router.post('/', async (req, res) => {
  const input = {
    type: req.body?.type, start: req.body?.start, end: req.body?.end,
    reason: typeof req.body?.reason === 'string' ? req.body.reason.trim().replace(/[\u0000-\u001f\u007f]/g, ' ') : undefined,
  };
  validateInput(input);
  const u = req.user;
  const result = await evaluate(u, input);
  const failed = result.checks.filter((c) => !c.ok);
  if (failed.length) {
    log('info', 'POLICY_REJECTED', { userId: u.id, rules: failed.map((c) => c.label) });
    throw new HttpError(422, 'POLICY_VIOLATION', `This request breaks ${failed.length} policy rule${failed.length > 1 ? 's' : ''}.`, result);
  }

  const sql = await db();
  const id = randomUUID();
  let row;
  try {
    [[row]] = await sql.transaction([
      sql`INSERT INTO leave_requests (id, employee_id, employee_name, manager_id, department, leave_type, start_date, end_date, working_days, reason)
          VALUES (${id}, ${u.id}, ${u.name}, ${u.managerId}, ${u.department ?? 'Unknown'}, ${input.type}, ${input.start}, ${input.end},
                  ${result.days}, ${input.reason || null})
          RETURNING *`,
      sql`INSERT INTO request_status_history (request_id, from_status, to_status, changed_by, changed_by_name, note)
          VALUES (${id}, NULL, 'Pending', ${u.id}, ${u.name}, ${`Passed policy checks · ${result.days} working days`})`,
    ]);
  } catch (err) {
    if (err.code === '23P01') throw new HttpError(409, 'OVERLAP', 'You already have a pending or approved request on some of these days');
    throw err;
  }

  try {
    await publish('request.submitted', { ...eventDetail(row), certificateRequired: result.certificateRequired });
  } catch (err) {
    // Without the event nobody would ever approve it, so undo the request and tell the user.
    log('error', 'EVENT_PUBLISH_FAILED', { requestId: id, message: err.message });
    await sql.transaction([
      sql`DELETE FROM request_status_history WHERE request_id = ${id}`,
      sql`DELETE FROM leave_requests WHERE id = ${id}`,
    ]);
    throw new HttpError(503, 'TRY_AGAIN', 'The request could not be sent for approval. Please try again.');
  }
  await audit(u.id, 'REQUEST_SUBMITTED', id, { leaveType: input.type, workingDays: result.days });
  log('info', 'REQUEST_SUBMITTED', { userId: u.id, requestId: id, path: req.path, status: 201 });
  res.status(201).json({ ...out(row), certificateRequired: result.certificateRequired });
});

// GET /leave-requests?status=&type=&from=&to=   own requests only
router.get('/', async (req, res) => {
  const { status, type, from, to } = req.query;
  const errors = [];
  if (status && !STATUSES.includes(status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  if (type && !LEAVE_TYPES.includes(type)) errors.push(`type must be one of ${LEAVE_TYPES.join(', ')}`);
  if (from && !isIsoDate(from)) errors.push('from must be YYYY-MM-DD');
  if (to && !isIsoDate(to)) errors.push('to must be YYYY-MM-DD');
  if (errors.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid filters', errors);

  const sql = await db();
  const rows = await sql`
    SELECT * FROM leave_requests
    WHERE employee_id = ${req.user.id}
      AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
      AND (${type ?? null}::text IS NULL OR leave_type = ${type ?? null})
      AND (${from ?? null}::date IS NULL OR end_date >= ${from ?? null}::date)
      AND (${to ?? null}::date IS NULL OR start_date <= ${to ?? null}::date)
    ORDER BY start_date DESC
    LIMIT 100`;
  res.json(rows.map(out));
});

// GET /leave-requests/:id   owner, their manager, or HR
router.get('/:id', async (req, res) => {
  const r = await loadVisible(req);
  const sql = await db();
  const history = await sql`
    SELECT from_status, to_status, changed_by_name, changed_at, note FROM request_status_history
    WHERE request_id = ${r.id} ORDER BY changed_at, id`;
  const lastDecision = [...history].reverse().find((h) => ['Approved', 'Rejected'].includes(h.to_status));
  res.json({
    ...out(r),
    history: history.map((h) => ({
      at: h.changed_at, status: h.from_status === null ? 'Submitted' : h.to_status,
      by: h.changed_by_name || 'LeaveFlow', note: h.note || '',
    })),
    steps: [], // approval steps live in the Approval service
    canAct: r.employee_id === req.user.id,
    decisionComment: lastDecision?.note || null,
  });
});

// PATCH /leave-requests/:id/status  { action: 'withdraw' | 'cancel', reason? }   owner only
// Withdraw: while Pending. Cancel: Approved and not started yet (the Balance service refunds the days).
router.patch('/:id/status', async (req, res) => {
  const action = req.body?.action;
  if (!['withdraw', 'cancel'].includes(action)) throw new HttpError(400, 'BAD_ACTION', 'action must be withdraw or cancel');
  const note = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : '';
  const target = action === 'withdraw' ? 'Withdrawn' : 'Cancelled';
  const r = await loadVisible(req, { ownerOnly: true });
  const from = r.status;
  if (action === 'withdraw' && from !== 'Pending') throw new HttpError(409, 'BAD_TRANSITION', 'Only pending requests can be withdrawn.');
  if (action === 'cancel') {
    if (from !== 'Approved') throw new HttpError(409, 'BAD_TRANSITION', 'Only approved requests can be cancelled; withdraw a pending one instead.');
    if (dateCol(r.start_date) <= today()) throw new HttpError(409, 'BAD_TRANSITION', "Only approved requests that haven't started can be cancelled.");
  }

  const sql = await db();
  // The status condition makes this safe if a decision arrives at the same moment.
  const [[updated]] = await sql.transaction([
    sql`UPDATE leave_requests SET status = ${target}, updated_at = now() WHERE id = ${r.id} AND status = ${from} RETURNING *`,
    sql`INSERT INTO request_status_history (request_id, from_status, to_status, changed_by, changed_by_name, note)
        SELECT ${r.id}, ${from}, ${target}, ${req.user.id}, ${req.user.name}, ${note || null}
        WHERE EXISTS (SELECT 1 FROM leave_requests WHERE id = ${r.id} AND status = ${target})`,
  ]);
  if (!updated) throw new HttpError(409, 'BAD_TRANSITION', 'The request changed meanwhile; reload and try again.');

  try {
    await publish('request.cancelled', { ...eventDetail(updated), previousStatus: from });
  } catch (err) {
    log('error', 'EVENT_PUBLISH_FAILED', { requestId: r.id, message: err.message });
  }
  await audit(req.user.id, `REQUEST_${target.toUpperCase()}`, r.id);
  res.json(out(updated));
});

// Medical certificates (Sick leave), stored in a private S3 bucket encrypted with our KMS key.
// POST: 5-minute upload link (owner, pending only).  GET: 5-minute view link (owner, manager, HR).  DELETE: owner, pending only.
router.post('/:id/certificate', async (req, res) => {
  const r = await loadVisible(req, { ownerOnly: true });
  if (r.leave_type !== 'Sick') throw new HttpError(409, 'NOT_SICK_LEAVE', 'Certificates are only for sick leave');
  if (r.status !== 'Pending') throw new HttpError(409, 'NOT_PENDING', 'Certificates can only be added while the request is pending');
  const link = await uploadLink(r, req.body?.contentType);
  const sql = await db();
  await sql`UPDATE leave_requests SET certificate_key = ${certificateKey(r)}, updated_at = now() WHERE id = ${r.id}`;
  await audit(req.user.id, 'CERTIFICATE_UPLOAD_LINK', r.id);
  res.status(201).json(link);
});

router.get('/:id/certificate', async (req, res) => {
  const r = await loadVisible(req);
  if (!r.certificate_key) throw new HttpError(404, 'NOT_FOUND', 'No certificate for this request');
  const link = await viewLink(r);
  await audit(req.user.id, 'CERTIFICATE_VIEWED', r.id);
  res.json(link);
});

router.delete('/:id/certificate', async (req, res) => {
  const r = await loadVisible(req, { ownerOnly: true });
  if (r.status !== 'Pending') throw new HttpError(409, 'NOT_PENDING', 'Certificates can only be removed while the request is pending');
  if (!r.certificate_key) throw new HttpError(404, 'NOT_FOUND', 'No certificate for this request');
  await removeCertificate(r);
  const sql = await db();
  await sql`UPDATE leave_requests SET certificate_key = NULL, updated_at = now() WHERE id = ${r.id}`;
  await audit(req.user.id, 'CERTIFICATE_REMOVED', r.id);
  res.status(204).end();
});

export default router;
