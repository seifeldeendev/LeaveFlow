/* Approvals queue with the team coverage check and the decision dialog. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({
    eyebrow: "Approvals", title: "Your queue", roles: ["Manager", "HRAdmin"],
    lead: (u) => u.role === "HRAdmin" ? "Second-step approvals (over 5 days or unpaid) and anything escalated after 48 hours." : "Decide with your team's cover in view. Requests left for 48 hours go to HR."
  }, async (content, u) => {
    const list = h("div", { class: "grid-2" });
    content.append(list);
    const clocks = []; // escalation countdowns that tick while the page stays open

    function load() {
      return LF.reload(list, () => LF.api.get("/approvals"), (tasks) => {
        clocks.length = 0;
        if (!tasks.length) { list.replaceChildren(LF.empty("Queue clear", "Nothing is waiting for you. New requests show up here and in your notifications.")); return; }
        list.replaceChildren(...tasks.map(card));
      }, { label: "Loading your queue…" });
    }

    // Keep "Xh to escalation" honest if the queue is left open.
    setInterval(() => clocks.forEach(tickClock), 60000);
    function tickClock(c) {
      const hoursLeft = Math.max(0, Math.ceil((c.deadline - Date.now()) / 3600000));
      c.el.textContent = hoursLeft === 0 ? "Overdue · going to HR" : hoursLeft + "h to escalation";
      c.el.className = "chip" + (hoursLeft < 12 ? " s-pending" : "");
    }

    function card(t) {
      const r = t.request; const cov = t.coverage;
      const balType = r.type === "Annual" || r.type === "Casual" ? t.balance[r.type] : null;
      const blocked = cov.level === "block" && t.step === "Manager";
      let status;
      if (t.escalated) status = h("span", { class: "chip s-escalated", text: "Escalated" });
      else if (t.step === "HR") status = h("span", { class: "chip", text: "HR step" });
      else { status = h("span"); const c = { el: status, deadline: Date.now() + (48 - t.ageHours) * 3600000 }; tickClock(c); clocks.push(c); }
      const approve = h("button", { class: "btn", disabled: blocked, text: "Approve", onclick: (e) => decide(t, "Approved", e.currentTarget) });
      return h("article", { class: "card stack-lg" },
        h("div", { class: "snap-row" },
          h("div", { class: "btn-row nowrap-min" }, h("span", { class: "avatar ink", text: fmt.initials(r.employee.name) }), h("div", { class: "min0" }, h("b", { class: "cell-main ellipsis", text: r.employee.name, title: r.employee.name }), h("div", { class: "cell-sub", text: r.employee.dept + " · " + r.id }))),
          status),
        h("div", null, h("p", { class: "display-sm m0", text: fmt.range(r.start, r.end) }), h("p", { class: "body-sm muted m0", text: r.type + " · " + fmt.days(r.workingDays) + (r.reason ? " · “" + r.reason + "”" : "") })),
        t.note ? h("div", { class: "notice" }, icon("info"), h("span", { text: t.note })) : null,
        coverageStrip(cov),
        coverageNotice(cov, t),
        balType ? h("div", { class: "snap-row caption" }, h("span", { class: "muted", text: r.type + " left after approval" }), h("b", { class: "num" + (balType.available - r.workingDays < 0 ? " text-red" : ""), text: fmt.days(balType.available - r.workingDays) })) : null,
        t.needsHR ? h("p", { class: "caption muted m0", text: "After you approve, HR approves as a second step." }) : null,
        h("div", { class: "btn-row" },
          approve,
          h("button", { class: "btn btn-outline-dark", text: "Reject", onclick: (e) => decide(t, "Rejected", e.currentTarget) }),
          h("a", { class: "caption-strong", href: LF.url("pages/requests/request.html?id=" + r.id), text: "Details" })),
        blocked ? h("p", { class: "blocked-why" }, icon("alert"), "Can't approve: more than 30% of the team would be off. Reject it, or ask HR to decide.") : null);
    }

    const offCount = (d, size) => Math.round((d.pct * size) / 100);
    function coverageStrip(cov) {
      const days = cov.perDay.slice(0, 12);
      return h("div", { class: "stack" },
        h("span", { class: "caption-upper muted", text: "People off each day, out of " + cov.teamSize }),
        h("div", { class: "cols cols-sm" }, days.map((d) => h("div", { class: "col" + (d.pct > 30 ? " cur" : "") },
          h("b", { class: d.pct > 20 ? "text-red" : "", text: offCount(d, cov.teamSize) + "/" + cov.teamSize, title: d.pct + "% of the team" }),
          h("span", { class: "c", style: { height: Math.max(6, d.pct * 1.2) + "px" }, title: d.names.length ? "Also off: " + d.names.join(", ") : "Only this request" }),
          h("small", { text: fmt.dShort(d.date).split(" ")[0] })))));
    }
    function coverageNotice(cov, t) {
      const w = cov.worst; const n = offCount(w, cov.teamSize);
      const head = n + " of " + cov.teamSize + " people off on " + fmt.dDow(w.date) + ". ";
      const names = w.names.length ? " Already off: " + w.names.join(", ") + "." : "";
      if (cov.level === "block") return h("div", { class: "notice block" }, icon("alert"), h("span", null, h("b", { text: head }), (t.step === "Manager" ? "That's over the 30% limit." : "That's over the 30% limit, but HR can still approve.") + names));
      if (cov.level === "warn") return h("div", { class: "notice warn" }, icon("alert"), h("span", null, h("b", { text: head }), "That's above the 20% warning line." + names));
      return h("div", { class: "notice" }, icon("ok"), h("span", { text: "Cover is fine: at most " + n + " of " + cov.teamSize + " off on any day." }));
    }

    async function decide(t, decision, trigger) {
      const first = t.request.employee.name.split(" ")[0];
      // Re-check before opening: the request may have been withdrawn or moved on since the queue loaded.
      LF.busy(trigger, true);
      let r;
      try { r = await LF.api.get("/leave-requests/" + encodeURIComponent(t.request.id)); }
      catch (x) { LF.busy(trigger, false); LF.toast(x.message || "Couldn't check this request. Try again.", "error"); return; }
      LF.busy(trigger, false);
      if (r.status !== "Pending") {
        LF.toast(first + "'s request is now " + r.status.toLowerCase() + ", so there's nothing to decide. It's been removed from your queue.", "info");
        load(); return;
      }
      const comment = h("textarea", { class: "textarea", id: "comment", maxlength: "500", placeholder: decision === "Rejected" ? "Required. Tell " + first + " why." : "Optional" });
      const err = h("div", { "aria-live": "assertive" });
      LF.modal({
        eyebrow: r.id + " · " + r.employee.name, title: decision === "Approved" ? "Approve this request?" : "Reject this request?",
        body: [
          h("div", { class: "snap-row" }, h("span", { class: "muted", text: "Dates" }), h("b", { text: fmt.range(r.start, r.end) + " · " + fmt.days(r.workingDays) })),
          decision === "Approved" ? coverageNotice(t.coverage, t) : null,
          h("div", { class: "field" }, h("label", { for: "comment", text: "Comment" }), comment), err],
        actions: (close) => [h("button", { class: "btn btn-outline-dark", text: "Back", onclick: close }),
          h("button", { class: "btn", text: decision === "Approved" ? "Approve" : "Reject", onclick: async (e) => {
            const btn = e.currentTarget; err.replaceChildren(); LF.busy(btn, true);
            try {
              const res = await LF.api.post("/approvals/" + t.id + "/decision", { decision, comment: comment.value });
              close();
              LF.toast(decision === "Approved" ? (res.needsHR ? "Approved. Sent to HR for the second step." : "Approved. " + first + "'s balance is updated.") : "Rejected. " + first + " has been told why.");
              load();
            } catch (x) {
              LF.busy(btn, false);
              if (x.status === 409 && x.code !== "COVERAGE_BLOCKED") { close(); LF.toast(x.message, "info"); load(); return; }
              err.replaceChildren(LF.errorBox(x));
            }
          } })]
      });
    }
    await load();
  });
})();
