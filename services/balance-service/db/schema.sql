CREATE TABLE IF NOT EXISTS employee_balances (
  employee_id   TEXT NOT NULL,
  leave_type    TEXT NOT NULL CHECK (leave_type IN ('Annual','Casual','Sick','Unpaid')),
  opening_days  NUMERIC(6,2) NOT NULL DEFAULT 0,
  yearly_allowance NUMERIC(6,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, leave_type)
);

CREATE TABLE IF NOT EXISTS balance_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('Accrual','Deduction','Refund','Adjustment','Opening')),
  leave_type      TEXT NOT NULL CHECK (leave_type IN ('Annual','Casual','Sick','Unpaid')),
  amount          NUMERIC(6,2) NOT NULL CHECK (amount <> 0 AND amount BETWEEN -365 AND 365),
  reason          TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  reference       TEXT,
  idempotency_key TEXT UNIQUE,
  actor_id        TEXT,
  actor_name      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS balance_ledger_employee_idx ON balance_ledger (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS balance_ledger_type_idx     ON balance_ledger (employee_id, leave_type, created_at DESC);
CREATE INDEX IF NOT EXISTS balance_ledger_ref_idx      ON balance_ledger (reference);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id      TEXT PRIMARY KEY,
  detail_type   TEXT NOT NULL,
  request_id    TEXT,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accrual_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month             CHAR(7) NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  duration_ms       INT,
  employees         INT NOT NULL DEFAULT 0,
  pro_rata          INT NOT NULL DEFAULT 0,
  total_days        NUMERIC(8,2) NOT NULL DEFAULT 0,
  trigger           TEXT NOT NULL CHECK (trigger IN ('Manual','Scheduled')),
  actor_id          TEXT,
  status            TEXT NOT NULL DEFAULT 'Running' CHECK (status IN ('Running','Completed','Failed')),
  duplicates_skipped INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS accrual_runs_month_idx ON accrual_runs (month);

CREATE TABLE IF NOT EXISTS accrual_run_details (
  id            BIGSERIAL PRIMARY KEY,
  run_id        UUID NOT NULL REFERENCES accrual_runs(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL,
  amount        NUMERIC(6,2) NOT NULL,
  pro_rata      BOOLEAN NOT NULL DEFAULT false,
  note          TEXT,
  UNIQUE (run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS accrual_details_employee_idx ON accrual_run_details (employee_id);

CREATE TABLE IF NOT EXISTS balance_policies (
  name    TEXT PRIMARY KEY,
  label   TEXT NOT NULL,
  value   NUMERIC(6,2) NOT NULL,
  unit    TEXT NOT NULL,
  min_val NUMERIC(6,2) NOT NULL,
  max_val NUMERIC(6,2) NOT NULL,
  CHECK (value BETWEEN min_val AND max_val)
);
INSERT INTO balance_policies (name, label, value, unit, min_val, max_val)
VALUES ('accrual-per-month', 'Accrual per month', 1.75, 'days', 0.5, 3)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS balance_audit (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    TEXT,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  target      TEXT NOT NULL,
  result      TEXT NOT NULL CHECK (result IN ('OK','DENIED','ERROR')),
  details     TEXT
);
CREATE INDEX IF NOT EXISTS balance_audit_at_idx ON balance_audit (at DESC);
CREATE INDEX IF NOT EXISTS balance_audit_action_idx ON balance_audit (action, at DESC);
