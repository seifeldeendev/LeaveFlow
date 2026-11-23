/* HR: everyone's balances, CSV export, and adjustments with a required reason. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "People", title: "All balances", roles: ["HRAdmin"], lead: "Balances for every employee. Corrections need a reason and are recorded in the audit log.",
    actions: () => [h("button", { class: "btn btn-on-dark", id: "export" }, icon("download"), "Export CSV")] }, async (content) => {
    let dept = ""; let search = ""; let rows = [];
    const sel = h("select", { class: "select", id: "dept", onchange: (e) => { dept = e.target.value; load(); } }, ["", "Sales", "Engineering", "Finance", "HR"].map((d) => h("option", { value: d, text: d || "All departments" })));
    const q = h("input", { class: "input", id: "q", type: "search", placeholder: "Name", oninput: (e) => { search = e.target.value.toLowerCase(); draw(); } });
    const body = h("div");
    content.append(h("section", null, h("div", { class: "filters" }, h("div", { class: "field" }, h("label", { for: "q", text: "Search" }), q), h("div", { class: "field" }, h("label", { for: "dept", text: "Department" }), sel)), body));
    document.getElementById("export").addEventListener("click", () => LF.downloadCsv("leaveflow-balances" + (dept ? "-" + dept.toLowerCase() : "") + ".csv",
      [["Employee", "Department", "Role", "Joined", "Annual available", "Annual pending", "Casual available", "Sick taken 2026"], ...rows.map((r) => [r.name, r.dept, r.role, r.joinDate, r.balance.Annual.available, r.balance.Annual.pending, r.balance.Casual.available, r.balance.Sick.taken])]));

    function load() { return LF.reload(body, () => LF.api.get("/balances" + (dept ? "?department=" + dept : "")), (data) => { rows = data; draw(); }, { label: "Loading balances…" }); }
    function draw() {
      const list = rows.filter((r) => !search || r.name.toLowerCase().includes(search));
      body.replaceChildren(h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" },
        h("thead", null, h("tr", null, ["Employee", "Department", "Annual", "Pending", "Casual", "Sick taken", ""].map((t, i) => h("th", { class: i >= 2 && i <= 5 ? "right" : null, text: t })))),
        h("tbody", null, list.map((r) => h("tr", null,
          h("td", null, h("div", { class: "cell-main ellipsis", text: r.name, title: r.name }), h("div", { class: "cell-sub", text: LF.fmt.role(r.role) + " · joined " + fmt.d(r.joinDate) })),
          h("td", { class: "hide-sm", text: r.dept }),
          h("td", { class: "right num cell-main" + (r.balance.Annual.available < 3 ? " text-red" : ""), text: fmt.num(r.balance.Annual.available) }),
          h("td", { class: "right num hide-sm", text: r.balance.Annual.pending ? fmt.num(r.balance.Annual.pending) : "—" }),
          h("td", { class: "right num hide-sm", text: fmt.num(r.balance.Casual.available) }),
          h("td", { class: "right num hide-sm", text: fmt.num(r.balance.Sick.taken) }),
          h("td", { class: "right full-sm" }, h("button", { class: "btn btn-sm btn-outline-red", text: "Adjust", onclick: () => adjust(r) }))))))));
    }

    function adjust(r) {
      const type = h("select", { class: "select", id: "adj-type" }, ["Annual", "Casual"].map((t) => h("option", { value: t, text: t })));
      const amount = h("input", { class: "input", id: "adj-amount", type: "number", step: "0.25", min: "-10", max: "10", placeholder: "e.g. 1 or -0.5" });
      const reason = h("textarea", { class: "textarea", id: "adj-reason", maxlength: "300", placeholder: "Required. Why is this changing?" });
      const err = h("div", { "aria-live": "assertive" });
      LF.modal({ eyebrow: r.name + " · " + r.dept, title: "Adjust balance",
        body: [h("div", { class: "snap-row" }, h("span", { class: "muted", text: "Annual now" }), h("b", { text: fmt.days(r.balance.Annual.available) })),
          h("div", { class: "form-grid" }, h("div", { class: "field" }, h("label", { for: "adj-type", text: "Balance" }), type), h("div", { class: "field" }, h("label", { for: "adj-amount", text: "Change (days)" }), amount),
            h("div", { class: "field full" }, h("label", { for: "adj-reason", text: "Reason" }), reason, h("span", { class: "hint", text: "Saved in the employee's history and the audit log with your name. It can't be edited later." }))), err],
        actions: (close) => [h("button", { class: "btn btn-outline-dark", text: "Cancel", onclick: close }),
          h("button", { class: "btn", text: "Save adjustment", onclick: async (e) => {
            const b = e.currentTarget; LF.busy(b, true);
            err.replaceChildren();
            try { await LF.api.post("/balances/" + r.id + "/adjustments", { type: type.value, amount: amount.value, reason: reason.value }); close(); LF.toast("Adjustment saved for " + r.name + "."); load(); }
            catch (x) { err.append(LF.errorBox(x)); if (x.code === "REASON_REQUIRED") reason.setAttribute("aria-invalid", "true"); if (x.code === "BAD_AMOUNT") amount.setAttribute("aria-invalid", "true"); LF.busy(b, false); }
          } })] });
    }
    await load();
  });
})();
