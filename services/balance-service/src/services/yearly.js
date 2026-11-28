import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { append, audit, round } from './ledger.js';
import { pendingByEmployee } from './holds-repository.js';
import { loadPolicy } from './policy.js';
import { isFullMonthEligible } from './accrual.js';

const YEAR = /^\d{4}$/;
const KIND = 'YearEnd';

function periodOf(year, month) {
  if (!YEAR.test(String(year))) throw new HttpError(400, 'BAD_YEAR', 'Provide a year as YYYY.');
  return `${year}-${month}-01`;
}

async function claimRun(sql, period, actor, label) {
  const claim = await sql.transaction([
    sql`INSERT INTO accrual_runs (period, kind, status, started_at)
        VALUES (${period}, ${KIND}, 'Running', now())
        ON CONFLICT (period, kind) DO NOTHING RETURNING id`,
  ]);
  const id = claim[0]?.[0]?.id;
  if (!id) {
    log('info', 'YEARLY_RUN_ALREADY_RAN', { period, kind: KIND, label });
    throw new HttpError(409, 'ALREADY_RAN', `${label} already ran for ${period}.`);
  }
  return id;
}

async function finishRun(sql, runId, status, employeesCount, total, err) {
  await sql`UPDATE accrual_runs SET status = ${status}, finished_at = now(),
            employees_count = ${employeesCount}, total_days = ${total}, error = ${err || null}
            WHERE id = ${runId}`;
}

function eligiblePeople(people, month) {
  return people.filter((p) => p.id && isFullMonthEligible(p.joinDate, month));
}

async function ledgerBalance(sql, employeeId, leaveType) {
  const [row] = await sql`SELECT balance FROM balances
                          WHERE employee_id = ${employeeId} AND leave_type = ${leaveType}`;
  return round(row?.balance || 0);
}

export async function runCasualGrant({ year, actor, directory }) {
  const period = periodOf(year, '01');
  const policy = await loadPolicy();
  const sql = await db();
  const eligible = eligiblePeople(await directory(), `${year}-01`);

  const runId = await claimRun(sql, period, actor, 'Casual yearly grant');
  let total = 0;
  let skipped = 0;
  try {
    for (const p of eligible) {
      const res = await append(sql, {
        employeeId: p.id, kind: 'Accrual', type: 'Casual', amount: policy.casualYearly,
        reason: `Casual yearly allowance ${year}`,
        eventId: `casual-grant:${KIND}:${year}:${p.id}`,
        accrualRunId: runId,
        actor: { id: actor?.id || 'system', name: actor?.name || 'Balance service' },
      });
      if (!res.inserted) skipped++;
      total += Number(policy.casualYearly);
    }
    total = round(total);
    await finishRun(sql, runId, 'Done', eligible.length, total, null);
    await audit(sql, actor, 'CASUAL_GRANT', `${year} - ${eligible.length} employees`, 'OK',
      { total, skipped }, `casual-grant:${KIND}:${year}`, new Date().toISOString(), 'balance-service');
    log('info', 'CASUAL_GRANT_COMPLETED', { period, employees: eligible.length, total });
    const [run] = await sql`SELECT * FROM accrual_runs WHERE id = ${runId}`;
    return run;
  } catch (err) {
    await finishRun(sql, runId, 'Failed', eligible.length, 0, String(err.message).slice(0, 500));
    throw err;
  }
}

export async function runYearEnd({ year, actor, directory }) {
  const period = periodOf(year, '12');
  const policy = await loadPolicy();
  const sql = await db();
  const eligible = eligiblePeople(await directory(), `${year}-12`);

  const runId = await claimRun(sql, period, actor, 'Year-end expiry and carry-over');
  let expiredCasual = 0;
  let carriedAnnual = 0;
  let skipped = 0;
  try {
    for (const p of eligible) {
      const pending = await pendingByEmployee(p.id);

      const casualAvailable = round((await ledgerBalance(sql, p.id, 'Casual')) - round(pending.Casual || 0));
      if (casualAvailable > 0) {
        const res = await append(sql, {
          employeeId: p.id, kind: 'Expiry', type: 'Casual', amount: -casualAvailable,
          reason: `Unused Casual leave expired 31 December ${year}`,
          eventId: `casual-expiry:${KIND}:${year}:${p.id}`,
          accrualRunId: runId,
          actor: { id: actor?.id || 'system', name: actor?.name || 'Balance service' },
        });
        if (res.inserted) expiredCasual = round(expiredCasual + casualAvailable);
        else skipped++;
      }

      const annualAvailable = round((await ledgerBalance(sql, p.id, 'Annual')) - round(pending.Annual || 0));
      const carry = round(Math.min(annualAvailable > 0 ? annualAvailable : 0, policy.carryoverCap));
      if (carry > 0) {
        const res = await append(sql, {
          employeeId: p.id, kind: 'CarryOver', type: 'Annual', amount: carry,
          reason: `Annual carry-over to ${Number(year) + 1} (cap ${policy.carryoverCap})`,
          eventId: `annual-carryover:${KIND}:${year}:${p.id}`,
          accrualRunId: runId,
          actor: { id: actor?.id || 'system', name: actor?.name || 'Balance service' },
        });
        if (res.inserted) carriedAnnual = round(carriedAnnual + carry);
        else skipped++;
      }
    }
    const total = round(expiredCasual + carriedAnnual);
    await finishRun(sql, runId, 'Done', eligible.length, total, null);
    await audit(sql, actor, 'YEAR_END_RUN', `${year} - ${eligible.length} employees`, 'OK',
      { expiredCasual, carriedAnnual, skipped }, `year-end:${KIND}:${year}`, new Date().toISOString(), 'balance-service');
    log('info', 'YEAR_END_COMPLETED', { period, employees: eligible.length, expiredCasual, carriedAnnual });
    const [run] = await sql`SELECT * FROM accrual_runs WHERE id = ${runId}`;
    return run;
  } catch (err) {
    await finishRun(sql, runId, 'Failed', eligible.length, 0, String(err.message).slice(0, 500));
    throw err;
  }
}
