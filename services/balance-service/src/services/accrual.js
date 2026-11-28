import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { append, audit, isMonth, LEDGER_TYPES } from './ledger.js';
import { annualAccrualRate } from './policy.js';

const DAY1 = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const KIND = 'Monthly';

function periodOf(month) {
  if (!isMonth(month)) throw new HttpError(400, 'BAD_MONTH', 'Provide a month as YYYY-MM.');
  return `${month}-01`;
}

export const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC', year: 'numeric' });
};

export function isFullMonthEligible(joinDate, month) {
  if (!joinDate) return false;
  const text = String(joinDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return text <= periodOf(month);
}

export async function listRuns(req) {
  const sql = await db();
  if (req.query.month) {
    return sql`SELECT * FROM accrual_runs WHERE period = ${periodOf(req.query.month)} ORDER BY started_at DESC`;
  }
  return sql`SELECT * FROM accrual_runs ORDER BY started_at DESC LIMIT 100`;
}

export async function runAccrual({ month, actor, directory, now = () => new Date() }) {
  const period = periodOf(month);
  if (!DAY1.test(period)) throw new HttpError(400, 'BAD_PERIOD', 'Period must be the first day of a month.');

  const rate = await annualAccrualRate();
  const sql = await db();
  const people = await directory();
  const eligible = people.filter((p) => p.id && isFullMonthEligible(p.joinDate, month));

  const claim = await sql.transaction([
    sql`INSERT INTO accrual_runs (period, kind, status, started_at)
        VALUES (${period}, ${KIND}, 'Running', now())
        ON CONFLICT (period, kind) DO NOTHING RETURNING id`,
  ]);
  const runId = claim[0]?.[0]?.id;
  if (!runId) {
    log('info', 'ACCRUAL_ALREADY_RAN', { period, kind: KIND });
    throw new HttpError(409, 'ALREADY_RAN', `${monthLabel(month)} accrual already ran. Each month runs once.`);
  }

  const started = now().getTime();
  let total = 0;
  let skipped = 0;
  try {
    for (const p of eligible) {
      const res = await append(sql, {
        employeeId: p.id, kind: 'Accrual', type: 'Annual', amount: rate,
        reason: `Monthly Annual accrual ${month}`,
        eventId: `accrual:${KIND}:${month}:${p.id}`,
        accrualRunId: runId,
        actor: { id: actor?.id || 'system', name: actor?.name || 'Balance service' },
      });
      if (!res.inserted) skipped++;
      total += Number(rate);
    }
    total = Math.round(total * 100) / 100;
    await sql`UPDATE accrual_runs SET status = 'Done', finished_at = now(),
              employees_count = ${eligible.length}, total_days = ${total}, error = null
              WHERE id = ${runId}`;
    await audit(sql, actor, 'ACCRUAL_RUN', `${month} - ${eligible.length} employees`, 'OK',
      { total, skipped }, `accrual:${KIND}:${month}`, new Date().toISOString(), 'balance-service');
    const [run] = await sql`SELECT * FROM accrual_runs WHERE id = ${runId}`;
    log('info', 'ACCRUAL_COMPLETED', { period, employees: eligible.length, total });
    return run;
  } catch (err) {
    await sql`UPDATE accrual_runs SET status = 'Failed', finished_at = now(),
              error = ${String(err.message).slice(0, 500)} WHERE id = ${runId}`;
    log('error', 'ACCRUAL_FAILED', { period, message: err.message });
    throw err;
  }
}

export async function runDetails(req) {
  const period = periodOf(req.params.month);
  const sql = await db();
  const [run] = await sql`SELECT id FROM accrual_runs WHERE period = ${period} AND kind = ${KIND}`;
  if (!run) throw new HttpError(404, 'NOT_FOUND', 'No accrual run for that month.');
  return sql`SELECT employee_id, amount, reason AS note, created_at
             FROM ledger_entries WHERE accrual_run_id = ${run.id} ORDER BY employee_id`;
}
