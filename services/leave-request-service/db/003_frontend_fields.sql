-- Run once in the Neon SQL editor, after 002_policy.sql.
-- Names shown in the frontend (employee on a request, who changed a status).
ALTER TABLE leave_requests         ADD COLUMN IF NOT EXISTS employee_name   TEXT CHECK (char_length(employee_name) <= 100);
ALTER TABLE request_status_history ADD COLUMN IF NOT EXISTS changed_by_name TEXT CHECK (char_length(changed_by_name) <= 100);
-- Sick leave may be filed up to 7 days after it starts (same rule the frontend shows).
UPDATE policy_rules SET backdate_days = 7, updated_at = now() WHERE leave_type = 'Sick' AND backdate_days <> 7;
