-- Least privilege for the app's database role. Run in the Neon SQL editor as the project owner,
-- only if the tables were created by the owner (not by approvals_app itself).
-- approvals_app may read and write rows, but never DROP, ALTER or CREATE anything.
REVOKE CREATE ON SCHEMA public FROM approvals_app;
GRANT USAGE ON SCHEMA public TO approvals_app;
GRANT SELECT, INSERT, UPDATE         ON approval_tasks   TO approvals_app;
GRANT SELECT, INSERT, UPDATE         ON approval_steps   TO approvals_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications    TO approvals_app;  -- DELETE /notifications/{id}
GRANT SELECT, INSERT                 ON processed_events TO approvals_app;  -- never edited or deleted
