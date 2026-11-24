// Egyptian public holidays from Nager.Date, cached per year in Neon so we call the API once a year.
import { db } from '../lib/db.js';
import { cfg } from '../lib/config.js';
import { log } from '../lib/log.js';
import { dateCol } from './dates.js';

async function loadYear(sql, year) {
  const rows = await sql`SELECT holiday_date, name FROM holidays WHERE year = ${year}`;
  if (rows.length) return rows.map((r) => ({ date: dateCol(r.holiday_date), name: r.name }));
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cfg.holidayCountry}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Nager.Date status ${res.status}`);
    const list = (await res.json())
      .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
      .map((h) => ({ date: h.date, name: String(h.localName || h.name).slice(0, 100) }));
    if (list.length) {
      await sql.transaction(list.map((h) =>
        sql`INSERT INTO holidays (holiday_date, name, year) VALUES (${h.date}, ${h.name}, ${year}) ON CONFLICT DO NOTHING`));
    }
    return list;
  } catch (err) {
    // Fail open on holidays only: the request still counts weekends, and we log it for the report.
    log('warn', 'HOLIDAYS_UNAVAILABLE', { year, message: err.message });
    return [];
  }
}

export async function holidaysBetween(start, end) {
  const sql = await db();
  const years = [...new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))])];
  const all = (await Promise.all(years.map((y) => loadYear(sql, y)))).flat();
  return all.filter((h) => h.date >= start && h.date <= end);
}
