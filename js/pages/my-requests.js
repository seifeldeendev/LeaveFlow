/* My requests: list with status / type / date filters. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({
    eyebrow: "Leave requests", title: "My requests",
    lead: "Everything you've asked for, and where it stands.",
    actions: (u) => u.role !== "HRAdmin" ? [h("a", { class: "btn", href: LF.url("pages/requests/new-request.html") }, icon("plus"), "New request")] : []
  }, async (content) => {
    const state = { status: LF.q("status") || "", type: "", from: "", to: "" };
    const statuses = ["", "Pending", "Approved", "Rejected", "Cancelled", "Withdrawn"];
    const tabs = h("div", { class: "tabs", role: "group", "aria-label": "Status" }, statuses.map((s) => h("button", { class: "tab", "aria-pressed": String(state.status === s), text: s || "All", onclick: (e) => { state.status = s; tabs.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-pressed", String(t === e.currentTarget))); load(); } })));
    const type = h("select", { class: "select", id: "f-type", onchange: (e) => { state.type = e.target.value; load(); } }, ["", "Annual", "Casual", "Sick", "Unpaid"].map((t) => h("option", { value: t, text: t || "All types" })));
    const from = h("input", { class: "input", type: "date", id: "f-from", onchange: (e) => { state.from = e.target.value; load(); } });
    const to = h("input", { class: "input", type: "date", id: "f-to", onchange: (e) => { state.to = e.target.value; load(); } });
    const list = h("div");
    content.append(h("section", null,
      h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { for: "f-type", text: "Type" }), type), h("div", { class: "field" }, h("label", { for: "f-from", text: "From" }), from), h("div", { class: "field" }, h("label", { for: "f-to", text: "To" }), to)),
      h("div", { class: "section-head" }, tabs), list));

    function load() {
      const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v)).toString();
      return LF.reload(list, () => LF.api.get("/leave-requests" + (qs ? "?" + qs : "")), (rows) => {
      if (!rows.length) { list.replaceChildren(LF.empty("No requests match", "Try another filter, or make a new request.")); return; }
      list.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" },
        h("thead", null, h("tr", null, ["Request", "Dates", "Type", "Days", "Submitted", "Status"].map((t, i) => h("th", { class: i === 3 ? "right" : null, text: t })))),
        h("tbody", null, rows.map((r) => h("tr", { class: "clickable", tabindex: "0", onclick: () => open(r), onkeydown: (e) => { if (e.key === "Enter") open(r); } },
          h("td", { class: "hide-sm" }, h("span", { class: "cell-main", text: r.id })),
          h("td", null, h("div", { class: "cell-main", text: fmt.range(r.start, r.end) }), h("div", { class: "cell-sub", text: r.reason })),
          h("td", { class: "hide-sm" }, LF.typeChip(r.type)),
          h("td", { class: "right num hide-sm", text: fmt.num(r.workingDays) }),
          h("td", { class: "hide-sm muted", text: fmt.dt(r.createdAt) }),
          h("td", { class: "right" }, LF.status(r.status))))))));
    }, { label: "Loading your requests…" });
    }
    const open = (r) => (location.href = LF.url("pages/requests/request.html?id=" + r.id));
    load();
  });
})();
