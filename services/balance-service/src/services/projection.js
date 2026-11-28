import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { balancesFor, LEDGER_TYPES, round } from './ledger.js';

export async function projection(payload) {
  const employeeId = String(payload?.employeeId || '');
  const leaveType = String(payload?.leaveType || '');
  if (!employeeId || employeeId.length > 100 || !LEDGER_TYPES.includes(leaveType)) {
    throw new HttpError(400, 'BAD_INPUT', 'employeeId and an Annual/Casual leaveType are required.');
  }
  const sql = await db();
  const balances = await balancesFor(sql, employeeId);
  const value = round(Number(balances[leaveType]?.available));
  if (!Number.isFinite(value)) {
    throw new HttpError(503, 'BALANCE_UNAVAILABLE', 'Balance could not be computed.');
  }
  return { available: value };
}
