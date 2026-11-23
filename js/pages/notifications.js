/* Notifications inbox: mark read, remove. */
(function () {
  const { h, icon, fmt } = LF;
  LF.page({ eyebrow: "Inbox", title: "Notifications", lead: "Decisions, reminders and balance changes, newest first.",
    actions: () => [h("button", { class: "btn btn-on-dark", text: "Mark all as read", onclick: async (e) => { const b = e.currentTarget; LF.busy(b, true); try { await LF.api.patch("/notifications"); location.reload(); } catch (x) { LF.busy(b, false); LF.toast(x.message, "error"); } } })] }, async (content) => {
    const list = h("div", { class: "card" });
    content.append(list);
    function load() { return LF.reload(list, () => LF.api.get("/notifications"), (notes) => {
      if (!notes.length) { list.replaceChildren(LF.empty("You're all caught up", "New decisions and reminders land here.")); return; }
      list.replaceChildren(...notes.map((n) => h("div", { class: "note-item" + (n.read ? "" : " unread") },
        h("span", { class: "dot" }),
        h("div", { class: "snap-row" },
          h("a", { href: LF.url(n.link), onclick: () => LF.api.patch("/notifications/" + n.id) }, h("b", { text: n.title }), h("span", { text: n.body + " · " + fmt.ago(n.at) })),
          h("div", { class: "btn-row" },
            n.read ? null : h("button", { class: "btn btn-sm btn-outline-dark", text: "Mark read", onclick: async (e) => { LF.busy(e.currentTarget, true); await LF.api.patch("/notifications/" + n.id); load(); } }),
            h("button", { class: "btn-icon", "aria-label": "Remove", onclick: async () => { await LF.api.del("/notifications/" + n.id); LF.toast("Notification removed."); load(); } }, icon("x")))))));
    }, { label: "Loading notifications…" }); }
    await load();
  });
})();
