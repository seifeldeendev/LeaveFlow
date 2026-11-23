/* Team calendar: who is off, day by day, with the daily coverage percentage. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "Approvals", title: "Team calendar", roles: ["Manager", "HRAdmin"], lead: "Who's off over the next weeks. Red means a request is still waiting for you." }, async (content, u) => {
    const D = LF.date; const data = await LF.api.get("/team-calendar");
    let start = D.add(D.today(), -D.dow(D.today())); // Sunday of this week
    const wrap = h("div", { class: "card" });
    const title = h("h3", { class: "display-xs" });
    const nav = h("div", { class: "btn-row" },
      h("button", { class: "btn-icon", "aria-label": "Earlier", onclick: () => { start = D.add(start, -21); draw(); } }, icon("chevronL")),
      h("button", { class: "btn btn-sm btn-outline-dark", text: "Today", onclick: () => { start = D.add(D.today(), -D.dow(D.today())); draw(); } }),
      h("button", { class: "btn-icon", "aria-label": "Later", onclick: () => { start = D.add(start, 21); draw(); } }, icon("chevron")));
    nav.querySelectorAll(".btn-icon").forEach((b) => b.classList.add("btn-outline-dark"));
    const body = h("div", { class: "table-wrap" });
    wrap.append(h("div", { class: "card-head" }, title, nav), body,
      h("div", { class: "legend mt-24" }, h("span", null, h("i", { class: "strip-cell off" }), "Approved"), h("span", null, h("i", { class: "strip-cell req" }), "Pending"), h("span", null, h("i", { class: "strip-cell wk" }), "Weekend or holiday")));
    content.append(wrap);

    function draw() {
      const days = D.range(start, D.add(start, 20));
      title.textContent = fmt.dShort(days[0]) + " – " + fmt.d(days[days.length - 1]);
      const hol = new Set(data.holidays.map((x) => x.date));
      const members = data.members.filter((m) => m.id !== u.id || u.role === "Manager");
      const grid = h("div", { class: "strip", style: { minWidth: "720px" } });
      grid.style.setProperty("--days", days.length);
      grid.append(h("div", { class: "strip-row" }, h("span"), days.map((d) => h("span", { class: "strip-head", text: ["S","M","T","W","T","F","S"][D.dow(d)] + " " + d.slice(8) }))));
      members.forEach((m) => {
        grid.append(h("div", { class: "strip-row" }, h("span", { class: "who", text: m.name, title: m.name }), days.map((d) => {
          const off = D.dow(d) >= 5 || hol.has(d);
          const r = data.requests.find((x) => x.employeeId === m.id && x.start <= d && x.end >= d);
          const cls = off ? "wk" : r ? (r.status === "Approved" ? "off" : "req") : "";
          return h("span", { class: "strip-cell " + cls, title: r ? m.name + " · " + r.type + " · " + r.status : "" });
        })));
      });
      grid.append(h("div", { class: "strip-row" }, h("span", { class: "who caption-upper muted", text: "Off" }), days.map((d) => {
        if (D.dow(d) >= 5 || hol.has(d)) return h("span");
        const n = data.requests.filter((x) => x.status === "Approved" && x.start <= d && x.end >= d).length;
        const pct = Math.round((n / members.length) * 100);
        return h("span", { class: "strip-pct" + (pct > 20 ? " hi" : ""), text: n + "/" + members.length, title: pct + "% of the team" });
      })));
      body.replaceChildren(grid);
    }
    draw();
  });
})();
