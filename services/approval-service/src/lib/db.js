import { neon } from '@neondatabase/serverless';
import { getDatabaseUrl } from './secrets.js';

let sqlFn;
// Usage: const sql = await db(); await sql`SELECT ... WHERE id = ${id}`  (values are always parameterised)
export async function db() {
  if (!sqlFn) sqlFn = neon(await getDatabaseUrl());
  return sqlFn;
}
