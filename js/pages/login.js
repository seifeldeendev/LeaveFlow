/* Sign in: email + password, then a 6-digit MFA code for Manager and HR.
   Mock mode: any password works; pick a demo user to fill the email. */
(function () {
  const { h, icon } = LF;
  const reason = LF.q("reason");
  const next = LF.q("next");
  const demo = [
    { email: "nour@leaveflow.test", name: "Nour Hassan", role: "Employee", dept: "Sales" },
    { email: "karim@leaveflow.test", name: "Karim Adel", role: "Manager", dept: "Sales" },
    { email: "mona@leaveflow.test", name: "Mona Fathy", role: "HR Admin", dept: "HR" }
  ];

  const errBox = h("div", { "aria-live": "assertive" });
  const email = h("input", { class: "input", id: "email", type: "email", autocomplete: "username", placeholder: "you@company.com", required: true });
  const pass = h("input", { class: "input", id: "password", type: "password", autocomplete: "current-password", placeholder: "Your password", required: true });
  const submit = h("button", { class: "btn", type: "submit", text: "Sign in" });
  const picks = demo.map((d) => h("button", { type: "button", class: "demo-user", "aria-pressed": "false", onclick: (e) => {
    email.value = d.email; pass.value = "demo-password";
    picks.forEach((p) => p.setAttribute("aria-pressed", String(p === e.currentTarget)));
  } }, h("span", { class: "avatar ink", text: LF.fmt.initials(d.name) }), h("span", null, h("b", { text: d.name }), h("div", { class: "cell-sub", text: d.dept })), h("span", { class: "chip", text: d.role })));

  const form = h("form", { class: "auth-card", novalidate: true, onsubmit: onLogin },
    h("div", { class: "stack" }, h("p", { class: "eyebrow text-red", text: "Sign in" }), h("h1", { class: "display-md", text: "Welcome back" })),
    reason === "idle" ? h("div", { class: "notice warn" }, icon("clock"), h("span", { text: "You were signed out after 15 minutes without activity." })) : null,
    errBox,
    h("div", { class: "field" }, h("label", { for: "email", text: "Work email" }), email),
    h("div", { class: "field" }, h("label", { for: "password", text: "Password" }), pass),
    submit,
    h("div", { class: "stack" }, h("p", { class: "caption-upper muted m0", text: "Demo accounts" }), h("div", { class: "demo-users" }, picks)),
    h("p", { class: "caption muted", text: "Five wrong passwords lock the account for 15 minutes. Managers and HR confirm with an authenticator code." }));

  async function onLogin(e) {
    e.preventDefault(); errBox.replaceChildren();
    if (!email.value || !pass.value) { errBox.append(LF.errorBox({ message: "Enter your email and password." })); return; }
    LF.busy(submit, true);
    try {
      const res = await LF.api.post("/auth/login", { email: email.value, password: pass.value });
      if (res.mfaRequired) showMfa(); else go();
    } catch (err) { errBox.append(LF.errorBox(err)); }
    finally { LF.busy(submit, false); }
  }

  function showMfa() {
    const boxes = Array.from({ length: 6 }, (_, i) => h("input", { class: "input", inputmode: "numeric", maxlength: "1", "aria-label": "Digit " + (i + 1), autocomplete: i === 0 ? "one-time-code" : "off" }));
    boxes.forEach((b, i) => {
      b.addEventListener("input", () => { b.value = b.value.replace(/\D/g, "").slice(0, 1); if (b.value && boxes[i + 1]) boxes[i + 1].focus(); });
      b.addEventListener("keydown", (e) => { if (e.key === "Backspace" && !b.value && boxes[i - 1]) boxes[i - 1].focus(); });
      b.addEventListener("paste", (e) => { const t = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6); if (t.length) { e.preventDefault(); t.split("").forEach((c, j) => { if (boxes[j]) boxes[j].value = c; }); boxes[Math.min(t.length, 5)].focus(); } });
    });
    const err = h("div", { "aria-live": "assertive" });
    const btn = h("button", { class: "btn", type: "submit", text: "Verify and continue" });
    const mfa = h("form", { class: "auth-card", novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); err.replaceChildren(); LF.busy(btn, true);
      try { await LF.api.post("/auth/mfa", { code: boxes.map((b) => b.value).join("") }); go(); }
      catch (x) { err.append(LF.errorBox(x)); LF.busy(btn, false); }
    } },
      h("div", { class: "stack" }, h("p", { class: "eyebrow text-red", text: "Step 2 of 2" }), h("h1", { class: "display-md", text: "Enter your code" }),
        h("p", { class: "body-md muted m0", text: "Managers and HR confirm sign-in with the 6-digit code from their authenticator app." })),
      err, h("div", { class: "otp" }, boxes), btn,
      h("p", { class: "caption muted", text: "Demo: any 6 digits work." }),
      h("button", { type: "button", class: "btn btn-outline-dark", text: "Back", onclick: () => { LF.session.clear(); main.replaceChildren(form); } }));
    main.replaceChildren(mfa); boxes[0].focus();
  }

  function go() { location.href = next && /^pages\/[a-z-]+(\/[a-z-]+)?\.html$/.test(next) ? LF.url(next) : LF.url("pages/home.html"); }

  const main = h("div", { class: "auth-main" }, form);
  document.body.replaceChildren(h("div", { class: "auth" },
    h("aside", { class: "auth-side" },
      LF.logo(LF.url("index.html")),
      h("div", { class: "stack-lg" },
        h("span", { class: "badge-popular self-start" }, h("i"), "Leave management, sorted"),
        h("h2", { class: "display-hero" }, "Welcome ", h("em", { text: "back." })),
        h("p", { class: "body-lg hide-sm m0", text: "Plan time off, approve your team's requests and keep every balance right." }),
        h("ul", { class: "auth-feats hide-sm" },
          h("li", null, icon("check"), "Working days and policy checked as you type"),
          h("li", null, icon("shield"), "MFA for managers and HR, 15-minute sessions"),
          h("li", null, icon("history"), "Every balance change kept on record"))),
      h("p", { class: "caption hide-sm muted", text: "Demo · Team 15" })),
    main));
  if (LF.api.me()) go();
})();
