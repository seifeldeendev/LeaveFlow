/* Audit log search (append-only; who, action, target, time, result). */
(function () {
  const { h, icon, fmt } = LF;
  const ACTIONS = ["", "REQUEST_SUBMITTED", "REQUEST_APPROVED", "REQUEST_REJECTED", "REQUEST_ESCALATED", "REQUEST_CANCELLED", "BALANCE_ADJUSTED", "POLICY_UPDATED", "ACCRUAL_RUN", "LOGIN_FAILED", "ACCOUNT_LOCKED", "ACCESS_DENIED", "EVENT_DUPLICATE_SKIPPED"];
  const human = (c) => c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " ");
  LF.page({ eyebrow: "Settings", title: "Audit log", roles: ["HRAdmin"], lead: "Every approval, balance change, policy edit and security event. Entries can't be changed or deleted, by anyone." }, async (content) => {
    const st = { actor: "", action: "", from: "", to: "" };
    const actor = h("input", { class: "input", id: "a-actor", type: "search", placeholder: "Name" });
    const action = h("select", { class: "select", id: "a-action" }, ACTIONS.map((a) => h("option", { value: a, text: a ? human(a) : "All actions" })));
    const from = h("input", { class: "input", id: "a-from", type: "date" });
    const to = h("input", { class: "input", id: "a-to", type: "date" });
    const body = h("div");
    const form = h("form", { class: "filters", onsubmit: (e) => { e.preventDefault(); st.actor = actor.value; st.action = action.value; st.from = from.value; st.to = to.value; load(); } },
      h("div", { class: "field" }, h("label", { for: "a-actor", text: "Who" }), actor),
      h("div", { class: "field" }, h("label", { for: "a-action", text: "Action" }), action),
      h("div", { class: "field" }, h("label", { for: "a-from", text: "From" }), from),
      h("div", { class: "field" }, h("label", { for: "a-to", text: "To" }), to),
      h("button", { class: "btn", type: "submit" }, icon("search"), "Search"));
    content.append(h("section", null, form, body));
    const SEC = ["LOGIN_FAILED", "ACCOUNT_LOCKED", "ACCESS_DENIED"];
    function load() { return LF.reload(body, () => LF.api.get("/audit?" + new URLSearchParams(Object.entries(st).filter(([, v]) => v))), (rows) => {
      body.replaceChildren(h("p", { class: "caption muted", text: rows.length + " entries" }), rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" },
        h("thead", null, h("tr", null, ["Time (Cairo)", "Who", "Action", "Target", "Area", "Result"].map((t) => h("th", { text: t })))),
        h("tbody", null, rows.map((a) => h("tr", null,
          h("td", { class: "hide-sm muted num", text: fmt.dt(a.at) }),
          h("td", null, h("div", { class: "cell-main", text: a.actor }), h("div", { class: "cell-sub", text: human(a.action) + " · " + fmt.dt(a.at) })),
          h("td", { class: "hide-sm" }, h("span", { class: "chip" + (SEC.includes(a.action) ? " s-rejected" : ""), text: human(a.action) })),
          h("td", { class: "hide-sm", text: a.target }),
          h("td", { class: "hide-sm muted", text: a.service ? a.service.charAt(0).toUpperCase() + a.service.slice(1) : "—" }),
          h("td", { class: "right" }, h("span", { class: "chip" + (a.result === "OK" ? " s-approved" : a.result === "SKIPPED" ? "" : " s-rejected"), text: a.result }))))))) : LF.empty("No entries match", "Try a wider date range."));
    }, { label: "Searching the audit log…" }); }
    await load();
  });
})();
