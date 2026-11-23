/* Landing: an HR-style product preview in the hero (team week + live approval), scroll reveals, count-ups. */
(function () {
  const { h, icon } = LF;
  const reduced = LF.reducedMotion();

  /* Feature icons */
  document.querySelectorAll(".feature-ic[data-ic], .dm-strip i[data-ic]").forEach((el) => el.append(icon(el.dataset.ic)));

  /* Hero preview */
  const art = document.getElementById("hero-art");
  if (art) {
    const days = ["Sun 13", "Mon 14", "Tue 15", "Wed 16", "Thu 17"];
    // o = off (approved), r = requested, "" = in
    const team = [
      ["Nour Hassan", ["o", "o", "", "", ""]],
      ["Omar Said", ["", "", "", "", ""]],
      ["Yara Mostafa", ["", "", "", "r", "r"]],
      ["Laila Farouk", ["", "o", "", "", ""]],
      ["Karim Adel", ["", "", "o", "", ""]],
      ["Hana Youssef", ["", "", "", "", ""]]
    ];
    const cells = [];
    const week = h("div", { class: "week-card" },
      h("div", { class: "snap-row" },
        h("div", null, h("span", { class: "caption-upper muted", text: "Sales team" }), h("h3", { class: "display-xs m0", text: "Who's off this week" })),
        h("span", { class: "chip", text: "13–17 Dec" })),
      h("div", { class: "week-grid" },
        h("span"), days.map((d) => h("span", { class: "week-dow", text: d })),
        team.map(([name, row], ri) => [
          h("span", { class: "week-who" }, h("span", { class: "avatar ink", text: LF.fmt.initials(name) }), h("span", { text: name.split(" ")[0] })),
          row.map((k, ci) => { const c = h("span", { class: "week-cell" + (k ? " " + k : "") }); c.style.animationDelay = (ri * 5 + ci) * 25 + "ms"; cells.push([c, k]); return c; })
        ])),
      h("div", { class: "legend" },
        h("span", null, h("i", { class: "lg-off" }), "Off"), h("span", null, h("i", { class: "lg-req" }), "Waiting for approval"), h("span", null, h("i", { class: "lg-wk" }), "In")));

    const chip = h("span", { class: "chip s-pending", text: "Pending" });
    const approve = h("span", { class: "btn btn-sm", text: "Approve" });
    const COVER_TEXT = "Cover is fine: only Yara would be off on Wed and Thu (1 of 6).";
    const note = h("div", { class: "notice" }, icon("ok"), h("span", { text: COVER_TEXT }));
    const approval = h("div", { class: "snap" },
      h("div", { class: "snap-row" }, h("span", { class: "caption-upper muted", text: "Needs your decision" }), chip),
      h("div", { class: "btn-row" }, h("span", { class: "avatar ink", text: "YM" }), h("div", null, h("b", { text: "Yara Mostafa" }), h("div", { class: "cell-sub", text: "Annual leave · 16–17 Dec · 2 days" }))),
      note,
      h("div", { class: "btn-row" }, approve, h("span", { class: "btn btn-sm btn-outline-dark", text: "Reject" })));

    const balVal = h("span", { class: "value", text: "15.25" });
    const meterFill = h("span"); meterFill.style.width = "72%";
    const balSub = h("span", { class: "caption muted", text: "After this request: 13.25" });
    const balance = h("div", { class: "snap stat" },
      h("span", { class: "caption-upper muted", text: "Yara's Annual balance" }), balVal, h("div", { class: "meter" }, meterFill), balSub);

    art.append(week, h("div", { class: "hero-stack" }, approval, balance));

    // A small loop: the request gets approved, the calendar and balance follow.
    function setState(done) {
      chip.className = "chip " + (done ? "s-approved" : "s-pending"); chip.textContent = done ? "Approved" : "Pending";
      approve.classList.toggle("is-busy", false);
      note.className = "notice" + (done ? " ok" : "");
      note.lastChild.textContent = done ? "Approved. Yara has been told and her balance is updated." : COVER_TEXT;
      cells.forEach(([c, k]) => { if (k === "r") { c.className = "week-cell " + (done ? "o flip" : "r flip"); } });
      balVal.textContent = done ? "13.25" : "15.25"; meterFill.style.width = done ? "63%" : "72%";
      balSub.textContent = done ? "2 days used for 16–17 Dec" : "After this request: 13.25";
    }
    if (!reduced) {
      let done = false;
      setInterval(() => {
        if (!done) { approve.classList.add("is-busy"); setTimeout(() => { done = true; setState(true); }, 900); }
        else { done = false; setState(false); }
      }, 5200);
    }
  }

  /* Scroll reveal + count-ups */
  const items = document.querySelectorAll(".reveal");
  if (reduced || !("IntersectionObserver" in window)) { items.forEach((el) => el.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      en.target.classList.add("in");
      LF.countUp(en.target);
      io.unobserve(en.target);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  items.forEach((el) => io.observe(el));
})();

/* Floating nav: highlight the link for the section in view. */
(function () {
  const nav = document.querySelector(".float-nav");
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll(".fn-pill a"));
  const targets = links.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  const setActive = (id) => links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + id)));
  links.forEach((a) => a.addEventListener("click", () => setActive(a.getAttribute("href").slice(1))));
  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 40);
    const y = window.scrollY + window.innerHeight * 0.35;
    let cur = targets[0];
    targets.forEach((t) => { if (t.offsetTop <= y) cur = t; });
    if (cur) setActive(cur.id);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
