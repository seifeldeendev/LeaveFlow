# LeaveFlow frontend (mock-data design)

Plain HTML, CSS and JavaScript, as the course allows. No build step. Styling:
deep teal and bright green (`#001e2b`, `#00ed64`), dark by default with an optional light theme, pill buttons,
12px cards, Figtree as the display font, shimmer placeholders while data loads.

## Run it
    python3 -m http.server 8080     # then open http://localhost:8080
Sign in with a demo account on the sign-in page (any password; any 6 digits for the Manager/HR code).

| Account | Role | Sees |
|---|---|---|
| nour@leaveflow.test | Employee | Overview, my requests, new request, my balance, notifications |
| karim@leaveflow.test | Manager | + approvals queue, team calendar, decision history |
| mona@leaveflow.test | HR Admin | + absence dashboard, all balances, company calendar, accrual log, audit log, leave policy |

"Reset mock data" in the account menu (top right) restores the seed data. The same menu switches between dark and light themes.

## Layout
- `css/tokens.css` design tokens; `css/app.css` components
- `js/config.js` the three API URLs and `MOCK` switch (one config file, per the plan)
- `js/mock-data.js` all dummy data; `js/api.js` one route per endpoint in the plan, with mock 401/403/404/409/422 checks
- `js/ui.js` shared shell, role menu, unread bell, modal, toast, idle logout (15 min)
- `pages/requests/` Sohaila (SohailaTaher) · `pages/approvals/` and notifications Ammar (3enany) · `pages/balance/` Seif (seifeldeendev), each page's logic in `js/pages/<name>.js`
- `tools/make-pages.py` regenerates the thin HTML wrappers

## Going live
Set `MOCK: false` in `js/config.js` and fill the three API Gateway URLs. `js/api.js` then sends the Cognito ID token as
`Authorization: Bearer`. The login page still needs wiring to the real `/auth/login` response (store `idToken` in the session).

Security choices already in place: CSP `<meta>` on every page (no inline scripts or styles), all user text rendered
with `textContent`, CSV export guards against formula injection, certificate picker accepts PDF/JPG/PNG up to 5 MB.
