-- Least privilege for the app's database role. Run in the Neon SQL editor as the project owner.
-- approvals_app may read and write rows, but never DROP, ALTER or CREATE anything,
-- and may only DELETE where the API really deletes something (notifications).
REVOKE CREATE ON SCHEMA public FROM approvals_app;
GRANT USAGE ON SCHEMA public TO approvals_app;
REVOKE DELETE ON approval_tasks, approval_steps, processed_events FROM approvals_app;
REVOKE UPDATE ON processed_events FROM approvals_app;
GRANT SELECT, INSERT, UPDATE         ON approval_tasks, approval_steps, delegations TO approvals_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications    TO approvals_app;  -- DELETE /notifications/{id}
GRANT SELECT, INSERT                 ON processed_events TO approvals_app;  -- never edited or deleted
GRANT USAGE ON SEQUENCE approval_steps_id_seq, notifications_id_seq, delegations_id_seq TO approvals_app;
