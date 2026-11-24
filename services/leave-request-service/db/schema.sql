-- LeaveFlow Leave Request service (Neon: leaveflow-requests). Run once in the Neon SQL editor.
CREATE TABLE IF NOT EXISTS login_attempts (
  email          TEXT PRIMARY KEY,
  failed_count   INT NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  last_failed_at TIMESTAMPTZ,
  locked_until   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   TEXT NOT NULL,                 -- Cognito sub
  manager_id    TEXT,
  department    TEXT NOT NULL,
  leave_type    TEXT NOT NULL CHECK (leave_type IN ('Annual', 'Sick', 'Casual', 'Unpaid')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  working_days  NUMERIC(4,1) NOT NULL CHECK (working_days > 0 AND working_days <= 30),
  reason        TEXT CHECK (char_length(reason) <= 500),
  status        TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Withdrawn', 'Cancelled')),
  certificate_key TEXT,                        -- S3 object key, never a public URL
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS leave_requests_employee_idx ON leave_requests (employee_id, start_date);
CREATE INDEX IF NOT EXISTS leave_requests_manager_idx  ON leave_requests (manager_id, status);

CREATE TABLE IF NOT EXISTS request_status_history (
  id          BIGSERIAL PRIMARY KEY,
  request_id  UUID NOT NULL REFERENCES leave_requests(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT CHECK (char_length(note) <= 300)
);

CREATE TABLE IF NOT EXISTS holidays (
  holiday_date DATE PRIMARY KEY,
  name         TEXT NOT NULL,
  year         INT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
