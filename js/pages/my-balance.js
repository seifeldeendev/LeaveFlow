/* My balance: totals plus the append-only ledger that produces them. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "Balance & accrual", title: "My balance", lead: "Every day added or taken, in order. Nothing is ever edited; corrections show up as new entries." }, async (content) => {
    const [bal, ledger] = await Promise.all([LF.api.get("/balances/me"), LF.api.get("/balances/me/ledger")]);
    const accrued = ledger.filter((e) => e.kind === "Accrual" && e.type === "Annual").reduce((a, e) => a + e.amount, 0);
    const used = -ledger.filter((e) => e.kind === "Deduction" && e.type === "Annual").reduce((a, e) => a + e.amount, 0);
    content.append(h("div", { class: "grid-4" },
      h("div", { class: "card red stat" }, h("span", { class: "caption-upper", text: "Annual · available now" }), h("span", { class: "value", text: fmt.num(bal.Annual.available) }), h("span", { class: "caption", text: "After pending requests: " + fmt.num(bal.Annual.projected) }),
        h("span", { class: "caption carry" }, Math.max(0, bal.Annual.projected - 5) > 0 ? "Up to 5 days carry over on 1 Jan. " + fmt.days(Math.max(0, bal.Annual.projected - 5)) + " will expire if not used." : "All of it carries over on 1 Jan (the limit is 5 days).")),
      h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Accrued this year" }), h("span", { class: "value", text: fmt.num(accrued) }), h("span", { class: "caption muted", text: "1.75 a month, on the 1st" })),
      h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Annual used" }), h("span", { class: "value", text: fmt.num(used) }), h("span", { class: "caption muted", text: "net of refunds shown below" })),
      h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Casual · available now" }), h("span", { class: "value", text: fmt.num(bal.Casual.available) }), h("span", { class: "caption muted", text: "of 6 a year" }))));
    content.append(h("div", { class: "notice" }, icon("info"), h("span", { text: "Up to 5 unused Annual days carry over to next year. The rest are dropped on 1 January." })));

    const KIND = { Accrual: "Added monthly", Deduction: "Leave taken", Refund: "Returned", Adjustment: "HR correction", "Carry-over": "Carried over" };
    let filter = "";
    const tabs = h("div", { class: "tabs" }, ["", "Accrual", "Deduction", "Refund", "Adjustment", "Carry-over"].map((k) => h("button", { class: "tab", "aria-pressed": String(k === filter), text: k ? KIND[k] : "All", onclick: (e) => { filter = k; tabs.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-pressed", String(t === e.currentTarget))); draw(); } })));
    const body = h("div");
    content.append(h("section", null, h("div", { class: "section-head" }, h("h2", { class: "display-md", text: "History" }), tabs), body));
    function draw() {
      const rows = ledger.filter((e) => !filter || e.kind === filter);
      body.replaceChildren(rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" },
        h("thead", null, h("tr", null, ["Date", "Entry", "Type", "Reference", "Change", "Balance after"].map((t, i) => h("th", { class: i >= 4 ? "right" : null, text: t })))),
        h("tbody", null, rows.map((e) => h("tr", null,
          h("td", { class: "muted", text: fmt.d(e.at.slice(0, 10)) }),
          h("td", null, h("div", { class: "cell-main", text: KIND[e.kind] || e.kind }), h("div", { class: "cell-sub", text: e.note })),
          h("td", { class: "hide-sm" }, LF.typeChip(e.type)),
          h("td", { class: "hide-sm" }, /^LR-/.test(e.ref) ? h("a", { href: LF.url("pages/requests/request.html?id=" + e.ref), text: e.ref }) : h("span", { class: "muted", text: e.ref })),
          h("td", { class: "right num cell-main" + (e.amount < 0 ? " text-red" : ""), text: fmt.signed(e.amount) }),
          h("td", { class: "right num hide-sm", text: fmt.num(e.balanceAfter) })))))) : LF.empty("No entries", "Nothing of this kind yet."));
    }
    draw();
  });
})();
