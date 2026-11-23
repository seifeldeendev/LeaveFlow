/* Company calendar (HR): month view of everyone's leave, holidays and blackout dates. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "People", title: "Company calendar", roles: ["HRAdmin"], lead: "Everyone's approved and pending leave, Egyptian public holidays and blackout dates." }, async (content) => {
    const D = LF.date; const data = await LF.api.get("/calendar");
    let month = D.today().slice(0, 7); let dept = "";
    const title = h("h3", { class: "display-sm" });
    const sel = h("select", { class: "select", id: "dept", onchange: (e) => { dept = e.target.value; draw(); } }, ["", "Sales", "Engineering", "Finance", "HR"].map((d) => h("option", { value: d, text: d || "All departments" })));
    const step = (n) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); month = d.toISOString().slice(0, 7); draw(); };
    const grid = h("div", { class: "cal" });
    content.append(h("div", { class: "card" },
      h("div", { class: "card-head" }, title, h("div", { class: "btn-row" },
        h("div", { class: "field" }, h("label", { for: "dept", class: "sr-only", text: "Department" }), sel),
        h("button", { class: "btn-icon btn-outline-dark", "aria-label": "Previous month", onclick: () => step(-1) }, icon("chevronL")),
        h("button", { class: "btn-icon btn-outline-dark", "aria-label": "Next month", onclick: () => step(1) }, icon("chevron")))),
      grid,
      h("div", { class: "legend mt-24" }, h("span", null, h("i", { class: "cal-ev" }), "Approved"), h("span", null, h("i", { class: "cal-ev pending" }), "Pending"), h("span", null, h("i", { class: "cal-ev holiday" }), "Holiday or blackout"), h("span", null, h("i", { class: "lg-wk" }), "Fri & Sat")),
      h("div", { class: "btn-row mt-24" }, h("button", { class: "btn btn-outline-dark btn-sm", onclick: exportCsv }, icon("download"), "Export month as CSV"))));

    function draw() {
      const [y, m] = month.split("-").map(Number);
      title.textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      const first = month + "-01"; const startGrid = D.add(first, -D.dow(first));
      const cells = D.range(startGrid, D.add(startGrid, 41));
      const reqs = data.requests.filter((r) => !dept || r.employee.dept === dept);
      grid.replaceChildren(...["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => h("div", { class: "cal-dow", text: d })),
        ...cells.map((d) => {
          const hol = data.holidays.find((x) => x.date === d);
          const bo = data.blackouts.find((b) => d >= b.start && d <= b.end && (!dept || b.dept === dept));
          const evs = reqs.filter((r) => r.start <= d && r.end >= d && D.dow(d) < 5);
          const cls = "cal-day" + (d.slice(0, 7) !== month ? " out" : "") + (D.dow(d) >= 5 ? " weekend" : "") + (d === D.today() ? " today" : "");
          return h("div", { class: cls },
            h("span", { class: "d", text: Number(d.slice(8)) }),
            hol ? h("span", { class: "cal-ev holiday", text: hol.name }) : null,
            bo ? h("span", { class: "cal-ev holiday", text: "Blackout · " + bo.dept }) : null,
            evs.slice(0, 3).map((r) => h("span", { class: "cal-ev" + (r.status === "Pending" ? " pending" : ""), title: r.employee.name + " · " + r.type + " · " + r.status, text: r.employee.name.split(" ")[0] + " · " + r.type })),
            evs.length > 3 ? h("span", { class: "caption muted", text: "+" + (evs.length - 3) + " more" }) : null);
        }));
    }
    function exportCsv() {
      const rows = data.requests.filter((r) => (!dept || r.employee.dept === dept) && r.start.slice(0, 7) <= month && r.end.slice(0, 7) >= month);
      LF.downloadCsv("leaveflow-calendar-" + month + ".csv", [["Employee", "Department", "Type", "Start", "End", "Working days", "Status"], ...rows.map((r) => [r.employee.name, r.employee.dept, r.type, r.start, r.end, r.workingDays, r.status])]);
    }
    draw();
  });
})();
