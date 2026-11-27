// Read-only: column types, defaults, keys, CHECK rules and privileges of the approval tables.
// Usage: node scripts/check-db-details.mjs
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const cols = await sql.query(`
  select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns where table_schema = 'public'
  order by table_name, ordinal_position`);
let last = '';
for (const c of cols) {
  if (c.table_name !== last) { console.log(`\n== ${c.table_name}`); last = c.table_name; }
  console.log(`  ${c.column_name} ${c.data_type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default ? ' DEFAULT ' + c.column_default : ''}`);
}
console.log('\n== constraints');
const cons = await sql.query(`
  select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
  from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`);
for (const c of cons) console.log(`  ${c.tbl}: ${c.def}`);
console.log('\n== indexes');
const idx = await sql.query(`select tablename, indexdef from pg_indexes where schemaname = 'public' order by 1`);
for (const i of idx) console.log(`  ${i.indexdef}`);
console.log('\n== my privileges');
const priv = await sql.query(`
  select table_name, string_agg(privilege_type, ', ' order by privilege_type) as p
  from information_schema.role_table_grants where grantee = current_user group by 1 order by 1`);
for (const p of priv) console.log(`  ${p.table_name}: ${p.p}`);
const rows = await sql.query(`select (select count(*) from approval_tasks) as tasks, (select count(*) from approval_steps) as steps, (select count(*) from notifications) as notifications`);
console.log('\n== rows', rows[0]);
