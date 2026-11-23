/* Overview: balances at a glance, upcoming leave, and the role's to-do. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({
    eyebrow: "Overview",
    title: "Hello, " + ((LF.api.me() || { name: "there" }).name.split(" ")[0]) + ".",
    lead: (u) => u.role === "HRAdmin" ? "Here's who is off, what's waiting and how balances look across the company." : u.role === "Manager" ? "Your team's requests and your own leave, in one place." : "Your balance, your requests and what's coming up.",
    actions: (u) => [
      u.role !== "HRAdmin" ? h("a", { class: "btn", href: LF.url("pages/requests/new-request.html") }, icon("plus"), "New request") : h("a", { class: "btn", href: LF.url("pages/balance/dashboard.html") }, icon("chart"), "Absence dashboard"),
      h("a", { class: "btn btn-on-dark", href: LF.url("pages/balance/my-balance.html"), text: "My balance" })
    ]
  }, async (content, u) => {
    const [bal, reqs, notes] = await Promise.all([LF.api.get("/balances/me"), LF.api.get("/leave-requests"), LF.api.get("/notifications")]);
    const today = LF.date.today();

    // Role to-do
    if (u.role !== "Employee") {
      const queue = await LF.api.get("/approvals");
      const warn = queue.filter((t) => t.coverage.level !== "ok").length;
      const esc = queue.filter((t) => t.escalated).length;
      content.append(h("a", { class: "card red", href: LF.url("pages/approvals/queue.html"), style: { textDecoration: "none" } },
        h("div", { class: "page-band-row" },
          h("div", { class: "stack" },
            h("p", { class: "eyebrow m0", text: "Waiting for you" }),
            h("p", { class: "display-xl m0", text: queue.length + (queue.length === 1 ? " request" : " requests") }),
            h("p", { class: "body-md m0", text: [warn ? warn + " with a coverage warning" : null, esc ? esc + " escalated" : null].filter(Boolean).join(" · ") || "Nothing unusual." })),
          h("span", { class: "btn btn-on-dark" }, "Open queue", icon("arrow")))));
    }

    // Balance tiles
    const pct = (a, y) => Math.max(0, Math.min(100, (a / y) * 100));
    content.append(h("section", null,
      h("div", { class: "section-head" }, h("h2", { class: "display-md", text: "Your balance" }), h("a", { class: "caption-strong", href: LF.url("pages/balance/my-balance.html"), text: "See history" })),
      h("div", { class: "grid-4" },
        h("div", { class: "card dark stat" }, h("span", { class: "caption-upper", text: "Annual · available now" }), h("span", { class: "value", text: fmt.num(bal.Annual.available) }), h("div", { class: "meter" }, h("span", { style: { width: pct(bal.Annual.available, 26) + "%" } })), h("span", { class: "caption", text: "After pending requests: " + fmt.num(bal.Annual.projected) })),
        h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Casual · available now" }), h("span", { class: "value", text: fmt.num(bal.Casual.available) }), h("div", { class: "meter" }, h("span", { style: { width: pct(bal.Casual.available, 6) + "%" } })), h("span", { class: "caption muted", text: "of 6 a year" })),
        h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Pending days" }), h("span", { class: "value", text: fmt.num(bal.Annual.pending + bal.Casual.pending) }), h("span", { class: "caption muted", text: "held until a decision" })),
        h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Sick days this year" }), h("span", { class: "value", text: fmt.num(bal.Sick.taken) }), h("span", { class: "caption muted", text: "not deducted from Annual" })))));

    // Upcoming + notifications
    const upcoming = reqs.filter((r) => (r.status === "Approved" || r.status === "Pending") && r.end >= today).sort((a, b) => a.start.localeCompare(b.start));
    const upCard = h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "Coming up" }), h("a", { class: "caption-strong", href: LF.url("pages/requests/my-requests.html"), text: "All requests" })),
      upcoming.length ? h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" }, h("tbody", null, upcoming.map((r) =>
        h("tr", { class: "clickable", onclick: () => (location.href = LF.url("pages/requests/request.html?id=" + r.id)) },
          h("td", null, h("div", { class: "cell-main", text: fmt.range(r.start, r.end) }), h("div", { class: "cell-sub", text: r.type + " · " + fmt.days(r.workingDays) })),
          h("td", { class: "right" }, LF.status(r.status)))))))
        : LF.empty("Nothing booked", "Plan something. You have " + fmt.days(bal.Annual.available) + " of Annual leave.", h("a", { class: "btn btn-sm", href: LF.url("pages/requests/new-request.html"), text: "New request" })));
    const noteCard = h("div", { class: "card" },
      h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "Latest" }), h("a", { class: "caption-strong", href: LF.url("pages/notifications.html"), text: "All notifications" })),
      notes.length ? h("div", null, notes.slice(0, 4).map((n) => h("a", { class: "note-item" + (n.read ? "" : " unread"), href: LF.url(n.link) }, h("span", { class: "dot" }), h("div", null, h("b", { text: n.title }), h("span", { text: n.body }))))) : h("p", { class: "muted", text: "You're all caught up." }));
    content.append(h("div", { class: "split" }, upCard, noteCard));
  });
})();
