// Receives request.approved and request.rejected from Ammar's EventBridge rule (Lambda target, not HTTP).
// Checks the sender, applies each event exactly once, and never moves a request backwards.
import { db } from '../lib/db.js';
import { log } from '../lib/log.js';

const ACCEPTED = { 'request.approved': 'Approved', 'request.rejected': 'Rejected' };
const TRUSTED_SOURCE = 'leaveflow.approvals';
const UUID = /^[0-9a-f-]{36}$/i;

export async function handleEvent(event) {
  const type = event['detail-type'];
  const d = event.detail || {};
  const target = ACCEPTED[type];
  if (event.source !== TRUSTED_SOURCE || !target || !UUID.test(d.eventId || '') || !UUID.test(d.requestId || '')) {
    log('warn', 'EVENT_REJECTED', { source: event.source, detailType: type, reason: 'unexpected source, type or ids' });
    return { ok: false };
  }
  const sql = await db();
  const [r] = await sql`SELECT id, employee_id, status FROM leave_requests WHERE id = ${d.requestId}`;
  if (!r || (d.employeeId && d.employeeId !== r.employee_id)) {
    log('warn', 'EVENT_REJECTED', { detailType: type, requestId: d.requestId, reason: 'unknown request or employee mismatch' });
    return { ok: false };
  }
  if (r.status !== 'Pending') {
    log('info', 'EVENT_IGNORED', { detailType: type, requestId: r.id, status: r.status }); // e.g. withdrawn meanwhile
    return { ok: true, ignored: true };
  }
  try {
    await sql.transaction([
      sql`INSERT INTO processed_events (event_id) VALUES (${d.eventId})`, // duplicate eventId aborts the whole transaction
      sql`UPDATE leave_requests SET status = ${target}, updated_at = now() WHERE id = ${r.id} AND status = 'Pending'`,
      sql`INSERT INTO request_status_history (request_id, from_status, to_status, changed_by, changed_by_name, note)
          VALUES (${r.id}, 'Pending', ${target}, ${String(d.decidedBy || 'approval-service').slice(0, 100)},
                  ${String(d.decidedByName || 'Approval service').slice(0, 100)}, ${d.comment || d.note ? String(d.comment || d.note).slice(0, 300) : null})`,
    ]);
  } catch (err) {
    if (err.code === '23505') {
      log('info', 'EVENT_DUPLICATE', { eventId: d.eventId });
      return { ok: true, duplicate: true };
    }
    throw err; // let Lambda retry
  }
  log('info', 'REQUEST_DECIDED', { requestId: r.id, status: target, eventId: d.eventId });
  return { ok: true };
}
