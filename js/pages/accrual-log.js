/* Accrual log: monthly runs by EventBridge Scheduler, plus a manual run for the demo. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "Settings", title: "Accrual log", roles: ["HRAdmin"], lead: "1.75 Annual days are added to everyone on the 1st of each month. Running a month again changes nothing.",
    actions: () => [h("button", { class: "btn", id: "run" }, icon("refresh"), "Run December now")] }, async (content) => {
    const body = h("div");
    content.append(body);
    document.getElementById("run").addEventListener("click", () => LF.modal({ eyebrow: "Monthly accrual", title: "Run December 2026 accrual?",
      body: [h("p", { class: "body-md m0", text: "Adds this month's accrual to every employee, pro-rata for anyone who joined mid-month. This normally happens automatically on 1 December." })],
      actions: (close) => [h("button", { class: "btn btn-outline-dark", text: "Cancel", onclick: close }), h("button", { class: "btn", text: "Run now", onclick: async (e) => {
        LF.busy(e.currentTarget, true);
        try { const r = await LF.api.post("/accrual-runs"); LF.toast("Accrual ran: " + fmt.days(r.totalDays) + " for " + r.employees + " people."); }
        catch (x) { LF.toast(x.message, "error"); }
        close(); load();
      } })] }));
    function load() { return LF.reload(body, () => LF.api.get("/accrual-runs"), (runs) => {
      const last = runs[0];
      body.replaceChildren(
        h("div", { class: "grid-3" },
          h("div", { class: "card dark stat" }, h("span", { class: "caption-upper", text: "Last run" }), h("span", { class: "value", text: last.label.split(" ")[0] }), h("span", { class: "caption", text: fmt.dt(last.startedAt) + " · " + last.trigger })),
          h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Days added this year" }), h("span", { class: "value", text: fmt.num(runs.reduce((a, r) => a + r.totalDays, 0)) })),
          h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Next scheduled" }), h("span", { class: "value", text: "1 Jan" }), h("span", { class: "caption muted", text: "with year-end carry-over (up to 5 days)" }))),
        h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" },
          h("thead", null, h("tr", null, ["Month", "Started", "Trigger", "Employees", "Pro-rata", "Days added", "Status"].map((t, i) => h("th", { class: i >= 3 && i <= 5 ? "right" : null, text: t })))),
          h("tbody", null, runs.map((r) => h("tr", null,
            h("td", null, h("div", { class: "cell-main", text: r.label }), h("div", { class: "cell-sub", text: r.duplicatesSkipped ? "Ran once · " + r.duplicatesSkipped + " repeat start ignored" : "Ran once" })),
            h("td", { class: "hide-sm muted", text: fmt.dt(r.startedAt) }),
            h("td", { class: "hide-sm" }, h("span", { class: "chip", text: r.trigger })),
            h("td", { class: "right num hide-sm", text: r.employees }),
            h("td", { class: "right num hide-sm", text: r.proRata || "—" }),
            h("td", { class: "right num cell-main", text: "+" + fmt.num(r.totalDays) }),
            h("td", { class: "right hide-sm" }, h("span", { class: "chip s-approved", text: r.status }))))))));
    }, { label: "Loading accrual runs…" }); }
    await load();
  });
})();
