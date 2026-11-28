import { db } from '../lib/db.js';
import { log } from '../lib/log.js';
import { append, audit, isUuid, isIsoDate, LEDGER_TYPES, TYPES } from '../services/ledger.js';
import { createHold, releaseHold } from '../services/holds-repository.js';

const TRUSTED = {
  'leaveflow.requests': ['request.submitted', 'request.cancelled'],
  'leaveflow.approvals': ['request.approved', 'request.rejected'],
};

function validDetail(d, type) {
  return isUuid(d.eventId) && isUuid(d.requestId)
    && typeof d.employeeId === 'string' && d.employeeId.length > 0 && d.employeeId.length <= 100
    && TYPES.includes(d.leaveType)
    && isIsoDate(d.startDate) && isIsoDate(d.endDate) && d.endDate >= d.startDate
    && Number(d.workingDays) > 0 && Number(d.workingDays) <= 30
    && (type !== 'request.cancelled' || ['Pending', 'Approved'].includes(d.previousStatus));
}

export async function handleEvent(event) {
  const type = event['detail-type'];
  const d = event.detail || {};
  if (!TRUSTED[event.source]?.includes(type) || !validDetail(d, type)) {
    log('warn', 'EVENT_REJECTED', { source: event.source, detailType: type, reason: 'unexpected source, type or fields' });
    return { ok: false };
  }
  const sql = await db();

  try {
    const affectsBalance = LEDGER_TYPES.includes(d.leaveType);
    if (affectsBalance && type === 'request.submitted') {
      await createHold({
        requestId: d.requestId, employeeId: d.employeeId,
        leaveType: d.leaveType, workingDays: Number(d.workingDays),
      });
    } else if (affectsBalance) {
      if (type === 'request.approved') {
        await releaseHold(d.requestId, d.eventId);
        await append(sql, {
          employeeId: d.employeeId, kind: 'Deduction', type: d.leaveType,
          amount: -Number(d.workingDays), reason: `Approved leave request ${d.requestId}`,
          requestId: d.requestId, eventId: d.eventId,
          actor: { id: d.decidedBy || 'approval-service', name: d.decidedByName || 'Approval service' },
        });
      }
      if (type === 'request.rejected') {
        await releaseHold(d.requestId, d.eventId);
      }
      if (type === 'request.cancelled') {
        await releaseHold(d.requestId, d.eventId);
        if (d.previousStatus === 'Approved') {
          const [deducted] = await sql`SELECT 1 FROM ledger_entries
               WHERE request_id = ${d.requestId} AND kind = 'Deduction'`;
          if (deducted) {
            await append(sql, {
              employeeId: d.employeeId, kind: 'Refund', type: d.leaveType,
              amount: Number(d.workingDays), reason: `Approved request ${d.requestId} cancelled`,
              requestId: d.requestId, eventId: `refund:${d.eventId}`,
              actor: { id: d.decidedBy || 'requests-service', name: d.decidedByName || 'Requests service' },
            });
          }
        }
      }
    }
    await audit(sql,
      { id: d.decidedBy || 'system', name: d.decidedByName || 'Integration' },
      `EVENT_${type.toUpperCase()}`, d.requestId, 'OK',
      { leaveType: d.leaveType, workingDays: Number(d.workingDays) },
      d.eventId, d.at || new Date().toISOString(), 'balance-service');

    const claim = await sql`
      INSERT INTO processed_events (event_id) VALUES (${d.eventId})
      ON CONFLICT (event_id) DO NOTHING RETURNING event_id`;
    if (!claim.length) {
      log('info', 'EVENT_DUPLICATE', { eventId: d.eventId, detailType: type });
      return { ok: true, duplicate: true };
    }
    log('info', 'EVENT_PROCESSED', { detailType: type, requestId: d.requestId, eventId: d.eventId });
    return { ok: true };
  } catch (err) {
    log('error', 'EVENT_FAILED', { detailType: type, requestId: d.requestId, eventId: d.eventId, message: err.message });
    throw err;
  }
}

export async function handleQueue(event) {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  let ok = 0;
  for (const record of records) {
    let envelope;
    try { envelope = JSON.parse(record.body); } catch (err) {
      log('error', 'EVENT_BAD_ENVELOPE', { message: err.message });
      throw err;
    }
    const result = await handleEvent(envelope);
    if (!result.ok) throw new Error(`Event rejected: ${envelope?.['detail-type']}`);
    ok++;
  }
  log('info', 'QUEUE_BATCH_DONE', { ok });
  return { ok };
}
