/* Request details: status, approval steps, full history, withdraw / cancel. */
(function () {
  const { h, icon, fmt } = LF;
  const id = LF.q("id") || "";
  LF.page({ eyebrow: "Request " + id, title: "Request details" }, async (content, u) => {
    let r;
    try { r = await LF.api.get("/leave-requests/" + encodeURIComponent(id)); }
    catch (x) {
      if (x.status === 404) { content.append(LF.empty("We can't find this request", "It may have been removed, or it belongs to someone else.", h("a", { class: "btn", href: LF.url("pages/requests/my-requests.html"), text: "Back to my requests" }))); return; }
      throw x;
    }
    if (LF.q("new")) LF.toast("Request submitted. " + (r.steps[0] ? r.steps[0].who + " has been notified." : ""));

    // Rewrite the band with the request itself
    const band = document.querySelector(".page-band");
    const canWithdraw = r.canAct && r.status === "Pending";
    const canCancel = r.canAct && r.status === "Approved" && r.start > LF.date.today();
    band.replaceChildren(h("div", { class: "page-band-row" },
      h("div", null, h("p", { class: "eyebrow", text: "Request " + r.id }), h("h1", { class: "display-xl", text: fmt.range(r.start, r.end).replace(/ \d{4}$/, "") }),
        h("p", { class: "lead", text: r.type + " · " + fmt.days(r.workingDays) + " · " + r.employee.name + ", " + r.employee.dept })),
      h("div", { class: "btn-row" }, LF.status(r.status),
        canWithdraw ? h("button", { class: "btn btn-on-dark", text: "Withdraw request", onclick: () => confirmAction("withdraw") }) : null,
        canCancel ? h("button", { class: "btn btn-on-dark", text: "Cancel leave", onclick: () => confirmAction("cancel") }) : null)));

    const details = h("div", { class: "card stack-lg" },
      h("h3", { class: "display-xs", text: "Details" }),
      row("Status", LF.status(r.status)), row("Type", r.type), row("Dates", fmt.d(r.start) + " → " + fmt.d(r.end)), row("Working days", fmt.num(r.workingDays)),
      row("Submitted", fmt.dt(r.createdAt)), r.reason ? row("Note", r.reason) : null,
      r.decisionComment ? h("div", { class: "notice" + (r.status === "Rejected" ? " warn" : "") }, icon("info"), h("span", null, h("b", { text: "Approver's comment: " }), r.decisionComment)) : null);

    const steps = h("div", { class: "card stack-lg" }, h("h3", { class: "display-xs", text: "Approval steps" }),
      r.steps.length ? r.steps.map((s) => h("div", { class: "snap-row" }, h("div", { class: "btn-row" }, h("span", { class: "avatar ink", text: fmt.initials(s.who) }), h("div", null, h("b", { text: s.who }), h("div", { class: "cell-sub", text: s.step + " · " + fmt.dt(s.at) + (s.comment ? " · “" + s.comment + "”" : "") }))), LF.status(s.status)))
        : h("p", { class: "muted m0", text: "No approval steps." }),
      r.status === "Pending" && (r.type === "Unpaid" || r.workingDays > 5) ? h("p", { class: "caption muted m0", text: "HR approves as a second step after the manager." }) : null);

    const cert = r.type === "Sick" ? h("div", { class: "card stack" }, h("h3", { class: "display-xs", text: "Medical certificate" }),
      r.workingDays > 2 ? h("p", { class: "muted m0", text: "Needed before this can be approved." }) : h("p", { class: "muted m0", text: "Optional for 2 days or fewer." }),
      certButtons()) : null;

    // Live mode: private S3 upload / 5-minute view link through requests-api. Mock mode keeps the demo toast.
    function certButtons() {
      const picker = h("input", { type: "file", accept: ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png", hidden: true, onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (!/\.(pdf|jpe?g|png)$/i.test(f.name) || f.size > 5 * 1024 * 1024) { LF.toast("Only PDF, JPG or PNG files up to 5 MB.", "info"); return; }
        try { await LF.api.uploadCertificate(r.id, f); LF.toast("Certificate uploaded."); setTimeout(() => location.reload(), 600); }
        catch (x) { LF.toast(x.message, "info"); }
      } });
      const canUpload = r.canAct && r.status === "Pending";
      return h("div", { class: "btn-row" }, picker,
        canUpload ? h("button", { class: "btn btn-sm btn-outline-dark", onclick: () => (LF.live("requests") ? picker.click() : LF.toast("Uploading certificates is switched off in this demo.", "info")) }, icon("upload"), r.hasCertificate ? "Replace" : "Upload") : null,
        h("button", { class: "btn btn-sm btn-outline-dark", onclick: async () => {
          if (!LF.live("requests")) { LF.toast("Opening certificates is switched off in this demo.", "info"); return; }
          try { const l = await LF.api.certificateLink(r.id); window.open(l.url, "_blank", "noopener"); }
          catch (x) { LF.toast(x.message, "info"); }
        } }, icon("file"), "View"));
    }

    const timeline = h("div", { class: "card" }, h("div", { class: "card-head" }, h("h3", { class: "display-xs", text: "History" }), h("span", { class: "caption muted", text: "Every change, in order" })),
      h("ol", { class: "timeline" }, r.history.map((ev, i) => h("li", { class: i === r.history.length - 1 ? "now" : "done" },
        h("div", { class: "snap-row" }, h("b", { text: ev.status }), h("span", { class: "caption muted", text: fmt.dt(ev.at) })),
        h("div", { class: "cell-sub", text: ev.by + (ev.note ? " · " + ev.note : "") })))));

    content.append(h("div", { class: "split" }, h("div", { class: "stack-lg" }, timeline), h("div", { class: "stack-lg" }, details, steps, cert)),
      h("div", null, h("a", { class: "btn btn-outline-dark", href: LF.url("pages/requests/my-requests.html") }, icon("chevronL"), "All requests")));

    function row(label, value) { return h("div", { class: "snap-row" }, h("span", { class: "muted", text: label }), typeof value === "string" ? h("b", { class: "right", text: value }) : value); }

    function confirmAction(action) {
      const why = h("textarea", { class: "textarea", id: "why", maxlength: "300", placeholder: "Optional" });
      const err = h("div");
      LF.modal({
        eyebrow: r.id, title: action === "withdraw" ? "Withdraw this request?" : "Cancel this leave?",
        body: [h("p", { class: "body-md m0", text: action === "withdraw" ? "Your manager won't need to decide. You can submit a new one any time." : "The " + fmt.days(r.workingDays) + " go back to your " + r.type + " balance straight away." }),
          action === "cancel" ? h("div", { class: "field" }, h("label", { for: "why", text: "Reason" }), why) : null, err],
        actions: (close) => [h("button", { class: "btn btn-outline-dark", text: "Keep it", onclick: close }),
          h("button", { class: "btn", text: action === "withdraw" ? "Withdraw" : "Cancel leave", onclick: async (e) => {
            const b = e.currentTarget; LF.busy(b, true);
            try { await LF.api.patch("/leave-requests/" + r.id + "/status", { action, reason: why.value }); location.reload(); }
            catch (x) { err.replaceChildren(LF.errorBox(x)); LF.busy(b, false); }
          } })]
      });
    }
  });
})();
