-- LeaveFlow Approval Workflow service (owner: Ammar). Neon database: leaveflow_approvals.
-- This file documents the tables as they exist in the shared Neon database (created by the project owner).
-- The app connects as approvals_app, which can read and write rows but cannot create or alter tables.
-- To rebuild on a fresh database, run it as the owner in the Neon SQL editor. Safe to run again.

-- One row per leave request in the approval workflow. request_id comes from the requests service.
CREATE TABLE IF NOT EXISTS approval_tasks (
  request_id            UUID PRIMARY KEY,
  employee_id           TEXT NOT NULL,                       -- Cognito sub of the requester
  employee_name         TEXT CHECK (char_length(employee_name) <= 100),
  manager_id            TEXT,                                -- custom:managerId (empty for managers themselves)
  department            TEXT NOT NULL,
  leave_type            TEXT NOT NULL CHECK (leave_type IN ('Annual', 'Sick', 'Casual', 'Unpaid')),
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  working_days          NUMERIC NOT NULL CHECK (working_days > 0 AND working_days <= 30),
  needs_hr              BOOLEAN NOT NULL DEFAULT false,      -- over 5 working days or Unpaid
  certificate_required  BOOLEAN NOT NULL DEFAULT false,      -- sick leave over 2 days
  status                TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
  execution_arn         TEXT,                                -- Step Functions escalation timer
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
-- Coverage check: who in this department is already off on these days?
CREATE INDEX IF NOT EXISTS approval_tasks_dept_dates_idx ON approval_tasks (department, start_date, end_date) WHERE status = 'Approved';

-- The steps of one workflow: Manager first (step 1), then HR (step 2) when needed or after escalation.
-- The {taskId} in POST /approvals/{taskId}/decision is approval_steps.id.
CREATE TABLE IF NOT EXISTS approval_steps (
  id               BIGSERIAL PRIMARY KEY,
  request_id       UUID NOT NULL REFERENCES approval_tasks(request_id),
  step_no          SMALLINT NOT NULL CHECK (step_no IN (1, 2)),
  step_type        TEXT NOT NULL CHECK (step_type IN ('Manager', 'HR')),
  approver_id      TEXT,                                     -- the manager's sub; NULL for HR (any HRAdmin)
  status           TEXT NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting', 'Pending', 'Approved', 'Rejected', 'Escalated', 'Closed')),
  task_token       TEXT,                                     -- reserved; not used (decisions are made in the API)
  decided_by       TEXT,
  decided_by_name  TEXT CHECK (char_length(decided_by_name) <= 100),
  decision_comment TEXT CHECK (char_length(decision_comment) <= 300),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),       -- escalation is due created_at + 48 h (2 min in demo)
  decided_at       TIMESTAMPTZ,
  escalated_at     TIMESTAMPTZ,
  UNIQUE (request_id, step_no),
  -- a decided step always records who and when, and only a decided step does
  CHECK ((status IN ('Approved', 'Rejected')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS approval_steps_queue_idx    ON approval_steps (approver_id, status);
CREATE INDEX IF NOT EXISTS approval_steps_hr_queue_idx ON approval_steps (status) WHERE step_type = 'HR';
CREATE INDEX IF NOT EXISTS approval_steps_history_idx  ON approval_steps (decided_by, decided_at DESC);

-- Delegation while a manager is on leave (Function 4, not used yet).
CREATE TABLE IF NOT EXISTS delegations (
  id           BIGSERIAL PRIMARY KEY,
  manager_id   TEXT NOT NULL,
  delegate_id  TEXT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  reason       TEXT CHECK (char_length(reason) <= 200),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (manager_id <> delegate_id)
);
CREATE INDEX IF NOT EXISTS delegations_manager_idx ON delegations (manager_id, start_date, end_date);

-- In-app inbox (the unread bell). Links must be relative: no "javascript:" or other schemes.
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL CHECK (char_length(title) <= 120),
  body        TEXT NOT NULL CHECK (char_length(body) <= 500),
  link        TEXT CHECK (char_length(link) <= 300 AND link !~ '^[a-zA-Z]+:'),
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx ON notifications (user_id, read, created_at DESC);

-- Idempotency: each eventId is handled once, even if EventBridge delivers it twice.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id      TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
