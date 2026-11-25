// Receives request.submitted and request.cancelled from the requests service, via the
// EventBridge rules on leaveflow-bus. Checks the sender and the fields, and handles each eventId once.
import { db } from '../lib/db.js';
import { log } from '../lib/log.js';
import { startWorkflow, cancelWorkflow } from '../services/workflow.js';

const TRUSTED_SOURCE = 'leaveflow.requests';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['Annual', 'Sick', 'Casual', 'Unpaid'];

function validSubmitted(d) {
  return typeof d.employeeId === 'string' && d.employeeId.length > 0 && d.employeeId.length <= 100
    && typeof d.department === 'string' && d.department.length > 0 && d.department.length <= 50
    && TYPES.includes(d.leaveType) && ISO.test(d.startDate || '') && ISO.test(d.endDate || '') && d.endDate >= d.startDate
    && Number(d.workingDays) > 0 && Number(d.workingDays) <= 30
    && (!d.managerId || (typeof d.managerId === 'string' && d.managerId.length <= 100));
}

export async function handleEvent(event) {
  const type = event['detail-type'];
  const d = event.detail || {};
  const known = type === 'request.submitted' || type === 'request.cancelled';
  if (event.source !== TRUSTED_SOURCE || !known || !UUID.test(d.eventId || '') || !UUID.test(d.requestId || '')
      || (type === 'request.submitted' && !validSubmitted(d))) {
    log('warn', 'EVENT_REJECTED', { source: event.source, detailType: type, reason: 'unexpected source, type or fields' });
    return { ok: false };
  }

  const sql = await db();
  const [seen] = await sql`SELECT 1 FROM processed_events WHERE event_id = ${d.eventId}`;
  if (seen) { log('info', 'EVENT_DUPLICATE', { eventId: d.eventId }); return { ok: true, duplicate: true }; }

  // Both handlers are safe to repeat, so a failure here can simply be retried by Lambda.
  const result = type === 'request.submitted' ? await startWorkflow(d) : await cancelWorkflow(d.requestId);
  await sql`INSERT INTO processed_events (event_id) VALUES (${d.eventId}) ON CONFLICT (event_id) DO NOTHING`;
  log('info', 'EVENT_PROCESSED', { detailType: type, requestId: d.requestId, eventId: d.eventId });
  return { ok: true, ...result };
}
