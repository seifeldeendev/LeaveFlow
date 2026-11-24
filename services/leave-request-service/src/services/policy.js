// The policy engine: decides whether a leave request is allowed. Used by submit and by the live preview.
// Returns every rule with ok / not ok, in the shape the frontend's preview shows:
//   { days, skipped:[{date,why}], checks:[{ok,label,detail}], info:[...], available, certificateRequired }
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { isIsoDate, eachDay, isWeekend, today, addDays, dateCol } from './dates.js';
import { holidaysBetween } from './holidays.js';
import { projectedBalance } from './balance.js';

export const LEAVE_TYPES = ['Annual', 'Sick', 'Casual', 'Unpaid'];
const MAX_AHEAD_DAYS = 365;
const HR_STEP_OVER_DAYS = 5;

export function validateInput({ type, start, end, reason }) {
  const errors = [];
  if (!LEAVE_TYPES.includes(type)) errors.push(`type must be one of ${LEAVE_TYPES.join(', ')}`);
  if (!isIsoDate(start)) errors.push('start must be a real date in YYYY-MM-DD format');
  if (!isIsoDate(end)) errors.push('end must be a real date in YYYY-MM-DD format');
  if (isIsoDate(start) && isIsoDate(end) && end < start) errors.push('end cannot be before start');
  if (reason != null && (typeof reason !== 'string' || reason.length > 500)) errors.push('reason must be text of at most 500 characters');
  if (errors.length) throw new HttpError(400, 'VALIDATION_ERROR', errors.join('; '));
}

export async function getRule(type) {
  const sql = await db();
  const [rule] = await sql`SELECT * FROM policy_rules WHERE leave_type = ${type}`;
  if (!rule) throw new HttpError(500, 'POLICY_MISSING', `No policy configured for ${type}`);
  return rule;
}

export async function countWorkingDays(start, end) {
  const holidays = await holidaysBetween(start, end);
  const byDate = new Map(holidays.map((h) => [h.date, h.name]));
  let days = 0; const skipped = [];
  for (const d of eachDay(start, end)) {
    if (isWeekend(d)) skipped.push({ date: d, why: 'Weekend' });
    else if (byDate.has(d)) skipped.push({ date: d, why: byDate.get(d) });
    else days += 1;
  }
  return { days, skipped };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export async function evaluate(user, { type, start, end }, { ignoreId = null } = {}) {
  const sql = await db();
  const rule = await getRule(type);
  const now = today();
  const checks = [];
  const add = (ok, label, detail) => checks.push({ ok: Boolean(ok), label, detail: detail || 'OK' });

  const { days, skipped } = await countWorkingDays(start, end);
  add(days > 0, 'At least one working day',
    days ? `${plural(days, 'working day')} (Fri, Sat and public holidays not counted)` : 'Range has only weekends or holidays');

  const lead = daysBetween(now, start);
  if (rule.notice_days === 0 && rule.backdate_days > 0) {
    add(lead >= -rule.backdate_days, `${type} leave filed within ${rule.backdate_days} days`,
      lead >= -rule.backdate_days ? 'OK' : `${type} leave must be filed within ${rule.backdate_days} days of the first day`);
  } else {
    add(lead >= rule.notice_days, `Notice period (${plural(rule.notice_days, 'day')})`,
      lead >= rule.notice_days ? `Submitted ${plural(lead, 'day')} ahead`
        : `Starts in ${plural(Math.max(lead, 0), 'day')}; ${type} leave needs ${plural(rule.notice_days, 'day')}' notice`);
  }
  add(start <= addDays(now, MAX_AHEAD_DAYS), 'Within one year ahead', start <= addDays(now, MAX_AHEAD_DAYS) ? 'OK' : 'Requests can be made at most one year ahead');
  add(days <= rule.max_consecutive_days, `Max ${rule.max_consecutive_days} consecutive working days`,
    days <= rule.max_consecutive_days ? 'OK' : `${days} days is over the limit for ${type} leave`);

  if (type !== 'Sick') {
    const [bo] = await sql`
      SELECT start_date, end_date, reason FROM blackout_dates
      WHERE daterange(start_date, end_date, '[]') && daterange(${start}::date, ${end}::date, '[]')
        AND (department IS NULL OR department = ${user.department ?? ''})
      LIMIT 1`;
    add(!bo, 'No blackout dates', bo ? `${bo.reason} (${dateCol(bo.start_date)} to ${dateCol(bo.end_date)}) blocks ${user.department || 'everyone'}` : 'OK');
  }

  const [ov] = await sql`
    SELECT id, status FROM leave_requests
    WHERE employee_id = ${user.id} AND status IN ('Pending', 'Approved')
      AND (${ignoreId}::uuid IS NULL OR id <> ${ignoreId}::uuid)
      AND daterange(start_date, end_date, '[]') && daterange(${start}::date, ${end}::date, '[]')
    LIMIT 1`;
  add(!ov, 'No overlap with your requests', ov ? `Overlaps a ${ov.status.toLowerCase()} request (${ov.id.slice(0, 8)})` : 'OK');

  let available = null;
  if (rule.uses_balance && days > 0) {
    available = await projectedBalance(user.id, type);
    if (available === null) add(true, `Enough ${type} balance`, 'Not checked: the balance service is not connected yet');
    else add(days <= available, `Enough ${type} balance`, `Projected ${available} days after pending requests, needs ${days}`);
  }

  const certificateRequired = rule.certificate_over_days != null && days > rule.certificate_over_days;
  const info = [];
  if (certificateRequired) info.push(`${type} leave over ${plural(rule.certificate_over_days, 'day')} needs a medical certificate before it can be approved.`);
  if (type === 'Unpaid' || days > HR_STEP_OVER_DAYS) info.push(`Over ${HR_STEP_OVER_DAYS} working days or Unpaid: HR approves as a second step after your manager.`);

  return { days, workingDays: days, skipped, checks, info, available, certificateRequired };
}
