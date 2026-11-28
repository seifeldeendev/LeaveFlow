CREATE TABLE ledger_entries (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     TEXT NOT NULL,
  leave_type      TEXT NOT NULL,
  kind            TEXT NOT NULL,
  amount          NUMERIC NOT NULL,
  request_id      UUID,
  event_id        TEXT UNIQUE,
  accrual_run_id  BIGINT,
  reason          TEXT,
  created_by      TEXT,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ledger_one_deduction_per_request ON ledger_entries (request_id) WHERE kind = 'Deduction';
CREATE UNIQUE INDEX ledger_one_refund_per_request    ON ledger_entries (request_id) WHERE kind = 'Refund';
CREATE TABLE pending_holds (
  request_id  UUID PRIMARY KEY,
  employee_id TEXT NOT NULL,
  leave_type  TEXT NOT NULL,
  days        NUMERIC NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event_id    TEXT UNIQUE,
  at          TIMESTAMPTZ,
  actor       TEXT,
  actor_name  TEXT,
  action      TEXT,
  target      TEXT,
  result      TEXT,
  service     TEXT,
  details     JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE accrual_runs (
  id              BIGSERIAL PRIMARY KEY,
  period          DATE NOT NULL,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL,
  employees_count INTEGER,
  total_days      NUMERIC,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  error           TEXT,
  UNIQUE (period, kind)
);
CREATE TABLE processed_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE VIEW balances AS
  SELECT employee_id, leave_type, sum(amount) AS balance, max(created_at) AS last_change
  FROM ledger_entries GROUP BY employee_id, leave_type;
