import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not present in services/balance-service/.env — waiting for rotated credentials.');
  process.exit(2);
}

const sql = neon(process.env.DATABASE_URL);

const title = (s) => console.log(`\n== ${s}`);
const show = (rows) => {
  for (const r of rows) console.log('  ' + JSON.stringify(r));
};

try {
  const [db] = await sql.query("select current_database() as database, current_user as \"user\", version() as version");
  console.log(`Connected database: ${db.database} | user: ${db.user}`);
  if (db.database !== 'leaveflow_balances') {
    console.error(`WRONG DATABASE: expected leaveflow_balances, got ${db.database}. Refusing to inspect.`);
    process.exit(3);
  }

  title('privileges (metadata only)');
  show(await sql.query(`select has_schema_privilege(current_user, 'information_schema', 'USAGE') as info_schema_usage,
                               has_schema_privilege(current_user, 'pg_catalog', 'USAGE') as pg_catalog_usage,
                               has_schema_privilege(current_user, 'public', 'USAGE') as public_usage`));

  title('tables (public)');
  show(await sql.query(`select table_name, table_type from information_schema.tables
                        where table_schema = 'public' order by table_name`));

  title('columns: pending_holds / employee_balances / balance_ledger / processed_events / balance_audit');
  show(await sql.query(`select table_name, ordinal_position, column_name, data_type,
                               is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
                        from information_schema.columns
                        where table_schema = 'public'
                          and table_name in ('pending_holds','employee_balances','balance_ledger','processed_events','balance_audit')
                        order by table_name, ordinal_position`));

  title('primary keys and unique constraints');
  show(await sql.query(`select conrelid::regclass::text as tbl, conname, contype, pg_get_constraintdef(oid) as def
                        from pg_constraint
                        where connamespace = 'public'::regnamespace and contype in ('p','u')
                        order by 1, 2`));

  title('foreign keys');
  show(await sql.query(`select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
                        from pg_constraint
                        where connamespace = 'public'::regnamespace and contype = 'f'
                        order by 1, 2`));

  title('check constraints');
  show(await sql.query(`select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
                        from pg_constraint
                        where connamespace = 'public'::regnamespace and contype = 'c'
                        order by 1, 2`));

  title('indexes');
  show(await sql.query(`select tablename, indexname, indexdef from pg_indexes
                        where schemaname = 'public' order by tablename, indexname`));

  title('table privileges for current user');
  show(await sql.query(`select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
                        from information_schema.role_table_grants
                        where grantee = current_user and table_schema = 'public'
                        group by table_name order by table_name`));

  console.log('\nInspection complete. No data rows were read and no changes were made.');
} catch (err) {
  console.error(`Inspection failed: ${err?.name || 'Error'} (details withheld to protect credentials).`);
  process.exit(1);
}
