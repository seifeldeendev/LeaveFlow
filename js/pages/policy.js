/* Leave policy values (SSM Parameter Store), with range checks, plus holidays and blackouts. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "Settings", title: "Leave policy", roles: ["HRAdmin"], lead: "Changes apply straight away, for everyone. Every change is recorded in the audit log." }, async (content) => {
    const data = await LF.api.get("/policy");
    content.append(h("div", { class: "grid-2" }, data.params.map(paramCard)));
    content.append(h("div", { class: "split" },
      h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "Public holidays" }), h("span", { class: "caption muted", text: "Imported automatically each year" })),
        h("div", { class: "table-wrap" }, h("table", { class: "data" }, h("tbody", null, data.holidays.filter((x) => x.date >= "2026-06-01").map((x) => h("tr", null, h("td", { class: "muted num", text: LF.fmt.dDow(x.date) + " " + x.date.slice(0, 4) }), h("td", { class: "cell-main", text: x.name }))))))),
      h("div", { class: "card stack-lg" }, h("h3", { class: "display-xs", text: "Fixed rules" }),
        h("ul", { class: "rule-list" }, [
          "Weekend is Friday and Saturday", "Over 5 working days or Unpaid needs HR as a second step", "Requests waiting 48 hours escalate to HR",
          "Coverage: warn above 20% of a team off, block above 30%", "Sick leave over 2 days needs a certificate", "Unpaid leave needs 14 days' notice"
        ].map((t) => h("li", null, icon("check"), h("span", { text: t })))),
        h("div", { class: "stack" }, h("span", { class: "caption-upper muted", text: "Blackout dates" }), data.blackouts.map((b) => h("div", { class: "snap-row" }, h("b", { text: b.name }), h("span", { class: "muted", text: b.dept + " · " + fmt.dShort(b.start) + "–" + fmt.dShort(b.end) })))))));

    function paramCard(p) {
      const input = h("input", { class: "input num", id: "p-" + p.name, type: "number", step: String(p.step), value: String(p.value) });
      const msg = h("div", { "aria-live": "polite" });
      const save = h("button", { class: "btn btn-sm", text: "Save", onclick: async (e) => {
        const b = e.currentTarget; LF.busy(b, true);
        msg.replaceChildren(); input.removeAttribute("aria-invalid");
        try { const r = await LF.api.put("/policy/" + p.name, { value: input.value }); p.value = r.value; LF.toast(p.label + " set to " + r.value + " " + p.unit + "."); }
        catch (x) { input.setAttribute("aria-invalid", "true"); msg.append(h("span", { class: "error-text", text: x.message })); }
        finally { LF.busy(b, false); }
      } });
      return h("div", { class: "card stack-lg" },
        h("div", { class: "stack" }, h("span", { class: "caption-upper muted", text: "/leaveflow/policy/" + p.name }), h("h3", { class: "display-xs", text: p.label }), h("p", { class: "body-sm muted m0", text: p.help })),
        h("div", { class: "field" }, h("label", { for: "p-" + p.name, text: "Value (" + p.unit + ", " + p.min + "–" + p.max + ")" }), h("div", { class: "btn-row" }, h("div", { class: "grow" }, input), save)), msg);
    }
  });
})();
