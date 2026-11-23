/* New request with a live working-day preview and policy check (GET /working-days). */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({
    eyebrow: "Leave requests", title: "New request",
    lead: "Pick your dates. We count working days and check the policy as you go."
  }, async (content, u) => {
    const D = LF.date; const today = D.today();
    const types = [["Annual", "Paid, from your yearly balance"], ["Casual", "Short notice, 6 a year"], ["Sick", "Certificate over 2 days"], ["Unpaid", "Needs HR approval too"]];
    const state = { type: "Annual", start: D.add(today, 14), end: D.add(today, 17), reason: "" };

    const typeTabs = h("div", { class: "grid-2" }, types.map(([t, sub]) => h("button", { type: "button", class: "demo-user", "aria-pressed": String(state.type === t), onclick: (e) => { state.type = t; typeTabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); certField.hidden = t !== "Sick"; refresh(); } },
      h("span", null, h("b", { text: t }), h("div", { class: "cell-sub", text: sub })))));
    const start = h("input", { class: "input", type: "date", id: "start", value: state.start, min: D.add(today, -7), onchange: (e) => { state.start = e.target.value; if (state.end < state.start) { state.end = state.start; end.value = state.end; } refresh(); } });
    const end = h("input", { class: "input", type: "date", id: "end", value: state.end, onchange: (e) => { state.end = e.target.value; refresh(); } });
    const reason = h("textarea", { class: "textarea", id: "reason", maxlength: "500", placeholder: "Optional. Your manager will see this.", oninput: (e) => { state.reason = e.target.value; count.textContent = e.target.value.length + " / 500"; } });
    const count = h("span", { class: "hint", text: "0 / 500" });
    const file = h("input", { class: "input", type: "file", id: "cert", accept: ".pdf,.jpg,.jpeg,.png", onchange: (e) => {
      const f = e.target.files[0]; certMsg.replaceChildren();
      if (!f) return;
      const okType = /\.(pdf|jpe?g|png)$/i.test(f.name); const okSize = f.size <= 5 * 1024 * 1024;
      certMsg.append(okType && okSize ? h("span", { class: "hint", text: f.name + " ready. It uploads through a 5-minute private link after you submit." }) : h("span", { class: "error-text", text: !okType ? "Only PDF, JPG or PNG files." : "That file is over 5 MB." }));
      if (!(okType && okSize)) e.target.value = "";
    } });
    const certMsg = h("div");
    const certField = h("div", { class: "field full", hidden: true }, h("label", { for: "cert", text: "Medical certificate" }), file, certMsg, h("span", { class: "hint", text: "PDF, JPG or PNG, up to 5 MB. Stored encrypted; only you, your manager and HR can open it." }));
    const err = h("div", { "aria-live": "assertive" });
    const submit = h("button", { class: "btn", type: "submit", text: "Submit request" });

    const form = h("form", { class: "card stack-lg", novalidate: true, onsubmit: onSubmit },
      h("div", { class: "field" }, h("span", { class: "label", text: "Leave type" }), typeTabs),
      h("div", { class: "form-grid" },
        h("div", { class: "field" }, h("label", { for: "start", text: "First day" }), start),
        h("div", { class: "field" }, h("label", { for: "end", text: "Last day" }), end),
        h("div", { class: "field full" }, h("label", { for: "reason", text: "Note for your manager" }), reason, count),
        certField),
      err,
      h("div", { class: "btn-row" }, submit, h("a", { class: "btn btn-outline-dark", href: LF.url("pages/requests/my-requests.html"), text: "Cancel" })));

    const preview = h("aside", { class: "card dark stack-lg", "aria-live": "polite" });
    content.append(h("div", { class: "split" }, form, preview));

    let seq = 0;
    async function refresh() {
      const my = ++seq;
      if (preview.childElementCount > 1) LF.refreshing(preview, true); else preview.replaceChildren(h("p", { class: "caption-upper", text: "Preview" }), LF.loading("Counting working days…", 3));
      try {
        const [res, bal] = await Promise.all([LF.api.get("/working-days?" + new URLSearchParams({ start: state.start, end: state.end, type: state.type })), LF.api.get("/balances/me")]);
        if (my !== seq) return;
        LF.refreshing(preview, false);
        renderPreview(res, bal);
      } catch (x) { LF.refreshing(preview, false); preview.replaceChildren(LF.errorBox(x)); }
    }
    function renderPreview(res, bal) {
      const failed = res.checks.filter((c) => !c.ok);
      submit.disabled = failed.length > 0;
      const b = bal[state.type];
      preview.replaceChildren(...[
        h("p", { class: "caption-upper m0", text: "Preview" }),
        h("div", { class: "stat" }, h("span", { class: "value" }, String(res.days), h("small", { text: res.days === 1 ? "working day" : "working days" })), h("span", { class: "caption", text: state.start <= state.end ? fmt.dDow(state.start) + " → " + fmt.dDow(state.end) : "" })),
        res.skipped && res.skipped.length ? h("div", { class: "stack" }, h("span", { class: "caption-upper", text: "Not counted" }), h("div", { class: "btn-row" }, res.skipped.map((s) => h("span", { class: "chip on-dark", text: fmt.dShort(s.date) + " · " + s.why })))) : null,
        b && b.available !== undefined ? h("div", { class: "stack" }, h("span", { class: "caption-upper", text: state.type + " balance" }),
          h("div", { class: "snap-row" }, h("span", { text: "Available now" }), h("b", { class: "num", text: fmt.num(b.available) })),
          h("div", { class: "snap-row" }, h("span", { text: "Other pending requests" }), h("b", { class: "num", text: "−" + fmt.num(b.pending) })),
          h("div", { class: "snap-row" }, h("span", { text: "This request" }), h("b", { class: "num", text: "−" + fmt.num(res.days) })),
          h("div", { class: "snap-row" }, h("b", { text: "Left after approval" }), h("b", { class: "num" + (b.projected - res.days < 0 ? " text-red" : ""), text: fmt.num(b.projected - res.days) }))) : null,
        h("div", { class: "stack" }, h("span", { class: "caption-upper", text: "Policy checks" }),
          h("ul", { class: "rule-list" }, res.checks.map((c) => h("li", { class: c.ok ? "" : "fail" }, icon(c.ok ? "ok" : "xcircle"), h("span", null, h("b", { text: c.label }), c.ok ? null : h("div", { text: c.detail })))))),
        (res.info || []).map((t) => h("div", { class: "notice" }, icon("info"), h("span", { text: t })))].flat().filter(Boolean));
    }

    async function onSubmit(e) {
      e.preventDefault(); err.replaceChildren(); LF.busy(submit, true);
      try {
        const r = await LF.api.post("/leave-requests", { type: state.type, start: state.start, end: state.end, reason: state.reason });
        location.href = LF.url("pages/requests/request.html?id=" + r.id + "&new=1");
      } catch (x) {
        err.append(LF.errorBox(x)); if (x.details) renderPreview(x.details, await LF.api.get("/balances/me"));
        LF.busy(submit, false);
      }
    }
    refresh();
  });
})();
