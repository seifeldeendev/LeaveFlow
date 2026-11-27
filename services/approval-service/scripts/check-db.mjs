// Read-only check of the approval database: who we connect as, and which tables already exist.
// Usage: node scripts/check-db.mjs
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is missing in .env'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const [me] = await sql.query('select current_user as "user", current_database() as "database"');
console.log('Connected as:', me.user, '| database:', me.database);
const tables = await sql.query(`
  select table_name, string_agg(column_name, ', ' order by ordinal_position) as columns
  from information_schema.columns where table_schema = 'public'
  group by table_name order by table_name`);
if (!tables.length) console.log('No tables yet.');
for (const t of tables) console.log(`\n${t.table_name}:\n  ${t.columns}`);
const [can] = await sql.query(`select has_schema_privilege(current_user, 'public', 'CREATE') as can_create`);
console.log('\nCan create tables:', can.can_create);
