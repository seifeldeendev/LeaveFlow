const tables = () => ({
  ledger_entries: [], pending_holds: [], processed_events: [], audit_log: [], accrual_runs: [],
});

export function createFakeSql(seed = {}) {
  const db = { ...tables(), ...seed };
  let seq = 1000;
  const uuid = () => { seq++; return `${seq.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`; };
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  function run(strings, params) {
    const s = strings.join('?').replace(/\s+/g, ' ').trim();
    const p = params;

    if (s.startsWith('SELECT 1')) return [{ '1': 1 }];
    if (s.includes('current_database')) return [{ database: 'leaveflow_balances', usr: 'balances_app' }];

    if (s.startsWith('SELECT leave_type, balance, last_change FROM balances')) {
      const m = new Map();
      db.ledger_entries.filter((r) => r.employee_id === p[0]).forEach((r) => {
        const cur = m.get(r.leave_type) || { sum: 0, last: null };
        cur.sum += Number(r.amount);
        if (!cur.last || r.created_at > cur.last) cur.last = r.created_at;
        m.set(r.leave_type, cur);
      });
      return [...m].map(([leave_type, v]) => ({ leave_type, balance: String(v.sum), last_change: v.last }));
    }
    if (s.startsWith('SELECT balance FROM balances')) {
      const sum = db.ledger_entries.filter((r) => r.employee_id === p[0] && r.leave_type === p[1])
        .reduce((a, r) => a + Number(r.amount), 0);
      return [{ balance: String(Math.round(sum * 100) / 100) }];
    }
    if (s.startsWith('SELECT id, employee_id, leave_type, kind, amount, request_id, event_id')) {
      return db.ledger_entries.filter((r) => r.employee_id === p[0])
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id).map((r) => ({ ...r }));
    }
    if (s.startsWith('SELECT 1 FROM ledger_entries WHERE request_id')) {
      return db.ledger_entries.some((r) => r.request_id === p[0] && r.kind === 'Deduction') ? [{ '1': 1 }] : [];
    }
    if (s.startsWith('SELECT employee_id, amount, reason AS note, created_at')) {
      return db.ledger_entries.filter((r) => r.accrual_run_id === Number(p[0]))
        .map((r) => ({ employee_id: r.employee_id, amount: String(r.amount), note: r.reason, created_at: r.created_at }));
    }

    if (s.startsWith('INSERT INTO ledger_entries')) {
      const [employee_id, leave_type, kind, amount, request_id, event_id, accrual_run_id, reason, created_by, created_by_name] = p;
      if (event_id && db.ledger_entries.some((r) => r.event_id === event_id)) return [];
      if (kind === 'Deduction' && db.ledger_entries.some((r) => r.request_id === request_id && r.kind === 'Deduction')) return [];
      if (kind === 'Refund' && db.ledger_entries.some((r) => r.request_id === request_id && r.kind === 'Refund')) return [];
      const row = {
        id: seq++, employee_id, leave_type, kind, amount: Number(amount), request_id: request_id || null,
        event_id: event_id || null, accrual_run_id: accrual_run_id || null, reason,
        created_by, created_by_name: created_by_name || null, created_at: new Date().toISOString(),
      };
      db.ledger_entries.push(row);
      return [{ id: row.id, amount: String(row.amount) }];
    }

    if (s.startsWith('SELECT leave_type, SUM(days) FROM pending_holds')) {
      const m = new Map();
      db.pending_holds.filter((h) => h.employee_id === p[0])
        .forEach((h) => m.set(h.leave_type, (m.get(h.leave_type) || 0) + Number(h.days)));
      return [...m].map(([leave_type, days]) => ({ leave_type, days: String(days) }));
    }
    if (s.startsWith('INSERT INTO pending_holds')) {
      const [request_id, employee_id, leave_type, days] = p;
      if (db.pending_holds.some((h) => h.request_id === request_id)) return [];
      db.pending_holds.push({ request_id, employee_id, leave_type, days: Number(days), created_at: new Date().toISOString() });
      return [];
    }
    if (s.startsWith('DELETE FROM pending_holds')) {
      const rows = db.pending_holds.filter((h) => h.request_id === p[0]);
      db.pending_holds = db.pending_holds.filter((h) => h.request_id !== p[0]);
      return rows;
    }

    if (s.startsWith('INSERT INTO processed_events')) {
      if (db.processed_events.some((e) => e.event_id === p[0])) return [];
      db.processed_events.push({ event_id: p[0], processed_at: new Date().toISOString() });
      return [{ event_id: p[0] }];
    }
    if (s.startsWith('DELETE FROM processed_events')) throw err('42501', 'permission denied');

    if (s.startsWith('INSERT INTO audit_log')) {
      const [event_id, at, actor, actor_name, action, target, result, service, details] = p;
      if (db.audit_log.some((a) => a.event_id === event_id)) return [];
      db.audit_log.push({
        id: seq++, event_id, at, actor, actor_name, action, target, result, service, details,
        received_at: new Date().toISOString(),
      });
      return [];
    }

    if (s.startsWith('INSERT INTO accrual_runs')) {
      const [period, kind, status, started_at] = p;
      if (db.accrual_runs.some((r) => r.period === period && r.kind === kind)) return [];
      const row = {
        id: seq++, period, kind, status, started_at, employees_count: null,
        total_days: '0', finished_at: null, error: null,
      };
      db.accrual_runs.push(row);
      return [{ id: row.id }];
    }
    if (s.startsWith('UPDATE accrual_runs SET status')) {
      if (p.length >= 5) {
        const row = db.accrual_runs.find((r) => r.id === Number(p[4]));
        if (row) Object.assign(row, {
          status: p[0], employees_count: Number(p[1]), total_days: String(p[2]),
          error: p[3] || null, finished_at: new Date().toISOString(),
        });
      } else if (p.length === 3) {
        const row = db.accrual_runs.find((r) => r.id === Number(p[2]));
        if (row) Object.assign(row, {
          status: 'Done', employees_count: Number(p[0]), total_days: String(p[1]),
          error: null, finished_at: new Date().toISOString(),
        });
      } else {
        const row = db.accrual_runs.find((r) => r.id === Number(p[1]));
        if (row) Object.assign(row, { status: 'Failed', error: p[0], finished_at: new Date().toISOString() });
      }
      return [];
    }
    if (s.startsWith('SELECT * FROM accrual_runs WHERE period')) return db.accrual_runs.filter((r) => r.period === p[0]).map((r) => ({ ...r }));
    if (s.startsWith('SELECT * FROM accrual_runs ORDER BY')) return db.accrual_runs.slice().sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 100).map((r) => ({ ...r }));
    if (s.startsWith('SELECT id FROM accrual_runs WHERE period')) return db.accrual_runs.filter((r) => r.period === p[0] && r.kind === p[1]).map((r) => ({ id: r.id }));
    if (s.startsWith('SELECT * FROM accrual_runs WHERE id')) return db.accrual_runs.filter((r) => r.id === Number(p[0])).map((r) => ({ ...r }));

    throw new Error(`FakeSql: unhandled query: ${s.slice(0, 100)}`);
  }

  const sql = async (strings, ...params) => run(strings, params);
  sql.query = (text) => { throw new Error(`FakeSql: raw query not supported: ${text.slice(0, 60)}`); };
  sql.transaction = async (statements) => {
    const results = [];
    for (const st of statements) results.push(await st);
    return results;
  };
  sql.__db = db;
  return sql;
}

export function createTestHoldsRepository(sql) {
  const db = sql.__db;
  return {
    async pendingByEmployee(employeeId) {
      const out = {};
      db.pending_holds.filter((h) => h.employee_id === employeeId)
        .forEach((h) => { out[h.leave_type] = (out[h.leave_type] || 0) + Number(h.days); });
      return out;
    },
    async createHold({ requestId, employeeId, leaveType, workingDays }) {
      if (db.pending_holds.some((h) => h.request_id === requestId)) return;
      db.pending_holds.push({
        request_id: requestId, employee_id: employeeId, leave_type: leaveType,
        days: Number(workingDays), created_at: new Date().toISOString(),
      });
    },
    async releaseHold(requestId) {
      db.pending_holds = db.pending_holds.filter((h) => h.request_id !== requestId);
    },
  };
}

export const fakeUuid = () => '11111111-1111-4111-8111-111111111111';
export const otherUuid = () => '22222222-2222-4222-8222-222222222222';
export const thirdUuid = () => '33333333-3333-4333-8333-333333333333';
export const requestUuid = () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
