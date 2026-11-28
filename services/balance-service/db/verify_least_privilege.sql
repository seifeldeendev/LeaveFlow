WITH expected(tbl, priv, allowed) AS (VALUES
  ('ledger_entries', 'SELECT', true),
  ('ledger_entries', 'INSERT', true),
  ('pending_holds', 'SELECT', true),
  ('pending_holds', 'INSERT', true),
  ('pending_holds', 'DELETE', true),
  ('audit_log', 'SELECT', true),
  ('audit_log', 'INSERT', true),
  ('accrual_runs', 'SELECT', true),
  ('accrual_runs', 'INSERT', true),
  ('accrual_runs', 'UPDATE', true),
  ('processed_events', 'SELECT', true),
  ('processed_events', 'INSERT', true),
  ('balances', 'SELECT', true)
),
privs AS (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv),
matrix AS (
  SELECT t.tbl, p.priv, COALESCE(e.allowed, false) AS allowed,
         has_table_privilege(current_user, 'public.' || t.tbl, p.priv) AS actual
  FROM (SELECT DISTINCT tbl FROM expected) t CROSS JOIN privs p
  LEFT JOIN expected e ON e.tbl = t.tbl AND e.priv = p.priv
),
checks AS (
  SELECT 'table ' || tbl || ' ' || priv AS check_name, CASE WHEN allowed THEN 'granted' ELSE 'not granted' END AS expected,
         CASE WHEN actual THEN 'granted' ELSE 'not granted' END AS actual, (allowed = actual) AS ok FROM matrix
  UNION ALL SELECT 'role is not superuser', 'false', r.rolsuper::text, NOT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user
  UNION ALL SELECT 'role cannot create roles', 'false', r.rolcreaterole::text, NOT r.rolcreaterole FROM pg_roles r WHERE r.rolname = current_user
  UNION ALL SELECT 'role cannot create databases', 'false', r.rolcreatedb::text, NOT r.rolcreatedb FROM pg_roles r WHERE r.rolname = current_user
  UNION ALL SELECT 'role does not bypass RLS', 'false', r.rolbypassrls::text, NOT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user
  UNION ALL SELECT 'role owns no table, view or sequence', '0', count(*)::text, count(*) = 0
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE pg_get_userbyid(c.relowner) = current_user AND n.nspname NOT IN ('pg_catalog','information_schema')
  UNION ALL SELECT 'role does not own this database', 'false', (pg_get_userbyid(d.datdba) = current_user)::text, pg_get_userbyid(d.datdba) <> current_user FROM pg_database d WHERE d.datname = current_database()
  UNION ALL SELECT 'no CREATE on schema public (no DDL)', 'false', has_schema_privilege(current_user, 'public', 'CREATE')::text, NOT has_schema_privilege(current_user, 'public', 'CREATE')
  UNION ALL SELECT 'not a member of neon_superuser', 'false',
            COALESCE((SELECT pg_has_role(current_user, 'neon_superuser', 'MEMBER') FROM pg_roles WHERE rolname = 'neon_superuser'), false)::text,
            NOT COALESCE((SELECT pg_has_role(current_user, 'neon_superuser', 'MEMBER') FROM pg_roles WHERE rolname = 'neon_superuser'), false)
  UNION ALL SELECT 'not a member of the table owner role', 'false',
            bool_or(pg_has_role(current_user, c.relowner, 'MEMBER'))::text, NOT bool_or(pg_has_role(current_user, c.relowner, 'MEMBER'))
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
)
SELECT current_user AS app_role, current_database() AS db, check_name, expected, actual, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY ok, check_name;
