// Team coverage check: how many people in the department would be off on each working day
// if this request is approved. Above 30% blocks a manager's approval, above 20% warns.
// A single person is never blocked on their own: the rule only applies when others are already off.
import { cfg } from '../lib/config.js';
import { db } from '../lib/db.js';
import { departmentMembers } from '../lib/directory.js';

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isWeekend = (iso) => [5, 6].includes(new Date(iso + 'T00:00:00Z').getUTCDay()); // Friday, Saturday

export function workingDates(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (!isWeekend(d)) out.push(d);
  return out;
}

// task: { request_id, department, start_date, end_date } with dates as 'YYYY-MM-DD'
export async function coverage(task) {
  const sql = await db();
  const members = await departmentMembers(task.department);
  const teamSize = Math.max(members.length, 1);
  const others = await sql`
    SELECT employee_id, employee_name, start_date::text AS start_date, end_date::text AS end_date
    FROM approval_tasks
    WHERE department = ${task.department} AND status = 'Approved' AND request_id <> ${task.request_id}
      AND start_date <= ${task.end_date} AND end_date >= ${task.start_date}`;

  let worst = { date: task.start_date, off: 1, pct: Math.round(100 / teamSize), names: [] };
  const perDay = workingDates(task.start_date, task.end_date).map((date) => {
    const off = others.filter((o) => o.start_date <= date && o.end_date >= date);
    const n = off.length + 1;
    const row = { date, off: n, pct: Math.round((n / teamSize) * 100), names: off.map((o) => o.employee_name || 'Colleague') };
    if (row.pct > worst.pct || (row.pct === worst.pct && row.names.length > worst.names.length)) worst = row;
    return row;
  });
  const othersOff = worst.names.length > 0;
  const level = othersOff && worst.pct > cfg.coverageBlockPct ? 'block' : othersOff && worst.pct > cfg.coverageWarnPct ? 'warn' : 'ok';
  return { teamSize, perDay, worst, level };
}
