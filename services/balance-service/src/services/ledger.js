import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { pendingByEmployee } from './holds-repository.js';
import { loadPolicy } from './policy.js';

export const TYPES = ['Annual', 'Casual', 'Sick', 'Unpaid'];
export const LEDGER_TYPES = ['Annual', 'Casual'];
export const KINDS = ['Accrual', 'Deduction', 'Refund', 'Adjustment', 'CarryOver', 'Expiry'];
const POSITIVE_KINDS = new Set(['Accrual', 'Refund', 'CarryOver']);
const NEGATIVE_KINDS = new Set(['Deduction', 'Expiry']);
export const round = (n) => Math.round(Number(n) * 100) / 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function ledgerRows(sql, employeeId) {
  return sql`SELECT id, employee_id, leave_type, kind, amount, request_id, event_id,
                    reason, created_by, created_by_name, created_at
             FROM ledger_entries WHERE employee_id = ${employeeId}
             ORDER BY created_at, id`;
}

export async function balancesFor(sql, employeeId) {
  const rows = await sql`SELECT leave_type, balance, last_change FROM balances WHERE employee_id = ${employeeId}`;
  const current = {};
  for (const r of rows) current[r.leave_type] = round(r.balance);
  const [pending, policy] = await Promise.all([pendingByEmployee(employeeId), loadPolicy()]);

  const result = {};
  for (const type of TYPES) {
    if (type === 'Sick' || type === 'Unpaid') {
      result[type] = { taken: 0 };
    } else {
      const balance = round(current[type] || 0);
      const held = round(pending[type] || 0);
      const available = round(balance - held);
      result[type] = {
        balance,
        pending: held,
        available,
        projected: available,
        yearly: type === 'Annual' ? 21 : round(policy.casualYearly),
      };
    }
  }
  return result;
}

export async function ledgerWithRunningBalance(sql, employeeId) {
  const rows = await ledgerRows(sql, employeeId);
  const running = {};
  const out = [];
  for (const r of rows) {
    const t = r.leave_type;
    if (running[t] === undefined) running[t] = 0;
    running[t] = round(running[t] + Number(r.amount));
    out.push({
      id: r.id, kind: r.kind, type: t, amount: round(r.amount), reason: r.reason,
      reference: r.request_id || r.event_id || null,
      at: r.created_at, actor: r.created_by_name || r.created_by, balanceAfter: running[t],
    });
  }
  return out.reverse();
}

export async function append(sql, {
  employeeId, kind, type, amount, reason, requestId, eventId, accrualRunId, actor,
}) {
  if (!LEDGER_TYPES.includes(type)) {
    throw new HttpError(400, 'BAD_TYPE', 'Choose Annual or Casual.');
  }
  if (!KINDS.includes(kind)) throw new HttpError(400, 'BAD_KIND', 'Unknown ledger kind.');
  const value = round(Number(amount));
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 60) {
    throw new HttpError(400, 'BAD_AMOUNT', 'Amount must be a non-zero number between -60 and 60 days.');
  }
  if (POSITIVE_KINDS.has(kind) && value < 0) throw new HttpError(400, 'BAD_AMOUNT', `${kind} must be positive.`);
  if (NEGATIVE_KINDS.has(kind) && value > 0) throw new HttpError(400, 'BAD_AMOUNT', `${kind} must be negative.`);
  const text = String(reason || '').trim();
  if (!text || text.length > 300) throw new HttpError(400, 'REASON_REQUIRED', 'A reason (1-300 characters) is required.');
  if ((kind === 'Deduction' || kind === 'Refund') && !requestId) {
    throw new HttpError(400, 'REQUEST_REQUIRED', `${kind} requires a request_id.`);
  }
  const key = String(eventId || `adjustment:${randomKey()}`).slice(0, 200);
  const rows = await sql`
    INSERT INTO ledger_entries
      (employee_id, leave_type, kind, amount, request_id, event_id, accrual_run_id,
       reason, created_by, created_by_name)
    VALUES (${employeeId}, ${type}, ${kind}, ${value}, ${requestId || null}, ${key},
            ${accrualRunId || null}, ${text.slice(0, 300)},
            ${String(actor?.id || 'system').slice(0, 100)}, ${actor?.name ? String(actor.name).slice(0, 100) : null})
    ON CONFLICT (event_id) DO NOTHING
    RETURNING id, amount`;
  if (!rows.length) {
    log('info', 'LEDGER_DUPLICATE', { employeeId, kind, requestId, eventId: key });
    return { inserted: false };
  }
  log('info', 'LEDGER_ENTRY', { employeeId, kind, type, amount: value, requestId, eventId: key });
  return { inserted: true, entry: rows[0] };
}

function randomKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function audit(sql, actor, action, target, result, details, eventId, at, service) {
  const svc = String(service || 'balance-service');
  if (!['leave-request-service', 'approval-service', 'balance-service'].includes(svc)) {
    throw new HttpError(400, 'BAD_SERVICE', 'Unknown audit service.');
  }
  const key = String(eventId || `audit:${randomKey()}`).slice(0, 200);
  await sql`
    INSERT INTO audit_log
      (event_id, at, actor, actor_name, action, target, result, service, details)
    VALUES (${key}, ${at || new Date().toISOString()}, ${String(actor?.id || 'system').slice(0, 100)},
            ${actor?.name ? String(actor.name).slice(0, 100) : null},
            ${String(action).slice(0, 60)}, ${String(target).slice(0, 100)},
            ${String(result).slice(0, 30)}, ${svc}, ${JSON.stringify(details || {}).slice(0, 1900)}::jsonb)
    ON CONFLICT (event_id) DO NOTHING`;
  log('info', 'AUDIT', { action, target, result, actor: actor?.id });
}

export const isUuid = (v) => UUID.test(String(v || ''));
export const isMonth = (v) => MONTH.test(String(v || ''));
export const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
