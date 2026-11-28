REVOKE CREATE ON SCHEMA public FROM balances_app;
GRANT USAGE ON SCHEMA public TO balances_app;
GRANT SELECT, INSERT, UPDATE         ON employee_balances    TO balances_app;
GRANT SELECT, INSERT                ON balance_ledger       TO balances_app;
GRANT SELECT, INSERT                ON processed_events     TO balances_app;
GRANT SELECT, INSERT, UPDATE        ON accrual_runs         TO balances_app;
GRANT SELECT, INSERT                ON accrual_run_details  TO balances_app;
GRANT SELECT                        ON balance_policies     TO balances_app;
GRANT SELECT, INSERT                ON balance_audit        TO balances_app;
