import { db } from '../lib/db.js';
import { log } from '../lib/log.js';
import { isUuid } from '../services/ledger.js';

const TRUSTED = new Set(['leaveflow.requests', 'leaveflow.approvals']);
const SERVICES = new Set(['leave-request-service', 'approval-service', 'balance-service']);

export async function handleAuditEvent(event) {
  const type = event['detail-type'];
  const d = event.detail || {};
  if (type !== 'audit' || !TRUSTED.has(event.source)
      || !isUuid(d.eventId)
      || typeof d.actor !== 'string' || !d.actor || d.actor.length > 100
      || typeof d.action !== 'string' || !d.action || d.action.length > 60
      || typeof d.service !== 'string' || !SERVICES.has(d.service)
      || typeof d.at !== 'string' || Number.isNaN(Date.parse(d.at))) {
    log('warn', 'AUDIT_EVENT_REJECTED', { source: event.source, detailType: type, reason: 'unexpected source, type or fields' });
    return { ok: false };
  }
  const sql = await db();
  try {
    await sql`
      INSERT INTO audit_log
        (event_id, at, actor, actor_name, action, target, result, service, details)
      VALUES (${d.eventId}, ${d.at}, ${d.actor.slice(0, 100)},
              ${d.actorName ? String(d.actorName).slice(0, 100) : null},
              ${d.action.slice(0, 60)}, ${String(d.requestId || d.service).slice(0, 100)},
              ${'OK'}, ${d.service}, ${JSON.stringify({ source: event.source, detail: d }).slice(0, 1900)}::jsonb)
      ON CONFLICT (event_id) DO NOTHING`;
    const claim = await sql`
      INSERT INTO processed_events (event_id) VALUES (${d.eventId})
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
    if (!claim.length) {
      log('info', 'AUDIT_EVENT_DUPLICATE', { eventId: d.eventId });
      return { ok: true, duplicate: true };
    }
    log('info', 'AUDIT_EVENT_PROCESSED', { action: d.action, service: d.service, eventId: d.eventId });
    return { ok: true };
  } catch (err) {
    log('error', 'AUDIT_EVENT_FAILED', { eventId: d.eventId, message: err.message });
    throw err;
  }
}

export async function handleAuditQueue(event) {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  let ok = 0;
  for (const record of records) {
    let envelope;
    try { envelope = JSON.parse(record.body); } catch (err) {
      log('error', 'AUDIT_BAD_ENVELOPE', { message: err.message });
      throw err;
    }
    const result = await handleAuditEvent(envelope);
    if (!result.ok) throw new Error(`Audit event rejected: ${envelope?.['detail-type']}`);
    ok++;
  }
  log('info', 'AUDIT_QUEUE_BATCH_DONE', { ok });
  return { ok };
}
