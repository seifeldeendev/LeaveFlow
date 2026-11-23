"""Writes the thin HTML wrapper for each app page. Run: python3 tools/make-pages.py
Each page loads the shared scripts and its own js/pages/<name>.js. No inline scripts or styles (CSP)."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; "
       "connect-src 'self' http://localhost:4566; base-uri 'self'; form-action 'self'")
PAGES = [
  ("login.html", "Sign in", "login"),
  ("pages/home.html", "Overview", "home"),
  ("pages/notifications.html", "Notifications", "notifications"),
  ("pages/requests/my-requests.html", "My requests", "my-requests"),
  ("pages/requests/new-request.html", "New request", "new-request"),
  ("pages/requests/request.html", "Request details", "request"),
  ("pages/approvals/queue.html", "Approvals", "approvals-queue"),
  ("pages/approvals/history.html", "Decision history", "approvals-history"),
  ("pages/approvals/team-calendar.html", "Team calendar", "team-calendar"),
  ("pages/balance/my-balance.html", "My balance", "my-balance"),
  ("pages/balance/hr-balances.html", "All balances", "hr-balances"),
  ("pages/balance/calendar.html", "Company calendar", "company-calendar"),
  ("pages/balance/dashboard.html", "Absence dashboard", "dashboard"),
  ("pages/balance/accrual-log.html", "Accrual log", "accrual-log"),
  ("pages/balance/audit.html", "Audit log", "audit"),
  ("pages/balance/policy.html", "Leave policy", "policy"),
]
TPL = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta http-equiv="Content-Security-Policy" content="{csp}">
  <title>{title} · LeaveFlow</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Source+Code+Pro:wght@400;600&display=swap">
  <link rel="stylesheet" href="{r}css/tokens.css">
  <link rel="stylesheet" href="{r}css/app.css">
</head>
<body data-root="{r}" data-page="{js}">
  <noscript>LeaveFlow needs JavaScript.</noscript>
  <script src="{r}js/config.js" defer></script>
  <script src="{r}js/mock-data.js" defer></script>
  <script src="{r}js/api.js" defer></script>
  <script src="{r}js/ui.js" defer></script>
  <script src="{r}js/pages/{js}.js" defer></script>
</body>
</html>
"""
for path, title, js in PAGES:
    depth = path.count("/")
    r = "../" * depth if depth else "./"
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8", newline="") as f:
        f.write(TPL.format(csp=CSP, title=title, r=r, js=js))
print("wrote", len(PAGES), "pages")
