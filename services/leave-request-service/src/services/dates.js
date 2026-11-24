// Dates are plain 'YYYY-MM-DD' strings; all arithmetic is done in UTC to avoid timezone shifts.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
import { cfg } from '../lib/config.js';

export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const toDate = (s) => new Date(`${s}T00:00:00Z`);
export const toIso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timeZone }).format(new Date());

export function* eachDay(start, end) {
  for (let d = toDate(start); d <= toDate(end); d.setUTCDate(d.getUTCDate() + 1)) yield toIso(d);
}
export const isWeekend = (s) => [5, 6].includes(toDate(s).getUTCDay()); // Friday and Saturday in Egypt

// Neon returns DATE columns as local-midnight Date objects; read them back with local getters.
export function dateCol(v) {
  if (v == null || typeof v === 'string') return v;
  const p = (n) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}
