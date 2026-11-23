/* Shared UI: element builder (text always via textContent), icons, app shell,
   modal, toast, formatting, auth guard and the 15-minute idle logout. */
window.LF = window.LF || {};
(function () {
  const root = document.body.dataset.root || "./";
  LF.root = root;
  LF.url = (p) => root + p;

  /* ---------- element builder ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") Object.assign(el.style, v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    kids.flat(Infinity).forEach((c) => { if (c === null || c === undefined || c === false) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  LF.h = h;

  /* ---------- icons (stroke, 24px grid) ---------- */
  const P = {
    home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
    list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
    plus: "M12 5v14M5 12h14",
    wallet: "M3 7h15a3 3 0 013 3v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0V6a2 2 0 012-2h11M16 14h.01",
    bell: "M6 9a6 6 0 1112 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2 2 0 004 0",
    check: "M5 12.5l4.5 4.5L19 7.5",
    inbox: "M3 13l3-8h12l3 8v6H3v-6zm0 0h5l1 2h6l1-2h5",
    calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    history: "M3 12a9 9 0 103-6.7M3 4v4h4M12 8v4l3 2",
    users: "M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M15.5 3.1a3.5 3.5 0 010 6.8",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    file: "M14 3H6v18h12V7l-4-4zM14 3v4h4M9 13h6M9 17h6",
    settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
    logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
    menu: "M3 6h18M3 12h18M3 18h18",
    x: "M6 6l12 12M18 6L6 18",
    alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
    info: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01",
    ok: "M22 11.1V12a10 10 0 11-5.9-9.1M22 4L12 14l-3-3",
    xcircle: "M12 22a10 10 0 100-20 10 10 0 000 20zM15 9l-6 6M9 9l6 6",
    chevron: "M9 18l6-6-6-6",
    chevronL: "M15 18l-6-6 6-6",
    clock: "M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2",
    download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
    search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0020.5 15",
    upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12",
    arrow: "M5 12h14M13 6l6 6-6 6",
    sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
  };
  function icon(name, size) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (size) { svg.setAttribute("width", size); svg.setAttribute("height", size); }
    const p = document.createElementNS(ns, "path"); p.setAttribute("d", P[name] || P.info); svg.append(p);
    return svg;
  }
  LF.icon = icon;

  // Generic LeaveFlow mark: a red tile with two forward chevrons ("flow").
  function logoMark(big) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M4 5h4.6l6 7-6 7H4l6-7-6-7zm7.4 0H16l6 7-6 7h-4.6l6-7-6-7z");
    p.setAttribute("fill", "currentColor"); svg.append(p);
    return h("span", { class: "logo-orb" + (big ? " lg" : "") }, svg);
  }
  LF.logoMark = logoMark;
  LF.logo = (href) => h("a", { class: "logo", href: href || LF.url("index.html"), "aria-label": "LeaveFlow home" }, logoMark(), h("span", { class: "logo-word", text: "LeaveFlow" }));

  /* ---------- formatting ---------- */
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const DTF = new Intl.DateTimeFormat("en-GB", { timeZone: (LF.config && LF.config.TIME_ZONE) || "Africa/Cairo", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  LF.fmt = {
    d(s) { const d = LF.date.parse(s); return d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear(); },
    dShort(s) { const d = LF.date.parse(s); return d.getUTCDate() + " " + MON[d.getUTCMonth()]; },
    dDow(s) { const d = LF.date.parse(s); return DOW[d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()]; },
    range(a, b) {
      if (a === b) return LF.fmt.d(a);
      const A = LF.date.parse(a), B = LF.date.parse(b);
      if (A.getUTCFullYear() === B.getUTCFullYear() && A.getUTCMonth() === B.getUTCMonth()) return A.getUTCDate() + "–" + B.getUTCDate() + " " + MON[B.getUTCMonth()] + " " + B.getUTCFullYear();
      return LF.fmt.dShort(a) + " – " + LF.fmt.d(b);
    },
    // Timestamps are stored in UTC; show them on the company's clock (Cairo, incl. summer time).
    dt(iso) {
      const p = {}; DTF.formatToParts(new Date(iso)).forEach((x) => (p[x.type] = x.value));
      return Number(p.day) + " " + MON[Number(p.month) - 1] + " " + p.year + ", " + (p.hour === "24" ? "00" : p.hour) + ":" + p.minute;
    },
    ago(iso) {
      const now = LF.config.MOCK ? Date.parse(LF.config.MOCK_TODAY + "T12:00:00Z") : Date.now();
      const m = Math.round((now - Date.parse(iso)) / 60000);
      if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const hr = Math.round(m / 60); if (hr < 48) return hr + " h ago"; return Math.round(hr / 24) + " days ago";
    },
    days(n) { const v = Math.round(n * 100) / 100; return (Number.isInteger(v) ? v : v.toFixed(2)) + " day" + (v === 1 ? "" : "s"); },
    num(n) { const v = Math.round(n * 100) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); },
    signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + LF.fmt.num(Math.abs(n)); },
    initials(name) {
      const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return "?";
      if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
      return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
    },
    role(r) { return r === "HRAdmin" ? "HR Admin" : r; }
  };
  LF.status = (s) => h("span", { class: "chip s-" + String(s).toLowerCase(), text: s });
  LF.typeChip = (t) => h("span", { class: "chip t-" + String(t).toLowerCase(), text: t });

  /* ---------- toast + modal ---------- */
  let host;
  LF.toast = function (msg, type) {
    if (!host) { host = h("div", { class: "toast-host", "aria-live": "polite" }); document.body.append(host); }
    const kind = type === "error" || type === "info" ? type : "success";
    const t = h("div", { class: "toast " + kind, role: kind === "error" ? "alert" : "status", text: msg }); host.append(t);
    setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 260); }, kind === "error" ? 7000 : 4000);
  };
  LF.modal = function ({ eyebrow, title, body, actions }) {
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; document.removeEventListener("keydown", onKey);
      if (reduced()) { back.remove(); return; }
      back.classList.add("closing"); setTimeout(() => back.remove(), 190);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    const back = h("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === back) close(); } },
      h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
        h("div", { class: "modal-head" },
          h("div", { class: "stack" }, eyebrow ? h("p", { class: "caption-upper m0", text: eyebrow }) : null, h("h2", { class: "display-sm", text: title })),
          h("button", { class: "btn-icon", "aria-label": "Close", onclick: close }, icon("x"))),
        h("div", { class: "modal-body" }, body),
        actions ? h("div", { class: "modal-foot" }, actions(close)) : null));
    document.body.append(back); document.addEventListener("keydown", onKey);
    const f = back.querySelector("textarea, input, select, button.btn"); if (f) setTimeout(() => f.focus(), 30);
    return close;
  };
  LF.errorBox = (err, retry) => h("div", { class: "notice block", role: "alert" }, icon("alert"),
    h("div", { class: "grow" }, h("b", { text: err.message || "Something went wrong." })),
    retry ? h("button", { class: "btn btn-sm btn-outline-dark", type: "button", onclick: retry }, icon("refresh"), "Try again") : null);

  /* ---------- theme ---------- */
  const THEME_KEY = "lf-theme";
  function savedTheme() { try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; } }
  function applyTheme(t) { document.documentElement.setAttribute("data-theme", t); }
  LF.setTheme = (t) => { applyTheme(t); try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode */ } };

  /* ---------- motion helpers ---------- */
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  LF.reducedMotion = reduced;

  // Thin green bar across the top while a page loads or navigates.
  const progress = (function () {
    let el, timer;
    function ensure() { if (!el || !el.isConnected) { el = h("div", { class: "progress-bar", "aria-hidden": "true" }, h("span")); document.documentElement.append(el); } return el; }
    return {
      start() { const b = ensure(); clearTimeout(timer); b.className = "progress-bar"; void b.offsetWidth; b.className = "progress-bar run"; },
      done() { const b = ensure(); b.className = "progress-bar run done"; timer = setTimeout(() => { b.className = "progress-bar"; }, 700); }
    };
  })();
  LF.progress = progress;

  function bootLoader() {
    return h("div", { class: "loader boot", role: "status" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")), h("span", { class: "sr-only", text: "Loading" }));
  }

  /* ---------- shimmer placeholders (text-shaped, for while the API answers) ---------- */
  // One shimmering bar the size of a line of text. w = width (e.g. "60%"), size = "xs|sm|md|lg|xl".
  const sk = (w, size) => { const s = h("span", { class: "sk sk-" + (size || "sm") }); s.style.width = w; return s; };
  LF.sk = sk;
  // A block of text lines with natural, uneven widths.
  LF.skelText = (n, size) => h("div", { class: "sk-stack", "aria-hidden": "true" }, Array.from({ length: n || 3 }, (_, i) => sk([92, 78, 86, 64, 70][i % 5] + "%", size)));
  // Table-shaped placeholder: n rows of a two-line cell, a middle value and a pill.
  LF.skelRows = (n) => h("div", { class: "sk-rows", "aria-hidden": "true" }, Array.from({ length: n || 5 }, (_, i) =>
    h("div", { class: "sk-row" }, h("div", { class: "sk-stack" }, sk([46, 38, 52, 34, 42][i % 5] + "%", "md"), sk([28, 34, 22, 30, 26][i % 5] + "%", "xs")), sk("14%", "sm"), sk("64px", "pill"))));
  // Put real content into a "refreshing" state while new data loads: text shimmers in place.
  LF.refreshing = (el, on) => { if (!el) return; el.classList.toggle("is-refreshing", !!on); if (on) el.setAttribute("aria-busy", "true"); else el.removeAttribute("aria-busy"); };
  // Load data into a section safely:
  //  - first load shows a shimmer placeholder, later loads shimmer the existing content in place
  //  - only the newest call may draw (an older, slower answer can't overwrite a newer filter)
  //  - errors replace the section with a message and a "Try again" button; the shimmer always ends
  LF.reload = async function (el, fetchFn, drawFn, opts) {
    opts = opts || {};
    const id = (el._lfSeq = (el._lfSeq || 0) + 1);
    const hasContent = el.childElementCount && !el.querySelector(":scope > .sk-block, :scope > .notice.block");
    if (hasContent) LF.refreshing(el, true); else el.replaceChildren(LF.loading(opts.label, opts.rows));
    try {
      const data = await fetchFn();
      if (id !== el._lfSeq) return;
      LF.refreshing(el, false);
      drawFn(data);
    } catch (err) {
      if (id !== el._lfSeq) return;
      LF.refreshing(el, false);
      if (err.status === 401) { LF.logout(); return; }
      el.replaceChildren(LF.errorBox(err, () => LF.reload(el, fetchFn, drawFn, opts)));
      console.error(err);
    }
  };

  function skeleton() {
    const statCard = () => h("div", { class: "sk-card" }, sk("42%", "xs"), sk("56%", "xl"), sk("72%", "xs"));
    const tableCard = h("div", { class: "sk-card" }, h("div", { class: "sk-head" }, sk("34%", "lg"), sk("18%", "xs")), LF.skelRows(5));
    const listCard = h("div", { class: "sk-card" }, h("div", { class: "sk-head" }, sk("40%", "lg")),
      Array.from({ length: 4 }, () => h("div", { class: "sk-li" }, h("span", { class: "sk sk-dot" }), LF.skelText(2, "xs"))));
    return h("div", { class: "skel-wrap", "aria-hidden": "true" },
      h("div", { class: "grid-4" }, statCard(), statCard(), statCard(), statCard()),
      h("div", { class: "split" }, tableCard, listCard));
  }

  // Animate numeric stat values from 0 up to their final text.
  function countUp(scope) {
    if (reduced()) return;
    scope.querySelectorAll("[data-count]").forEach((el) => {
      const node = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
      if (!node) return;
      const raw = node.textContent.trim(); if (!/^-?\d+(\.\d+)?$/.test(raw)) return;
      const target = Number(raw); const dec = (raw.split(".")[1] || "").length; if (!target) return;
      const t0 = performance.now(); const dur = 900 + Math.min(600, Math.abs(target) * 8);
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - k, 3);
        node.textContent = (target * e).toFixed(dec);
        if (k < 1) requestAnimationFrame(step); else node.textContent = raw;
      };
      node.textContent = (0).toFixed(dec); requestAnimationFrame(step);
    });
  }
  LF.countUp = countUp;

  // Ripple on pills, tabs and pickers.
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest && e.target.closest(".btn, .tab, .demo-user");
    if (!b || b.disabled || reduced()) return;
    const r = b.getBoundingClientRect(); const size = Math.max(r.width, r.height);
    const dot = document.createElement("span"); dot.className = "ripple";
    Object.assign(dot.style, { width: size + "px", height: size + "px", left: (e.clientX - r.left - size / 2) + "px", top: (e.clientY - r.top - size / 2) + "px" });
    b.append(dot); setTimeout(() => dot.remove(), 650);
  });

  // Progress bar + soft fade when following an internal link.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target || a.hasAttribute("download")) return;
    const href = a.getAttribute("href"); if (!href || href.startsWith("#") || href.startsWith("blob:")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) return;
    progress.start(); document.body.classList.add("leaving");
  });
  window.addEventListener("pageshow", () => document.body.classList.remove("leaving"));

  /* ---------- nav model ---------- */
  const NAV = {
    Employee: [
      ["Me", [["home", "Overview", "pages/home.html"], ["list", "My requests", "pages/requests/my-requests.html"], ["plus", "New request", "pages/requests/new-request.html"], ["wallet", "My balance", "pages/balance/my-balance.html"], ["bell", "Notifications", "pages/notifications.html"]]]
    ],
    Manager: [
      ["Team", [["inbox", "Approvals", "pages/approvals/queue.html", "approvals"], ["calendar", "Team calendar", "pages/approvals/team-calendar.html"], ["history", "Decision history", "pages/approvals/history.html"]]],
      ["My leave", [["home", "Overview", "pages/home.html"], ["list", "My requests", "pages/requests/my-requests.html"], ["plus", "New request", "pages/requests/new-request.html"], ["wallet", "My balance", "pages/balance/my-balance.html"], ["bell", "Notifications", "pages/notifications.html"]]]
    ],
    HRAdmin: [
      ["Approvals", [["inbox", "Approvals", "pages/approvals/queue.html", "approvals"], ["history", "Decision history", "pages/approvals/history.html"]]],
      ["People", [["chart", "Absence dashboard", "pages/balance/dashboard.html"], ["users", "All balances", "pages/balance/hr-balances.html"], ["calendar", "Company calendar", "pages/balance/calendar.html"]]],
      ["Settings", [["settings", "Leave policy", "pages/balance/policy.html"], ["refresh", "Accrual log", "pages/balance/accrual-log.html"], ["shield", "Audit log", "pages/balance/audit.html"]]],
      ["My leave", [["home", "Overview", "pages/home.html"], ["list", "My requests", "pages/requests/my-requests.html"], ["wallet", "My balance", "pages/balance/my-balance.html"], ["bell", "Notifications", "pages/notifications.html"]]]
    ]
  };

  /* ---------- idle logout ---------- */
  function startIdleTimer() {
    let last = Date.now();
    ["mousemove", "keydown", "click", "touchstart", "scroll"].forEach((e) => window.addEventListener(e, () => (last = Date.now()), { passive: true }));
    setInterval(() => { if (Date.now() - last > LF.config.IDLE_LOGOUT_MINUTES * 60000) LF.logout("idle"); }, 30000);
  }
  LF.logout = async function (why) {
    try { await LF.api.post("/auth/logout"); } catch (e) { /* ignore */ }
    LF.session.clear(); location.href = LF.url("login.html" + (why ? "?reason=" + why : ""));
  };

  /* ---------- app shell ---------- */
  // opts: { title, eyebrow, lead, roles: [...], actions: () => nodes }
  LF.page = async function (opts, render) {
    applyTheme(savedTheme());
    const u = LF.api.me();
    if (u) { progress.start(); document.body.append(bootLoader()); }
    if (!u) { const i = location.pathname.indexOf("/pages/"); location.replace(LF.url("login.html?next=" + encodeURIComponent(i >= 0 ? location.pathname.slice(i + 1) : "pages/home.html"))); return; }
    const here = location.pathname.replace(/\/+$/, "");
    const navLinks = []; const sections = NAV[u.role] || NAV.Employee;
    const counts = {};
    // Fetch the header data in parallel so a real server only costs one round trip here.
    const [appr, noteRes] = await Promise.all([
      u.role !== "Employee" ? LF.api.get("/approvals").catch(() => null) : null,
      LF.api.get("/notifications").catch(() => [])
    ]);
    if (appr) counts.approvals = appr.length;
    let notes = noteRes || [];
    const unread = notes.filter((n) => !n.read).length;

    // Floating header: logo tile · pill (sections, or pages when there is only one section) · bell · user pill.
    // Pages inside the active section show as a tab row at the top of the page band.
    const matchSection = sections.findIndex(([, items]) => items.some((it) => here.endsWith(it[2])));
    const active = matchSection >= 0 ? matchSection : sections.length - 1;
    const countFor = (items) => items.reduce((n, it) => n + (it[3] && counts[it[3]] ? counts[it[3]] : 0), 0);
    const pillLink = (text, href, current, count) => {
      const a = h("a", { href: LF.url(href) }, text, count ? h("span", { class: "fn-count", text: count }) : null);
      if (current) a.setAttribute("aria-current", "true");
      navLinks.push(a); return a;
    };
    const single = sections.length === 1;
    const pill = h("nav", { class: "fn-pill", "aria-label": "Main" },
      single ? sections[0][1].map(([, text, href, ck]) => pillLink(text, href, here.endsWith(href), ck && counts[ck]))
        : sections.map(([label, items], i) => pillLink(label, items[0][2], i === active, countFor(items))));
    const subnav = single ? null : h("nav", { class: "subnav tabs", "aria-label": sections[active][0] },
      sections[active][1].map(([ic, text, href, ck]) => {
        const a = h("a", { class: "tab", href: LF.url(href), "aria-pressed": String(here.endsWith(href)) }, icon(ic), h("span", { text }), ck && counts[ck] ? h("span", { class: "count", text: counts[ck] }) : null);
        return a;
      }));

    const bellBtn = h("button", { class: "fn-tile", "aria-label": "Notifications, " + unread + " unread", onclick: () => toggleDrawer() }, icon("bell"), unread ? h("span", { class: "bell-dot", text: unread }) : null);
    let menu = null;
    const userBtn = h("button", { class: "fn-user", "aria-haspopup": "menu", "aria-expanded": "false", onclick: (e) => { e.stopPropagation(); toggleMenu(); } },
      h("span", { class: "avatar red", text: LF.fmt.initials(u.name) }), h("span", { class: "fn-user-name", text: u.name.split(" ")[0], title: u.name }));
    function toggleMenu() {
      if (menu) { menu.remove(); menu = null; userBtn.setAttribute("aria-expanded", "false"); return; }
      menu = h("div", { class: "fn-menu", role: "menu" },
        h("div", { class: "fn-menu-head" }, h("b", { text: u.name }), h("span", { text: LF.fmt.role(u.role) + " · " + u.dept })),
        h("button", { role: "menuitem", onclick: () => { const next = savedTheme() === "light" ? "dark" : "light"; LF.setTheme(next); toggleMenu(); } }, icon(savedTheme() === "light" ? "moon" : "sun"), savedTheme() === "light" ? "Dark theme" : "Light theme"),
        h("button", { role: "menuitem", onclick: () => { LF.resetMock(); LF.toast("Demo data reset.", "info"); setTimeout(() => location.reload(), 600); } }, icon("refresh"), "Reset mock data"),
        h("button", { role: "menuitem", onclick: () => LF.logout() }, icon("logout"), "Sign out"));
      document.body.append(menu); userBtn.setAttribute("aria-expanded", "true");
    }
    document.addEventListener("click", (e) => { if (menu && !menu.contains(e.target)) { menu.remove(); menu = null; userBtn.setAttribute("aria-expanded", "false"); } });
    const top = h("header", { class: "float-nav app" },
      h("a", { class: "fn-logo", href: LF.url("pages/home.html"), "aria-label": "LeaveFlow home" }, LF.logoMark()),
      pill,
      h("div", { class: "fn-right" }, bellBtn, userBtn));

    let drawer = null;
    function toggleDrawer() {
      if (drawer) { drawer.remove(); drawer = null; return; }
      drawer = h("div", { class: "drawer", role: "dialog", "aria-label": "Notifications" },
        h("div", { class: "drawer-head" }, h("b", { text: "Notifications" }), h("a", { href: LF.url("pages/notifications.html"), class: "caption-strong", text: "See all" })),
        notes.length ? notes.slice(0, 6).map((n) => h("a", { class: "note-item" + (n.read ? "" : " unread"), href: LF.url(n.link), onclick: () => { LF.api.patch("/notifications/" + n.id); } }, h("span", { class: "dot" }), h("div", null, h("b", { text: n.title }), h("span", { text: n.body }), h("span", { class: "caption", text: " · " + LF.fmt.ago(n.at) }))))
          : h("p", { class: "muted empty", text: "You're all caught up." }));
      document.body.append(drawer);
    }
    document.addEventListener("click", (e) => { if (drawer && !drawer.contains(e.target) && !bellBtn.contains(e.target)) { drawer.remove(); drawer = null; } });

    const banner = LF.config.MOCK ? h("div", { class: "mock-banner", title: "Nothing here is real. Every call is answered by js/mock-data.js, including the 403 and 404 checks." }, h("b", { text: "Demo" }), h("span", { text: "Sample data" })) : null;

    const band = h("section", { class: "page-band" },
      subnav,
      h("div", { class: "page-band-row" },
        h("div", null, opts.eyebrow ? h("p", { class: "eyebrow", text: opts.eyebrow }) : null, h("h1", { class: "display-xl", text: opts.title }), opts.lead ? h("p", { class: "lead", text: typeof opts.lead === "function" ? opts.lead(u) : opts.lead }) : null),
        opts.actions ? h("div", { class: "btn-row" }, opts.actions(u)) : null));
    const content = h("div", { class: "content is-loading" }, skeleton());
    const main = h("main", { class: "main", id: "main" }, band, content);
    document.body.replaceChildren(...[top, h("div", { class: "shell" }, main), banner].filter(Boolean));
    startIdleTimer();
    const settle = () => { content.classList.remove("is-loading"); const sk = content.querySelector(":scope > .skel-wrap"); if (sk) sk.remove(); progress.done(); countUp(content); };

    if (opts.roles && !opts.roles.includes(u.role)) {
      settle();
      content.append(h("div", { class: "card soft empty" }, h("span", { class: "logo-orb lg" }, icon("shield", 32)), h("h2", { class: "display-xs", text: "This page isn't for your role" }), h("p", { class: "muted", text: "Ask HR if you think you should have access." }), h("a", { class: "btn", href: LF.url("pages/home.html"), text: "Back to overview" })));
      return;
    }
    try { await render(content, u); settle(); }
    catch (err) {
      settle();
      if (err.status === 401) { LF.logout(); return; }
      content.append(LF.errorBox(err));
      console.error(err);
    }
  };

  /* ---------- misc ---------- */
  LF.q = (name) => new URLSearchParams(location.search).get(name);
  LF.loading = (label, rows) => h("div", { class: "sk-block", role: "status" },
    h("span", { class: "shimmer-text caption-upper", text: label || "Loading…" }), LF.skelRows(rows || 4));
  LF.spinner = (cls) => h("span", { class: "spinner" + (cls ? " " + cls : ""), role: "status", "aria-label": "Loading" });
  // Put a button into its busy state (spinner, disabled) and back.
  LF.busy = function (btn, on) {
    if (!btn) return;
    btn.disabled = !!on; btn.classList.toggle("is-busy", !!on);
    if (on) btn.setAttribute("aria-busy", "true"); else btn.removeAttribute("aria-busy");
  };
  LF.empty = (title, text, action) => h("div", { class: "card soft empty" }, h("h3", { class: "display-xs", text: title }), text ? h("p", { class: "muted", text }) : null, action || null);
  LF.downloadCsv = function (name, rows) {
    const esc = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    // Guard against spreadsheet formula injection
    const safe = (v) => { const s = String(v == null ? "" : v); return /^[=+\-@]/.test(s) && isNaN(Number(s)) ? "'" + s : s; };
    const csv = rows.map((r) => r.map((c) => esc(safe(c))).join(",")).join("\n");
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: name }); document.body.append(a); a.click(); a.remove();
  };
})();
