-- Run once in the Neon SQL editor, after schema.sql.
-- Policy rules live in the database so HR numbers change without a redeploy.
CREATE TABLE IF NOT EXISTS policy_rules (
  leave_type            TEXT PRIMARY KEY CHECK (leave_type IN ('Annual', 'Sick', 'Casual', 'Unpaid')),
  notice_days           INT NOT NULL CHECK (notice_days BETWEEN 0 AND 60),
  max_consecutive_days  INT NOT NULL CHECK (max_consecutive_days BETWEEN 1 AND 30),
  backdate_days         INT NOT NULL DEFAULT 0 CHECK (backdate_days BETWEEN 0 AND 14),
  uses_balance          BOOLEAN NOT NULL,
  certificate_over_days INT,                     -- certificate needed above this many days (NULL = never)
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO policy_rules (leave_type, notice_days, max_consecutive_days, backdate_days, uses_balance, certificate_over_days) VALUES
  ('Annual', 7, 15, 0, true,  NULL),
  ('Casual', 0, 2,  0, true,  NULL),
  ('Sick',   0, 15, 7, false, 2),
  ('Unpaid', 14, 30, 0, false, NULL)
ON CONFLICT (leave_type) DO NOTHING;

-- Periods when non-sick leave is not allowed (e.g. year-end closing). NULL department = whole company.
CREATE TABLE IF NOT EXISTS blackout_dates (
  id         BIGSERIAL PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  department TEXT,
  reason     TEXT NOT NULL CHECK (char_length(reason) <= 200),
  CHECK (end_date >= start_date)
);
INSERT INTO blackout_dates (start_date, end_date, department, reason)
SELECT '2026-12-27', '2026-12-31', 'Sales', 'Year-end sales closing'
WHERE NOT EXISTS (SELECT 1 FROM blackout_dates);

-- Second line of defence: the database itself refuses two active requests that overlap,
-- even if two submits arrive at the same moment.
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $$ BEGIN
  ALTER TABLE leave_requests ADD CONSTRAINT no_overlapping_active_requests
    EXCLUDE USING gist (employee_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
    WHERE (status IN ('Pending', 'Approved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
