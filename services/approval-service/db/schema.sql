-- LeaveFlow Approval Workflow service (owner: Ammar). Neon database: leaveflow-approvals.
-- Run once:  node db/migrate.mjs db/schema.sql   (or paste into the Neon SQL editor).
-- Safe to run again: everything uses IF NOT EXISTS.

-- One row per leave request in the approval workflow.
-- request_id / employee_id come from Sohaila's service and Cognito, so they are plain values, not foreign keys.
CREATE TABLE IF NOT EXISTS approval_tasks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     UUID NOT NULL UNIQUE,                       -- one workflow per request
  employee_id    TEXT NOT NULL,                              -- Cognito sub of the requester
  employee_name  TEXT,
  manager_id     TEXT,                                       -- custom:managerId (empty for managers themselves)
  department     TEXT NOT NULL,
  leave_type     TEXT NOT NULL CHECK (leave_type IN ('Annual', 'Sick', 'Casual', 'Unpaid')),
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  working_days   NUMERIC(4,1) NOT NULL CHECK (working_days > 0),
  needs_hr       BOOLEAN NOT NULL,                           -- over 5 working days or Unpaid
  status         TEXT NOT NULL DEFAULT 'InProgress' CHECK (status IN ('InProgress', 'Approved', 'Rejected', 'Cancelled')),
  execution_arn  TEXT,                                       -- Step Functions escalation timer
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
-- Coverage check: who in this department is off on these days?
CREATE INDEX IF NOT EXISTS approval_tasks_coverage_idx ON approval_tasks (department, status, start_date, end_date);

-- The steps of one workflow: Manager first, then HR when needed or after escalation.
-- The {taskId} in POST /approvals/{taskId}/decision is the id of a step.
CREATE TABLE IF NOT EXISTS approval_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           UUID NOT NULL REFERENCES approval_tasks(id),
  step_order        SMALLINT NOT NULL CHECK (step_order IN (1, 2)),
  step              TEXT NOT NULL CHECK (step IN ('Manager', 'HR')),
  assigned_user_id  TEXT,                                    -- the manager (Manager step)
  assigned_group    TEXT,                                    -- 'HRAdmin' (HR step)
  status            TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Escalated', 'Cancelled')),
  note              TEXT CHECK (char_length(note) <= 200),   -- why this step exists, shown on the card
  due_at            TIMESTAMPTZ,                             -- 48 hours, or 2 minutes when DEMO_MODE=true
  escalated_at      TIMESTAMPTZ,
  decided_by        TEXT,
  decided_by_name   TEXT,
  comment           TEXT CHECK (char_length(comment) <= 500),
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, step_order),
  CHECK (assigned_user_id IS NOT NULL OR assigned_group IS NOT NULL),
  CHECK (status <> 'Rejected' OR comment IS NOT NULL),     -- a rejection always says why
  CHECK (status NOT IN ('Approved', 'Rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS approval_steps_user_idx    ON approval_steps (assigned_user_id, status);
CREATE INDEX IF NOT EXISTS approval_steps_group_idx   ON approval_steps (assigned_group, status);
CREATE INDEX IF NOT EXISTS approval_steps_decided_idx ON approval_steps (decided_by, decided_at DESC);
CREATE INDEX IF NOT EXISTS approval_steps_due_idx     ON approval_steps (status, due_at);

-- In-app inbox (the unread bell). Filled when the SNS notification is published.
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,                                 -- owner (Cognito sub)
  title       TEXT NOT NULL CHECK (char_length(title) <= 100),
  body        TEXT NOT NULL CHECK (char_length(body) <= 300),
  link        TEXT CHECK (char_length(link) <= 200),
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx ON notifications (user_id, read, created_at DESC);

-- Idempotency: each eventId is handled once, even if EventBridge delivers it twice.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id      TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
