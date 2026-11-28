import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { LEDGER_TYPES, isUuid, round } from './ledger.js';
import { log } from '../lib/log.js';

let injected;
export function setHoldsRepository(fn) { injected = fn; }

export async function pendingByEmployee(employeeId) {
  const sql = await db();
  if (injected) return injected.pendingByEmployee(employeeId);
  const rows = await sql`SELECT leave_type, SUM(days) AS days FROM pending_holds
                         WHERE employee_id = ${employeeId} GROUP BY leave_type`;
  const out = {};
  for (const r of rows) out[r.leave_type] = round(r.days);
  return out;
}

export async function createHold({ requestId, employeeId, leaveType, workingDays }) {
  if (!isUuid(requestId)) throw new HttpError(400, 'BAD_REQUEST_ID', 'A valid request UUID is required.');
  if (!LEDGER_TYPES.includes(leaveType)) {
    throw new HttpError(400, 'BAD_TYPE', 'pending_holds only supports Annual and Casual.');
  }
  const days = round(Number(workingDays));
  if (!Number.isFinite(days) || days <= 0 || days > 30) {
    throw new HttpError(400, 'BAD_AMOUNT', 'Hold days must be between 0 and 30.');
  }
  if (injected) return injected.createHold({ requestId, employeeId, leaveType, workingDays: days });
  const sql = await db();
  await sql`
    INSERT INTO pending_holds (request_id, employee_id, leave_type, days)
    VALUES (${requestId}, ${String(employeeId).slice(0, 100)}, ${leaveType}, ${days})
    ON CONFLICT (request_id) DO NOTHING`;
  log('info', 'HOLD_CREATED', { requestId, employeeId, leaveType, days });
}

export async function releaseHold(requestId, releasedBy) {
  if (!isUuid(requestId)) throw new HttpError(400, 'BAD_REQUEST_ID', 'A valid request UUID is required.');
  if (injected) return injected.releaseHold(requestId, releasedBy);
  const sql = await db();
  const rows = await sql`DELETE FROM pending_holds WHERE request_id = ${requestId} RETURNING request_id`;
  if (rows.length)   log('info', 'HOLD_RELEASED', { requestId, releasedBy });
}

