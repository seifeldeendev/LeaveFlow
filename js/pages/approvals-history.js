/* Decision history: every approve / reject this approver made. */
(function () {
  const { h, fmt } = LF;
  LF.page({ eyebrow: "Approvals", title: "Decision history", roles: ["Manager", "HRAdmin"], lead: "Every decision you've made, with your comment." }, async (content) => {
    const rows = await LF.api.get("/approvals/history");
    const approved = rows.filter((r) => r.decision === "Approved").length;
    content.append(h("div", { class: "grid-3" },
      h("div", { class: "card dark stat" }, h("span", { class: "caption-upper", text: "Decisions" }), h("span", { class: "value", text: rows.length })),
      h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Approved" }), h("span", { class: "value", text: approved })),
      h("div", { class: "card stat" }, h("span", { class: "caption-upper muted", text: "Rejected" }), h("span", { class: "value", text: rows.length - approved }))));
    if (!rows.length) { content.append(LF.empty("No decisions yet", "Approve or reject something from your queue and it shows up here.")); return; }
    content.append(h("div", { class: "table-wrap" }, h("table", { class: "data stack-sm" },
      h("thead", null, h("tr", null, ["Employee", "Dates", "Type", "Comment", "Decided", "Decision"].map((t) => h("th", { text: t })))),
      h("tbody", null, rows.map((d) => h("tr", { class: "clickable", onclick: () => (location.href = LF.url("pages/requests/request.html?id=" + d.requestId)) },
        h("td", null, h("div", { class: "cell-main", text: d.employee }), h("div", { class: "cell-sub", text: d.requestId })),
        h("td", { class: "hide-sm" }, h("div", { text: fmt.range(d.start, d.end) }), h("div", { class: "cell-sub", text: fmt.days(d.days) })),
        h("td", { class: "hide-sm" }, LF.typeChip(d.type)),
        h("td", { class: "hide-sm muted", text: d.comment || "—" }),
        h("td", { class: "hide-sm muted", text: fmt.dt(d.at) }),
        h("td", { class: "right" }, LF.status(d.decision))))))));
  });
})();
