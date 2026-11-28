import { neon } from '@neondatabase/serverless';
import { getDatabaseUrl } from './secrets.js';

let sqlFn;
export function setTestSql(fn) { sqlFn = fn; }

export async function db() {
  if (!sqlFn) sqlFn = neon(await getDatabaseUrl());
  return sqlFn;
}
