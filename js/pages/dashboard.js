/* HR absence dashboard: who's off this week, days taken by department and month, pending work. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "People", title: "Absence dashboard", roles: ["HRAdmin"], lead: "Who's off, where the days go, and what's waiting on someone." }, async (content) => {
    const d = await LF.api.get("/dashboard");
    content.append(h("div", { class: "grid-4" },
      h("div", { class: "card dark stat" }, h("span", { class: "caption-upper", text: "Off today" }), h("span", { class: "value", text: d.offToday.length }), h("span", { class: "caption", text: "of " + d.headcount + " people" })),
      h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Off this week" }), h("span", { class: "value", text: d.offWeek.length }), h("span", { class: "caption muted", text: fmt.dShort(d.weekStart) + " – " + fmt.dShort(d.weekEnd) })),
      h("a", { class: "card red stat", href: LF.url("pages/approvals/queue.html"), style: { textDecoration: "none" } }, h("span", { class: "caption-upper", text: "Pending decisions" }), h("span", { class: "value", text: d.pending }), h("span", { class: "caption", text: d.escalated + " escalated to HR" })),
      h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Low balances" }), h("span", { class: "value", text: d.low.length }), h("span", { class: "caption muted", text: "under 3 Annual days" }))));

    const maxM = Math.max(...d.byMonth.map((m) => m.days), 1);
    const curM = Number(LF.date.today().slice(5, 7)) - 1;
    const months = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "Days taken per month, 2026" }), h("span", { class: "caption muted", text: "Approved working days, all departments" })),
      h("div", { class: "cols", role: "img", "aria-label": d.byMonth.map((m) => m.month + " " + m.days).join(", ") }, d.byMonth.map((m, i) => h("div", { class: "col" + (i === curM ? " cur" : "") },
        h("b", { class: "num", text: m.days || "" }), h("span", { class: "c", style: { height: (m.days / maxM) * 130 + "px" } }), h("small", { text: m.month })))));
    const maxD = Math.max(...d.byDept.map((x) => x.days / x.headcount), 1);
    const top = d.byDept.reduce((a, b) => (b.days / b.headcount > a.days / a.headcount ? b : a));
    const depts = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "Days per person by department" }), h("span", { class: "caption muted", text: "2026, approved" })),
      h("div", { class: "bars" }, d.byDept.map((x) => h("div", { class: "bar-row" + (x === top ? " top" : "") },
        h("span", { class: "ellipsis", text: x.dept, title: x.dept }), h("div", { class: "bar-track" }, h("div", { class: "bar-fill", style: { width: ((x.days / x.headcount) / maxD) * 100 + "%" } })), h("b", { class: "num right", text: fmt.num(x.days / x.headcount) })))),
      h("p", { class: "caption muted mt-24", text: "Headcount: " + d.byDept.map((x) => x.dept + " " + x.headcount).join(" · ") }));
    content.append(h("div", { class: "split" }, months, depts));

    const off = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "Off this week" }), h("a", { class: "caption-strong", href: LF.url("pages/balance/calendar.html"), text: "Company calendar" })),
      d.offWeek.length ? h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" }, h("tbody", null, d.offWeek.map((r) => h("tr", null,
        h("td", null, h("div", { class: "cell-main", text: r.employee.name }), h("div", { class: "cell-sub", text: r.employee.dept })),
        h("td", { class: "hide-sm" }, LF.typeChip(r.type)),
        h("td", { class: "right", text: fmt.range(r.start, r.end).replace(/ \d{4}$/, "") })))))) : h("p", { class: "muted", text: "Nobody is off this week." }));
    const low = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "Low Annual balances" }), h("a", { class: "caption-strong", href: LF.url("pages/balance/hr-balances.html"), text: "All balances" })),
      d.low.length ? h("div", { class: "stack" }, d.low.map((x) => h("div", { class: "snap-row" }, h("span", null, h("b", { text: x.name }), h("span", { class: "muted", text: " · " + x.dept })), h("b", { class: "num text-red", text: fmt.days(x.available) })))) : h("p", { class: "muted", text: "Nobody is below 3 days." }));
    content.append(h("div", { class: "grid-2" }, off, low));
  });
})();
