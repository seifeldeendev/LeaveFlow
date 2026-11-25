// Runs one SQL file against the Neon database in .env:  node db/migrate.mjs db/003_frontend_fields.sql
// Simple statements only (split on ";" at line end); run files with DO $$ blocks in the Neon SQL editor.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) { console.error('Usage: node db/migrate.mjs <file.sql>  (needs DATABASE_URL in .env)'); process.exit(1); }
const sql = neon(process.env.DATABASE_URL);
const statements = readFileSync(file, 'utf8')
  .split(/;\s*\r?\n/)
  .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean);
for (const st of statements) {
  await sql.query(st);
  console.log('ok:', st.split('\n')[0].slice(0, 90));
}
console.log(`${file}: ${statements.length} statements applied`);
