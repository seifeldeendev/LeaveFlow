\set ON_ERROR_STOP 1
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'balances_app') THEN
    RAISE EXCEPTION 'balances_app does not exist; create it with CREATE ROLE balances_app LOGIN PASSWORD ... first';
  END IF;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO balances_app', current_database());
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM balances_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM balances_app;
GRANT USAGE ON SCHEMA public TO balances_app;

GRANT SELECT, INSERT                 ON ledger_entries   TO balances_app;
GRANT SELECT, INSERT, DELETE         ON pending_holds    TO balances_app;
GRANT SELECT, INSERT                 ON audit_log        TO balances_app;
GRANT SELECT, INSERT, UPDATE         ON accrual_runs     TO balances_app;
GRANT SELECT, INSERT                 ON processed_events TO balances_app;
GRANT SELECT                         ON balances         TO balances_app;

DO $$ DECLARE t text; s text; BEGIN
  FOREACH t IN ARRAY ARRAY['public.ledger_entries', 'public.audit_log', 'public.accrual_runs'] LOOP
    s := pg_get_serial_sequence(t, 'id');
    IF s IS NOT NULL THEN EXECUTE format('GRANT USAGE ON SEQUENCE %s TO balances_app', s); END IF;
  END LOOP;
END $$;
COMMIT;
