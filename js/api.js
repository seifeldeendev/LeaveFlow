/* LeaveFlow API client.
   One function per endpoint in the Final Phase Plan. With LF.config.MOCK = true every call
   is answered from the mock store below, including the role (403) and ownership (404)
   checks the real Lambdas do. With MOCK = false the same calls go to the three API Gateways
   with the Cognito ID token. Errors always look like { error: { code, message } }. */
window.LF = window.LF || {};
(function () {
  const cfg = LF.config;
  // A service is live (real API) when MOCK is off, or when LIVE turns it on by itself.
  const live = (svc) => cfg.MOCK === false || Boolean(cfg.LIVE && cfg.LIVE[svc]);
  const anyLive = () => cfg.MOCK === false || Object.values(cfg.LIVE || {}).some(Boolean);
  LF.live = live;
  const STORE_KEY = "lf.mockdb.v1";
  const SESSION_KEY = "lf.session";

  /* ---------- tiny date helpers (UTC, YYYY-MM-DD) ---------- */
  const D = {
    parse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); },
    iso(dt) { return dt.toISOString().slice(0, 10); },
    add(s, n) { const d = D.parse(s); d.setUTCDate(d.getUTCDate() + n); return D.iso(d); },
    diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 86400000); },
    dow(s) { return D.parse(s).getUTCDay(); }, // 0 Sun … 5 Fri, 6 Sat
    today() { return cfg.MOCK && !anyLive() ? cfg.MOCK_TODAY : D.iso(new Date()); },
    range(a, b) { const out = []; for (let d = a; d <= b; d = D.add(d, 1)) out.push(d); return out; }
  };
  LF.date = D;

  /* ---------- store ---------- */
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
    return LF.seed();
  }
  let db = load();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ } }
  LF.resetMock = function () { try { localStorage.removeItem(STORE_KEY); } catch (e) {} db = LF.seed(); };

  /* ---------- session ---------- */
  LF.session = {
    get() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; } },
    set(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} },
    clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} }
  };
  // Live sign-in keeps the Cognito profile in the session; mock sign-in keeps a mock user id.
  const me = () => {
    const s = LF.session.get();
    if (!s || !s.mfaDone) return null;
    return live("requests") ? s.user || null : user(s.userId);
  };
  // For the services still on mock data, act as the demo user with the same email or role.
  const mockMe = () => {
    const u = me();
    if (!u || !live("requests")) return u;
    return db.users.find((x) => x.email === u.email) || db.users.find((x) => x.role === u.role) || u;
  };
  const user = (id) => db.users.find((u) => u.id === id);
  const isHR = (u) => u && u.role === "HRAdmin";
  const isMgr = (u) => u && u.role === "Manager";

  class ApiError extends Error {
    constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
  }
  LF.ApiError = ApiError;
  const fail = (status, code, message, details) => { throw new ApiError(status, code, message, details); };
  const need = (cond, status, code, msg) => { if (!cond) fail(status, code, msg); };

  /* ---------- domain logic (mirrors the services) ---------- */
  const holidaySet = () => new Set(db.holidays.map((h) => h.date));
  function workingDays(start, end) {
    const hs = holidaySet(); const days = []; const skipped = [];
    D.range(start, end).forEach((d) => {
      const w = D.dow(d);
      if (w === 5 || w === 6) skipped.push({ date: d, why: "Weekend" });
      else if (hs.has(d)) skipped.push({ date: d, why: db.holidays.find((h) => h.date === d).name });
      else days.push(d);
    });
    return { days, skipped };
  }
  function balanceOf(uid) {
    const snap = db.balances[uid] || { Annual: 0, Casual: 0 };
    const out = { Annual: snap.Annual, Casual: snap.Casual };
    db.ledger.filter((e) => e.employeeId === uid).forEach((e) => { out[e.type] = (out[e.type] || 0) + e.amount; });
    const pending = { Annual: 0, Casual: 0 };
    db.requests.filter((r) => r.employeeId === uid && r.status === "Pending" && pending[r.type] !== undefined)
      .forEach((r) => { pending[r.type] += r.workingDays; });
    const sickTaken = db.requests.filter((r) => r.employeeId === uid && r.type === "Sick" && r.status === "Approved" && r.start.startsWith("2026")).reduce((a, r) => a + r.workingDays, 0);
    const unpaidTaken = db.requests.filter((r) => r.employeeId === uid && r.type === "Unpaid" && r.status === "Approved" && r.start.startsWith("2026")).reduce((a, r) => a + r.workingDays, 0);
    return {
      Annual: { available: round(out.Annual), pending: pending.Annual, projected: round(out.Annual - pending.Annual), yearly: 21 },
      Casual: { available: round(out.Casual), pending: pending.Casual, projected: round(out.Casual - pending.Casual), yearly: 6 },
      Sick: { taken: sickTaken }, Unpaid: { taken: unpaidTaken }
    };
  }
  const round = (n) => Math.round(n * 100) / 100;
  const policyVal = (name) => db.policy.find((p) => p.name === name).value;

  function team(managerId) { return db.users.filter((u) => u.managerId === managerId || u.id === managerId); }
  function coverage(req) {
    const emp = user(req.employeeId); const mgrId = emp.managerId;
    const members = team(mgrId).filter((u) => u.dept === emp.dept);
    const size = members.length || 1;
    const { days } = workingDays(req.start, req.end);
    let worst = { date: null, off: 0, pct: 0, names: [] };
    const perDay = days.map((d) => {
      const off = db.requests.filter((r) => r.status === "Approved" && r.id !== req.id && members.some((m) => m.id === r.employeeId) && r.start <= d && r.end >= d);
      const n = off.length + 1; const pct = Math.round((n / size) * 100);
      const row = { date: d, off: n, pct, names: off.map((r) => user(r.employeeId).name) };
      if (pct > worst.pct) worst = row;
      return row;
    });
    const level = worst.pct > 30 ? "block" : worst.pct > 20 ? "warn" : "ok";
    return { teamSize: size, perDay, worst, level };
  }

  function policyChecks(u, body, ignoreId) {
    const checks = []; const add = (ok, label, detail) => checks.push({ ok, label, detail });
    const { type, start, end } = body;
    if (!start || !end || end < start) { add(false, "Valid dates", "End date must be on or after the start date"); return { checks, days: 0, skipped: [] }; }
    const { days, skipped } = workingDays(start, end);
    add(days.length > 0, "At least one working day", days.length ? days.length + " working day" + (days.length === 1 ? "" : "s") + " (Fri, Sat and public holidays not counted)" : "Range has only weekends or holidays");
    const notice = type === "Annual" ? policyVal("annual-notice-days") : type === "Unpaid" ? 14 : 0;
    const lead = D.diff(D.today(), start);
    if (type === "Sick") add(lead >= -7, "Sick leave filed within 7 days", lead >= -7 ? "OK" : "Sick leave must be filed within 7 days of the first day");
    else add(lead >= notice, "Notice period (" + notice + " day" + (notice === 1 ? "" : "s") + ")", lead >= notice ? "Submitted " + lead + " days ahead" : "Starts in " + Math.max(lead, 0) + " days; " + type + " leave needs " + notice + " days' notice");
    const max = policyVal("max-consecutive-days");
    add(days.length <= max, "Max " + max + " consecutive working days", days.length <= max ? "OK" : days.length + " days is over the limit");
    const bo = db.blackouts.find((b) => b.dept === u.dept && start <= b.end && end >= b.start);
    add(!bo, "No blackout dates", bo ? bo.name + " (" + fmtShort(bo.start) + "–" + fmtShort(bo.end) + ") blocks " + u.dept : "OK");
    const ov = db.requests.find((r) => r.employeeId === u.id && r.id !== ignoreId && (r.status === "Pending" || r.status === "Approved") && start <= r.end && end >= r.start);
    add(!ov, "No overlap with your requests", ov ? "Overlaps " + ov.id + " (" + ov.status.toLowerCase() + ")" : "OK");
    if (type === "Annual" || type === "Casual") {
      const b = balanceOf(u.id)[type];
      add(b.projected >= days.length, "Enough " + type + " balance", "Projected " + b.projected + " days after pending requests, needs " + days.length);
    }
    const info = [];
    if (type === "Sick" && days.length > 2) info.push("Sick leave over 2 days needs a medical certificate before it can be approved.");
    if (type === "Unpaid" || days.length > 5) info.push("Over 5 working days or Unpaid: HR approves as a second step after your manager.");
    return { checks, days: days.length, skipped, info };
  }
  function fmtShort(s) { const d = D.parse(s); return d.getUTCDate() + " " + d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }); }

  const nowIso = () => (cfg.MOCK ? cfg.MOCK_TODAY + "T" + new Date().toISOString().slice(11, 19) + "Z" : new Date().toISOString());
  function auditLog(actor, action, target, result, service) { db.audit.unshift({ id: "A-" + (10000 + db.audit.length), at: nowIso(), actor, action, target, result, service }); }
  function notify(userId, title, body, link) { db.notifications.unshift({ id: "N-" + (400 + db.notifications.length), userId, at: nowIso(), title, body, link, read: false }); }
  function enrich(r) { const u = user(r.employeeId); return Object.assign({}, r, { employee: { id: u.id, name: u.name, dept: u.dept } }); }

  /* ---------- mock routes ---------- */
  const routes = {
    // requests-api
    "POST /auth/login"(b) {
      const u = db.users.find((x) => x.email && x.email === String(b.email || "").trim().toLowerCase());
      if (!u || !b.password) { auditLog("unknown", "LOGIN_FAILED", b.email || "", "DENIED", "requests"); fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect."); }
      const needMfa = u.role !== "Employee";
      LF.session.set({ userId: u.id, mfaDone: !needMfa, at: Date.now() });
      return { mfaRequired: needMfa, role: u.role };
    },
    "POST /auth/mfa"(b) {
      const s = LF.session.get(); need(s, 401, "NO_SESSION", "Start again from sign-in.");
      if (!/^\d{6}$/.test(String(b.code || ""))) fail(401, "MFA_FAILED", "That code didn't work. Enter the 6 digits from your authenticator app.");
      s.mfaDone = true; LF.session.set(s); return { ok: true };
    },
    "POST /auth/logout"() { LF.session.clear(); return { ok: true }; },
    "GET /me"() { const u = me(); return u; },
    "GET /leave-requests"(b, q, u) {
      let list = db.requests.filter((r) => r.employeeId === u.id);
      if (q.status) list = list.filter((r) => r.status === q.status);
      if (q.type) list = list.filter((r) => r.type === q.type);
      if (q.from) list = list.filter((r) => r.end >= q.from);
      if (q.to) list = list.filter((r) => r.start <= q.to);
      return list.sort((a, b) => b.start.localeCompare(a.start)).map(enrich);
    },
    "GET /leave-requests/:id"(b, q, u, p) {
      const r = db.requests.find((x) => x.id === p.id);
      const owner = r && r.employeeId === u.id;
      const theirMgr = r && user(r.employeeId).managerId === u.id;
      if (!r || !(owner || theirMgr || isHR(u))) fail(404, "NOT_FOUND", "Request not found.");
      const steps = [];
      const t = db.tasks.filter((x) => x.requestId === r.id);
      const dec = db.decisions.filter((x) => x.requestId === r.id);
      dec.forEach((d) => steps.push({ step: user(d.approverId).role === "HRAdmin" ? "HR" : "Manager", who: user(d.approverId).name, status: d.decision, at: d.at, comment: d.comment }));
      t.filter((x) => x.status === "Pending").forEach((x) => steps.push({ step: x.step, who: user(x.approverId).name, status: x.escalated ? "Escalated" : "Pending", at: x.createdAt }));
      return Object.assign(enrich(r), { history: db.history[r.id] || [{ at: r.createdAt, status: "Submitted", by: user(r.employeeId).name, note: r.workingDays + " working days" }], steps, canAct: owner });
    },
    "GET /working-days"(b, q, u) { return policyChecks(u, q); },
    "POST /leave-requests"(b, q, u) {
      need(["Annual", "Sick", "Casual", "Unpaid"].includes(b.type), 400, "BAD_TYPE", "Choose a leave type.");
      const res = policyChecks(u, b);
      const failed = res.checks.filter((c) => !c.ok);
      if (failed.length) fail(422, "POLICY_VIOLATION", "This request breaks " + failed.length + " policy rule" + (failed.length > 1 ? "s" : "") + ".", res);
      const id = "LR-" + (db.seq++);
      const r = { id, employeeId: u.id, type: b.type, start: b.start, end: b.end, workingDays: res.days, status: "Pending", createdAt: nowIso(), reason: String(b.reason || "").slice(0, 500) };
      db.requests.push(r);
      const approver = user(u.managerId) || user("u-mona");
      db.history[id] = [
        { at: r.createdAt, status: "Submitted", by: u.name, note: "Passed policy checks · " + res.days + " working days" },
        { at: r.createdAt, status: "Pending", by: "Approval workflow", note: "Waiting for " + approver.name + " (" + (approver.role === "HRAdmin" ? "HR" : "manager") + ")" }
      ];
      db.tasks.push({ id: "T-" + (5600 + db.tasks.length), requestId: id, approverId: approver.id, step: approver.role === "HRAdmin" ? "HR" : "Manager", createdAt: r.createdAt, status: "Pending" });
      notify(approver.id, "New request to review", u.name + " · " + b.type + ", " + fmtShort(b.start) + "–" + fmtShort(b.end) + " (" + res.days + " days).", "pages/approvals/queue.html");
      notify(u.id, "Request submitted", id + " is waiting for " + approver.name + ".", "pages/requests/request.html?id=" + id);
      auditLog(u.name, "REQUEST_SUBMITTED", id, "OK", "requests");
      save(); return enrich(r);
    },
    "PATCH /leave-requests/:id/status"(b, q, u, p) {
      const r = db.requests.find((x) => x.id === p.id);
      if (!r || r.employeeId !== u.id) fail(404, "NOT_FOUND", "Request not found.");
      const h = db.history[r.id] || (db.history[r.id] = []);
      if (b.action === "withdraw") {
        need(r.status === "Pending", 409, "BAD_TRANSITION", "Only pending requests can be withdrawn.");
        r.status = "Withdrawn"; h.push({ at: nowIso(), status: "Withdrawn", by: u.name, note: "" });
        db.tasks.filter((t) => t.requestId === r.id && t.status === "Pending").forEach((t) => (t.status = "Closed"));
      } else if (b.action === "cancel") {
        need(r.status === "Approved" && r.start > D.today(), 409, "BAD_TRANSITION", "Only approved requests that haven't started can be cancelled.");
        r.status = "Cancelled"; h.push({ at: nowIso(), status: "Cancelled", by: u.name, note: b.reason || "" });
        if (r.type === "Annual" || r.type === "Casual") {
          db.ledger.push({ id: "E-" + (3000 + db.ledger.length), employeeId: u.id, at: nowIso(), kind: "Refund", type: r.type, amount: r.workingDays, ref: r.id, note: "Request cancelled" });
          h.push({ at: nowIso(), status: "Balance refunded", by: "Balance service", note: "+" + r.workingDays.toFixed(2) + " days " + r.type });
        }
      } else fail(400, "BAD_ACTION", "Unknown action.");
      auditLog(u.name, "REQUEST_" + r.status.toUpperCase(), r.id, "OK", "requests");
      save(); return enrich(r);
    },

    // approvals-api
    "GET /approvals"(b, q, u) {
      need(isMgr(u) || isHR(u), 403, "FORBIDDEN", "Only managers and HR have an approval queue.");
      return db.tasks.filter((t) => t.approverId === u.id && t.status === "Pending").map((t) => {
        const r = db.requests.find((x) => x.id === t.requestId);
        const ageH = Math.round((Date.parse(cfg.MOCK_TODAY + "T12:00:00Z") - Date.parse(t.createdAt)) / 3600000);
        return Object.assign({}, t, { request: enrich(r), balance: balanceOf(r.employeeId), coverage: coverage(r), ageHours: ageH, needsHR: t.step === "Manager" && (r.type === "Unpaid" || r.workingDays > 5) });
      }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    "POST /approvals/:id/decision"(b, q, u, p) {
      need(isMgr(u) || isHR(u), 403, "FORBIDDEN", "Not allowed.");
      const t = db.tasks.find((x) => x.id === p.id);
      if (!t || t.approverId !== u.id) fail(403, "FORBIDDEN", "This task isn't assigned to you.");
      const r = db.requests.find((x) => x.id === t.requestId);
      // Say what actually happened: withdrawn/cancelled by the employee is not the same as "already decided".
      if (r.status !== "Pending") fail(409, "NOT_PENDING", user(r.employeeId).name.split(" ")[0] + "'s request is now " + r.status.toLowerCase() + ", so there's nothing to decide.");
      need(t.status === "Pending", 409, "ALREADY_DECIDED", "This step was already decided.");
      need(r.employeeId !== u.id, 403, "FORBIDDEN", "You can't decide your own request.");
      need(b.decision === "Approved" || b.decision === "Rejected", 400, "BAD_DECISION", "Choose approve or reject.");
      if (b.decision === "Rejected") need(String(b.comment || "").trim().length > 0, 400, "COMMENT_REQUIRED", "Add a comment so the employee knows why.");
      const h = db.history[r.id] || (db.history[r.id] = []);
      const emp = user(r.employeeId);
      if (b.decision === "Approved") {
        const cov = coverage(r);
        if (cov.level === "block" && t.step === "Manager") fail(409, "COVERAGE_BLOCKED", "Approving would put " + cov.worst.pct + "% of the team off on " + fmtShort(cov.worst.date) + ". The limit is 30%.", cov);
      }
      t.status = "Done";
      db.decisions.unshift({ taskId: t.id, requestId: r.id, approverId: u.id, decision: b.decision, at: nowIso(), comment: b.comment || "", employee: emp.name, type: r.type, start: r.start, end: r.end, days: r.workingDays });
      h.push({ at: nowIso(), status: b.decision, by: u.name, note: b.comment || "" });
      const needsHR = b.decision === "Approved" && t.step === "Manager" && (r.type === "Unpaid" || r.workingDays > 5);
      if (needsHR) {
        db.tasks.push({ id: "T-" + (5600 + db.tasks.length), requestId: r.id, approverId: "u-mona", step: "HR", createdAt: nowIso(), status: "Pending", note: r.type === "Unpaid" ? "Unpaid leave needs HR as a second step" : "Over 5 working days needs HR as a second step" });
        h.push({ at: nowIso(), status: "Pending", by: "Approval workflow", note: "Waiting for Mona Fathy (HR)" });
        notify("u-mona", "HR step waiting", emp.name + " · " + r.type + ", " + r.workingDays + " days.", "pages/approvals/queue.html");
      } else {
        r.status = b.decision; if (b.comment) r.decisionComment = b.comment;
        if (b.decision === "Approved" && (r.type === "Annual" || r.type === "Casual")) {
          db.ledger.push({ id: "E-" + (3000 + db.ledger.length), employeeId: r.employeeId, at: nowIso(), kind: "Deduction", type: r.type, amount: -r.workingDays, ref: r.id, note: "Approved request" });
          h.push({ at: nowIso(), status: "Balance deducted", by: "Balance service", note: "−" + r.workingDays.toFixed(2) + " days " + r.type });
        }
        notify(r.employeeId, "Request " + b.decision.toLowerCase(), u.name + " " + b.decision.toLowerCase() + " " + r.id + " (" + fmtShort(r.start) + "–" + fmtShort(r.end) + ").", "pages/requests/request.html?id=" + r.id);
      }
      auditLog(u.name, "REQUEST_" + b.decision.toUpperCase(), r.id, "OK", "approvals");
      save(); return { ok: true, needsHR };
    },
    "GET /approvals/history"(b, q, u) {
      need(isMgr(u) || isHR(u), 403, "FORBIDDEN", "Only managers and HR have a decision history.");
      return db.decisions.filter((d) => d.approverId === u.id);
    },
    "GET /team-calendar"(b, q, u) {
      need(isMgr(u) || isHR(u), 403, "FORBIDDEN", "Only managers and HR can see the team calendar.");
      const members = isHR(u) ? db.users : team(u.id).filter((m) => m.dept === u.dept);
      return { members: members.map((m) => ({ id: m.id, name: m.name, dept: m.dept })), requests: db.requests.filter((r) => (r.status === "Approved" || r.status === "Pending") && members.some((m) => m.id === r.employeeId)).map(enrich), holidays: db.holidays };
    },
    "GET /notifications"(b, q, u) { return db.notifications.filter((n) => n.userId === u.id); },
    "PATCH /notifications/:id"(b, q, u, p) { const n = db.notifications.find((x) => x.id === p.id && x.userId === u.id); if (!n) fail(404, "NOT_FOUND", "Not found."); n.read = true; save(); return n; },
    "PATCH /notifications"(b, q, u) { db.notifications.filter((x) => x.userId === u.id).forEach((n) => (n.read = true)); save(); return { ok: true }; },
    "DELETE /notifications/:id"(b, q, u, p) { const i = db.notifications.findIndex((x) => x.id === p.id && x.userId === u.id); if (i < 0) fail(404, "NOT_FOUND", "Not found."); db.notifications.splice(i, 1); save(); return { ok: true }; },

    // balances-api
    "GET /balances/me"(b, q, u) { return balanceOf(u.id); },
    "GET /balances/me/ledger"(b, q, u) {
      let run = 0; const snap = db.balances[u.id];
      const rows = db.ledger.filter((e) => e.employeeId === u.id).sort((a, b) => a.at.localeCompare(b.at));
      const bal = { Annual: snap ? snap.Annual : 0, Casual: snap ? snap.Casual : 0 };
      return rows.map((e) => { bal[e.type] = round(bal[e.type] + e.amount); return Object.assign({}, e, { balanceAfter: bal[e.type] }); }).reverse();
    },
    "GET /balances"(b, q, u) {
      need(isHR(u), 403, "FORBIDDEN", "HR only.");
      return db.users.filter((x) => !q.department || x.dept === q.department).map((x) => Object.assign({ id: x.id, name: x.name, dept: x.dept, role: x.role, joinDate: x.joinDate }, { balance: balanceOf(x.id) }));
    },
    "POST /balances/:id/adjustments"(b, q, u, p) {
      need(isHR(u), 403, "FORBIDDEN", "HR only.");
      const emp = user(p.id); if (!emp) fail(404, "NOT_FOUND", "Employee not found.");
      const amt = Number(b.amount);
      need(!isNaN(amt) && amt !== 0 && Math.abs(amt) <= 10, 400, "BAD_AMOUNT", "Amount must be between −10 and +10 days, not zero.");
      need(String(b.reason || "").trim().length >= 5, 400, "REASON_REQUIRED", "A reason is required for every adjustment.");
      need(b.type === "Annual" || b.type === "Casual", 400, "BAD_TYPE", "Choose Annual or Casual.");
      const e = { id: "E-" + (3000 + db.ledger.length), employeeId: emp.id, at: nowIso(), kind: "Adjustment", type: b.type, amount: amt, ref: "ADJ-" + (100 + db.ledger.length), note: String(b.reason).trim() };
      db.ledger.push(e);
      auditLog(u.name, "BALANCE_ADJUSTED", emp.name + " · " + b.type + " " + (amt > 0 ? "+" : "") + amt.toFixed(2), "OK", "balances");
      notify(emp.id, "Balance adjusted by HR", b.type + " " + (amt > 0 ? "+" : "") + amt + " days.", "pages/balance/my-balance.html");
      save(); return e;
    },
    "GET /calendar"(b, q, u) {
      need(isHR(u), 403, "FORBIDDEN", "HR only.");
      return { requests: db.requests.filter((r) => r.status === "Approved" || r.status === "Pending").map(enrich), holidays: db.holidays, blackouts: db.blackouts };
    },
    "GET /dashboard"(b, q, u) {
      need(isHR(u), 403, "FORBIDDEN", "HR only.");
      const t = D.today(); const dow = D.dow(t); const weekStart = D.add(t, -dow); const weekEnd = D.add(weekStart, 6);
      const offWeek = db.requests.filter((r) => r.status === "Approved" && r.start <= weekEnd && r.end >= weekStart).map(enrich);
      const offToday = offWeek.filter((r) => r.start <= t && r.end >= t);
      const depts = ["Sales", "Engineering", "Finance", "HR"];
      const byDept = depts.map((d) => ({ dept: d, headcount: db.users.filter((x) => x.dept === d).length, days: db.requests.filter((r) => r.status === "Approved" && user(r.employeeId).dept === d && r.start.startsWith("2026")).reduce((a, r) => a + r.workingDays, 0) }));
      // Monthly series (mock history + live November/December)
      const base = [34, 28, 51, 39, 46, 41, 72, 63, 38, 44, 0, 0];
      db.requests.filter((r) => r.status === "Approved" && r.start >= "2026-11-01" && r.start < "2027-01-01").forEach((r) => { base[Number(r.start.slice(5, 7)) - 1] += r.workingDays; });
      const byMonth = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => ({ month: m, days: base[i] }));
      const pending = db.tasks.filter((x) => x.status === "Pending").length;
      const escalated = db.tasks.filter((x) => x.status === "Pending" && x.escalated).length;
      const low = db.users.filter((x) => balanceOf(x.id).Annual.available < 3).map((x) => ({ name: x.name, dept: x.dept, available: balanceOf(x.id).Annual.available }));
      return { weekStart, weekEnd, offWeek, offToday, byDept, byMonth, pending, escalated, headcount: db.users.length, low };
    },
    "GET /audit"(b, q, u) {
      need(isHR(u), 403, "FORBIDDEN", "HR only.");
      return db.audit.filter((a) => (!q.actor || a.actor.toLowerCase().includes(q.actor.toLowerCase())) && (!q.action || a.action === q.action) && (!q.from || a.at.slice(0, 10) >= q.from) && (!q.to || a.at.slice(0, 10) <= q.to));
    },
    "GET /accrual-runs"(b, q, u) { need(isHR(u), 403, "FORBIDDEN", "HR only."); return db.accrualRuns; },
    "POST /accrual-runs"(b, q, u) {
      need(isHR(u), 403, "FORBIDDEN", "HR only.");
      const month = "2026-12";
      if (db.accrualRuns.some((r) => r.month === month)) fail(409, "ALREADY_RAN", "December 2026 accrual already ran. Each month runs once.");
      const val = policyVal("accrual-per-month");
      const run = { id: "ACR-" + month, month, label: "December 2026", startedAt: nowIso(), durationMs: 1612, employees: db.users.length, proRata: 1, totalDays: round(db.users.length * val - val * 0.5), trigger: "Manual (demo)", status: "Completed", duplicatesSkipped: 0 };
      db.accrualRuns.unshift(run);
      db.users.forEach((x) => {
        const amt = x.id === "u-dina" ? round(val * 0.5) : val;
        db.ledger.push({ id: "E-" + (3000 + db.ledger.length), employeeId: x.id, at: nowIso(), kind: "Accrual", type: "Annual", amount: amt, ref: "accrual-" + month, note: x.id === "u-dina" ? "Monthly accrual (pro-rata, joined 16 Nov)" : "Monthly accrual" });
      });
      auditLog("accrual-fn", "ACCRUAL_RUN", month + " · " + db.users.length + " employees", "OK", "balances");
      save(); return run;
    },
    "GET /policy"(b, q, u) { return { params: db.policy, blackouts: db.blackouts, holidays: db.holidays }; },
    "PUT /policy/:id"(b, q, u, p) {
      need(isHR(u), 403, "FORBIDDEN", "HR only.");
      const pr = db.policy.find((x) => x.name === p.id); if (!pr) fail(404, "NOT_FOUND", "Unknown policy.");
      const v = Number(b.value);
      need(!isNaN(v) && v >= pr.min && v <= pr.max, 400, "OUT_OF_RANGE", pr.label + " must be between " + pr.min + " and " + pr.max + ".");
      const old = pr.value; pr.value = v;
      auditLog(u.name, "POLICY_UPDATED", "/leaveflow/policy/" + pr.name + " " + old + " → " + v, "OK", "balances");
      save(); return pr;
    },
    "GET /users"(b, q, u) { need(isHR(u), 403, "FORBIDDEN", "HR only."); return db.users; }
  };

  function match(method, path) {
    for (const key in routes) {
      const [m, pattern] = key.split(" ");
      if (m !== method) continue;
      const pp = pattern.split("/"); const ap = path.split("/");
      if (pp.length !== ap.length) continue;
      const params = {}; let ok = true;
      for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
        else if (pp[i] !== ap[i]) { ok = false; break; }
      }
      if (ok) return { fn: routes[key], params };
    }
    return null;
  }

  const PUBLIC = ["POST /auth/login", "POST /auth/mfa", "POST /auth/logout"];

  async function mockCall(method, url, body) {
    const base = Number(LF.config.MOCK_LATENCY_MS) || 120; // raise in config.js to preview the loading shimmer
    await new Promise((r) => setTimeout(r, base + Math.random() * base));
    db = load();
    const [path, qs] = url.split("?");
    const q = Object.fromEntries(new URLSearchParams(qs || ""));
    const m = match(method, path);
    if (!m) fail(404, "NOT_FOUND", "No route " + method + " " + path);
    const u = mockMe();
    if (!PUBLIC.includes(method + " " + path)) need(u, 401, "UNAUTHORIZED", "Your session ended. Sign in again.");
    try { return JSON.parse(JSON.stringify(m.fn(body || {}, q, u, m.params))); }
    catch (e) {
      if (e instanceof ApiError && e.status === 403 && u) { auditLog(u.name, "ACCESS_DENIED", method + " " + path, "403", "balances"); save(); }
      throw e;
    }
  }

  // Which API Gateway serves each path (for MOCK = false)
  function serviceFor(path) {
    if (/^\/(approvals|notifications|team-calendar)/.test(path)) return "approvals";
    if (/^\/(balances|calendar|dashboard|audit|accrual-runs|policy|users)/.test(path)) return "balances";
    return "requests";
  }
  async function http(method, url, body, token) {
    const res = await fetch(cfg.APIS[serviceFor(url)] + url, {
      method, headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) { const e = data.error || {}; throw new ApiError(res.status, e.code || "ERROR", e.message || "Something went wrong.", e.details); }
    return data;
  }
  // Live session: Cognito tokens from requests-api. The ID token lasts 15 minutes; refresh it once on a 401.
  function startSession(r) {
    LF.session.set({ idToken: r.idToken, accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user, userId: r.user.id, mfaDone: true, at: Date.now() });
  }
  async function refreshTokens() {
    const s = LF.session.get();
    if (!s || !s.refreshToken) return false;
    try {
      const r = await http("POST", "/auth/refresh", { refreshToken: s.refreshToken });
      LF.session.set(Object.assign(s, { idToken: r.idToken, accessToken: r.accessToken, user: r.user || s.user }));
      return true;
    } catch (e) { return false; }
  }
  async function realCall(method, url, body) {
    const path = url.split("?")[0];
    const s = LF.session.get() || {};
    if (path === "/auth/login") {
      const r = await http("POST", url, body);
      if (r.mfaRequired) { LF.session.set({ pending: { email: body.email, session: r.session } }); return { mfaRequired: true }; }
      if (r.mfaSetupRequired) { LF.session.set({ setup: { email: body.email, accessToken: r.accessToken } }); return { mfaSetupRequired: true }; }
      startSession(r); return { mfaRequired: false, role: r.role };
    }
    if (path === "/auth/mfa") {
      const p = s.pending || {};
      if (!p.session) throw new ApiError(401, "NO_SESSION", "Start again from sign-in.");
      const r = await http("POST", url, { email: p.email, session: p.session, code: body.code });
      startSession(r); return { ok: true };
    }
    if (path === "/auth/mfa/setup" || path === "/auth/mfa/verify") {
      if (!s.setup) throw new ApiError(401, "NO_SESSION", "Start again from sign-in.");
      return http("POST", url, Object.assign({}, body, { accessToken: s.setup.accessToken }));
    }
    if (path === "/auth/logout") {
      if (s.accessToken) await http("POST", url, { accessToken: s.accessToken }).catch(() => null); // revokes refresh tokens in Cognito
      LF.session.clear(); return { ok: true };
    }
    try { return await http(method, url, body, s.idToken); }
    catch (e) {
      if (e.status === 401 && await refreshTokens()) return http(method, url, body, LF.session.get().idToken);
      throw e;
    }
  }

  const call = (method, url, body) => (live(serviceFor(url.split("?")[0])) ? realCall(method, url, body) : mockCall(method, url, body));
  LF.api = {
    get: (u) => call("GET", u), post: (u, b) => call("POST", u, b), patch: (u, b) => call("PATCH", u, b),
    put: (u, b) => call("PUT", u, b), del: (u) => call("DELETE", u),
    // Medical certificate: ask requests-api for a 5-minute S3 upload form, then send the file straight to S3.
    async uploadCertificate(requestId, file) {
      if (!live("requests")) return { ok: true, mock: true };
      const link = await call("POST", "/leave-requests/" + encodeURIComponent(requestId) + "/certificate", { contentType: file.type });
      const form = new FormData();
      Object.entries(link.fields).forEach(([k, v]) => form.append(k, v));
      form.append("file", file);
      const res = await fetch(link.url, { method: "POST", body: form });
      if (!res.ok) throw new ApiError(res.status, "UPLOAD_FAILED", "The file was refused. Use a PDF, JPG or PNG up to 5 MB.");
      return { ok: true };
    },
    async certificateLink(requestId) {
      if (!live("requests")) throw new ApiError(404, "NOT_FOUND", "Certificates need the live requests API.");
      return call("GET", "/leave-requests/" + encodeURIComponent(requestId) + "/certificate");
    },
    me: () => me(), userName: (id) => (user(id) || {}).name
  };
})();
