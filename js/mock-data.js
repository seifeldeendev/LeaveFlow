/* Dummy data for the LeaveFlow frontend. Every name, date and number here is made up.
   LF.seed() returns a fresh copy; js/api.js keeps a working copy in localStorage so
   actions (submit, approve, cancel, adjust) carry across pages during a demo. */
window.LF = window.LF || {};

LF.seed = function () {
  const users = [
    // Sales team (manager Karim) — 10 people, used for the coverage check
    { id: "u-nour",   name: "Nour Hassan",     role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2023-03-12", email: "nour@leaveflow.test" },
    { id: "u-karim",  name: "Karim Adel",      role: "Manager",  dept: "Sales",       managerId: "u-mona",  joinDate: "2019-09-01", email: "karim@leaveflow.test" },
    { id: "u-omar",   name: "Omar Said",       role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2024-01-15" },
    { id: "u-yara",   name: "Yara Mostafa",    role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2022-06-01" },
    { id: "u-ahmed",  name: "Ahmed Samir",     role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2021-11-20" },
    { id: "u-laila",  name: "Laila Ibrahim",   role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2020-02-03" },
    { id: "u-mostafa",name: "Mostafa Kamel",   role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2025-08-17" },
    { id: "u-salma",  name: "Salma Nabil",     role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2023-10-01" },
    { id: "u-hany",   name: "Hany Gamal",      role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2018-05-06" },
    { id: "u-dina",   name: "Dina Wael",       role: "Employee", dept: "Sales",       managerId: "u-karim", joinDate: "2026-11-16" },
    // Engineering
    { id: "u-sherif", name: "Sherif Mansour",  role: "Manager",  dept: "Engineering", managerId: "u-mona",  joinDate: "2017-04-10" },
    { id: "u-tarek",  name: "Tarek Youssef",   role: "Employee", dept: "Engineering", managerId: "u-sherif",joinDate: "2022-01-09" },
    { id: "u-rana",   name: "Rana Ali",        role: "Employee", dept: "Engineering", managerId: "u-sherif",joinDate: "2021-07-04" },
    { id: "u-mahmoud",name: "Mahmoud Fawzy",   role: "Employee", dept: "Engineering", managerId: "u-sherif",joinDate: "2024-09-22" },
    { id: "u-farida", name: "Farida Hegazy",   role: "Employee", dept: "Engineering", managerId: "u-sherif",joinDate: "2023-02-14" },
    { id: "u-youssef",name: "Youssef Ragab",   role: "Employee", dept: "Engineering", managerId: "u-sherif",joinDate: "2020-12-01" },
    // Finance
    { id: "u-heba",   name: "Heba Lotfy",      role: "Manager",  dept: "Finance",     managerId: "u-mona",  joinDate: "2016-03-01" },
    { id: "u-amr",    name: "Amr Zaki",        role: "Employee", dept: "Finance",     managerId: "u-heba",  joinDate: "2022-08-08" },
    { id: "u-mariam", name: "Mariam Soliman",  role: "Employee", dept: "Finance",     managerId: "u-heba",  joinDate: "2024-04-01" },
    // HR
    { id: "u-mona",   name: "Mona Fathy",      role: "HRAdmin",  dept: "HR",          managerId: null,      joinDate: "2015-01-04", email: "mona@leaveflow.test" },
    { id: "u-khaled", name: "Khaled Tawfik",   role: "Employee", dept: "HR",          managerId: "u-mona",  joinDate: "2023-05-28" }
  ];

  // Egyptian public holidays (Islamic dates are approximate in this mock)
  const holidays = [
    { date: "2026-01-07", name: "Coptic Christmas" },
    { date: "2026-01-25", name: "Revolution Day" },
    { date: "2026-03-19", name: "Eid al-Fitr" },
    { date: "2026-03-22", name: "Eid al-Fitr" },
    { date: "2026-04-13", name: "Sham El-Nessim" },
    { date: "2026-04-25", name: "Sinai Liberation Day" },
    { date: "2026-05-01", name: "Labour Day" },
    { date: "2026-05-26", name: "Arafat Day" },
    { date: "2026-05-27", name: "Eid al-Adha" },
    { date: "2026-05-28", name: "Eid al-Adha" },
    { date: "2026-06-16", name: "Islamic New Year" },
    { date: "2026-06-30", name: "June 30 Revolution" },
    { date: "2026-07-23", name: "Revolution Day" },
    { date: "2026-08-25", name: "Prophet's Birthday" },
    { date: "2026-10-06", name: "Armed Forces Day" },
    { date: "2027-01-07", name: "Coptic Christmas" },
    { date: "2027-01-25", name: "Revolution Day" }
  ];

  // Requests — status: Pending, Approved, Rejected, Cancelled, Withdrawn
  const R = (id, employeeId, type, start, end, days, status, created, reason, extra) =>
    Object.assign({ id, employeeId, type, start, end, workingDays: days, status, createdAt: created, reason }, extra || {});
  const requests = [
    // Nour (the demo employee)
    R("LR-1042", "u-nour", "Annual", "2026-12-14", "2026-12-17", 4, "Pending",  "2026-11-21T10:12:00Z", "Family trip to Dahab"),
    R("LR-0988", "u-nour", "Annual", "2026-10-11", "2026-10-12", 2, "Approved", "2026-09-28T08:40:00Z", "Personal errands"),
    R("LR-0951", "u-nour", "Annual", "2026-09-20", "2026-09-21", 2, "Cancelled","2026-09-02T12:05:00Z", "Wedding (postponed)"),
    R("LR-0874", "u-nour", "Sick",   "2026-08-03", "2026-08-04", 2, "Approved", "2026-08-03T07:02:00Z", "Flu"),
    R("LR-0820", "u-nour", "Annual", "2026-07-05", "2026-07-09", 5, "Approved", "2026-06-14T09:30:00Z", "Summer holiday"),
    R("LR-0701", "u-nour", "Casual", "2026-05-11", "2026-05-11", 1, "Rejected", "2026-05-10T18:44:00Z", "Car service", { decisionComment: "Quarter-end client review that day, please pick another day." }),
    R("LR-0655", "u-nour", "Annual", "2026-03-01", "2026-03-03", 3, "Approved", "2026-02-10T11:00:00Z", "Visiting family in Alexandria"),
    R("LR-0612", "u-nour", "Casual", "2026-02-16", "2026-02-16", 1, "Withdrawn","2026-02-12T15:20:00Z", "Appointment"),
    // Sales team — pending (Karim's queue)
    R("LR-1037", "u-omar",   "Annual", "2026-12-01", "2026-12-03", 3, "Pending", "2026-11-19T09:10:00Z", "Moving apartment"),
    R("LR-1040", "u-yara",   "Annual", "2026-12-13", "2026-12-17", 5, "Pending", "2026-11-20T14:22:00Z", "Year-end trip"),
    R("LR-1044", "u-ahmed",  "Casual", "2026-12-08", "2026-12-08", 1, "Pending", "2026-11-22T08:05:00Z", "Bank appointment"),
    R("LR-1045", "u-mostafa","Unpaid", "2026-12-20", "2026-12-24", 5, "Pending", "2026-11-23T07:30:00Z", "Extended family visit"),
    // Sales team — approved (show up on calendars and coverage)
    R("LR-1010", "u-laila",  "Annual", "2026-12-07", "2026-12-10", 4, "Approved", "2026-11-02T10:00:00Z", "Holiday"),
    R("LR-1012", "u-salma",  "Annual", "2026-12-08", "2026-12-09", 2, "Approved", "2026-11-04T10:00:00Z", "Family event"),
    R("LR-1015", "u-mostafa","Annual", "2026-12-07", "2026-12-08", 2, "Approved", "2026-11-05T10:00:00Z", "Personal"),
    R("LR-1021", "u-hany",   "Annual", "2026-12-14", "2026-12-15", 2, "Approved", "2026-11-10T10:00:00Z", "Personal"),
    R("LR-1023", "u-dina",   "Annual", "2026-12-15", "2026-12-17", 3, "Approved", "2026-11-11T10:00:00Z", "Graduation"),
    R("LR-1030", "u-omar",   "Sick",   "2026-11-23", "2026-11-24", 2, "Approved", "2026-11-23T06:50:00Z", "Fever"),
    R("LR-1031", "u-hany",   "Annual", "2026-11-24", "2026-11-26", 3, "Approved", "2026-11-09T10:00:00Z", "Short break"),
    // Other departments
    R("LR-1033", "u-tarek",  "Unpaid", "2026-12-06", "2026-12-17", 10, "Pending", "2026-11-17T13:00:00Z", "Postgraduate exams", { stage: "HR" }),
    R("LR-1029", "u-rana",   "Annual", "2026-11-30", "2026-12-02", 3, "Pending", "2026-11-16T09:00:00Z", "Family visit", { escalated: true, stage: "HR" }),
    R("LR-1025", "u-mahmoud","Annual", "2026-11-22", "2026-11-26", 5, "Approved", "2026-11-01T09:00:00Z", "Travel"),
    R("LR-1026", "u-amr",    "Sick",   "2026-11-23", "2026-11-23", 1, "Approved", "2026-11-23T06:10:00Z", "Migraine"),
    R("LR-1027", "u-farida", "Annual", "2026-11-25", "2026-11-26", 2, "Approved", "2026-11-03T09:00:00Z", "Personal"),
    R("LR-1028", "u-mariam", "Casual", "2026-11-26", "2026-11-26", 1, "Approved", "2026-11-20T09:00:00Z", "Errand"),
    R("LR-1039", "u-khaled", "Annual", "2026-12-21", "2026-12-24", 4, "Approved", "2026-11-18T09:00:00Z", "Holiday")
  ];

  // Status history per request (shown on request details)
  const history = {
    "LR-1042": [
      { at: "2026-11-21T10:12:00Z", status: "Submitted", by: "Nour Hassan", note: "Passed policy checks · 4 working days" },
      { at: "2026-11-21T10:12:03Z", status: "Pending", by: "Approval workflow", note: "Waiting for Karim Adel (manager)" }
    ],
    "LR-0988": [
      { at: "2026-09-28T08:40:00Z", status: "Submitted", by: "Nour Hassan", note: "Passed policy checks · 2 working days" },
      { at: "2026-09-28T08:40:02Z", status: "Pending", by: "Approval workflow", note: "Waiting for Karim Adel (manager)" },
      { at: "2026-09-29T11:15:00Z", status: "Approved", by: "Karim Adel", note: "Enjoy!" },
      { at: "2026-09-29T11:15:04Z", status: "Balance deducted", by: "Balance service", note: "−2.00 days Annual" }
    ],
    "LR-0951": [
      { at: "2026-09-02T12:05:00Z", status: "Submitted", by: "Nour Hassan", note: "Passed policy checks · 2 working days" },
      { at: "2026-09-03T09:00:00Z", status: "Approved", by: "Karim Adel", note: "" },
      { at: "2026-09-03T09:00:05Z", status: "Balance deducted", by: "Balance service", note: "−2.00 days Annual" },
      { at: "2026-09-15T16:30:00Z", status: "Cancelled", by: "Nour Hassan", note: "Event postponed" },
      { at: "2026-09-15T16:30:04Z", status: "Balance refunded", by: "Balance service", note: "+2.00 days Annual" }
    ],
    "LR-0701": [
      { at: "2026-05-10T18:44:00Z", status: "Submitted", by: "Nour Hassan", note: "Passed policy checks · 1 working day" },
      { at: "2026-05-10T18:44:02Z", status: "Pending", by: "Approval workflow", note: "Waiting for Karim Adel (manager)" },
      { at: "2026-05-11T07:50:00Z", status: "Rejected", by: "Karim Adel", note: "Quarter-end client review that day, please pick another day." }
    ]
  };

  // Approval tasks (Approval Workflow service)
  const tasks = [
    { id: "T-5531", requestId: "LR-1037", approverId: "u-karim", step: "Manager", createdAt: "2026-11-19T09:10:05Z", status: "Pending" },
    { id: "T-5540", requestId: "LR-1040", approverId: "u-karim", step: "Manager", createdAt: "2026-11-20T14:22:05Z", status: "Pending" },
    { id: "T-5542", requestId: "LR-1042", approverId: "u-karim", step: "Manager", createdAt: "2026-11-21T10:12:03Z", status: "Pending" },
    { id: "T-5547", requestId: "LR-1044", approverId: "u-karim", step: "Manager", createdAt: "2026-11-22T08:05:04Z", status: "Pending" },
    { id: "T-5550", requestId: "LR-1045", approverId: "u-karim", step: "Manager", createdAt: "2026-11-23T07:30:04Z", status: "Pending" },
    { id: "T-5521", requestId: "LR-1033", approverId: "u-mona",  step: "HR",      createdAt: "2026-11-18T10:00:00Z", status: "Pending", note: "Unpaid leave needs HR as a second step" },
    { id: "T-5518", requestId: "LR-1029", approverId: "u-mona",  step: "HR",      createdAt: "2026-11-18T09:00:00Z", status: "Pending", escalated: true, note: "Escalated: pending 48 hours with Sherif Mansour" }
  ];
  const decisions = [
    { taskId: "T-5490", requestId: "LR-1031", approverId: "u-karim", decision: "Approved", at: "2026-11-10T09:20:00Z", comment: "", employee: "Hany Gamal", type: "Annual", start: "2026-11-24", end: "2026-11-26", days: 3 },
    { taskId: "T-5494", requestId: "LR-1010", approverId: "u-karim", decision: "Approved", at: "2026-11-03T12:00:00Z", comment: "Approved, please hand over the Alex account.", employee: "Laila Ibrahim", type: "Annual", start: "2026-12-07", end: "2026-12-10", days: 4 },
    { taskId: "T-5496", requestId: "LR-1012", approverId: "u-karim", decision: "Approved", at: "2026-11-05T08:30:00Z", comment: "", employee: "Salma Nabil", type: "Annual", start: "2026-12-08", end: "2026-12-09", days: 2 },
    { taskId: "T-5470", requestId: "LR-0990", approverId: "u-karim", decision: "Rejected", at: "2026-10-20T15:00:00Z", comment: "Coverage would drop to 60% during the product launch.", employee: "Ahmed Samir", type: "Annual", start: "2026-10-26", end: "2026-10-29", days: 4 },
    { taskId: "T-5401", requestId: "LR-0988", approverId: "u-karim", decision: "Approved", at: "2026-09-29T11:15:00Z", comment: "Enjoy!", employee: "Nour Hassan", type: "Annual", start: "2026-10-11", end: "2026-10-12", days: 2 },
    { taskId: "T-5460", requestId: "LR-0975", approverId: "u-mona", decision: "Approved", at: "2026-10-12T10:00:00Z", comment: "Unpaid, confirmed with payroll.", employee: "Youssef Ragab", type: "Unpaid", start: "2026-10-18", end: "2026-10-22", days: 5 }
  ];

  // Balance ledger (Balance & Accrual service, append-only). amount in days.
  const L = (id, employeeId, at, kind, type, amount, ref, note) => ({ id, employeeId, at, kind, type, amount, ref, note });
  const ledger = [
    L("E-0001", "u-nour", "2026-01-01T00:05:00Z", "Carry-over", "Annual", 5,    "carryover-2025", "Capped at 5 days (had 7.5)"),
    L("E-0002", "u-nour", "2026-01-01T00:05:10Z", "Allowance",  "Casual", 6,    "allowance-2026", "Yearly casual allowance"),
  ];
  ["01","02","03","04","05","06","07","08","09","10","11"].forEach((m, i) => {
    ledger.push(L("E-1" + m, "u-nour", "2026-" + m + "-01T00:10:00Z", "Accrual", "Annual", 1.75, "accrual-2026-" + m, "Monthly accrual"));
  });
  ledger.push(
    L("E-2001", "u-nour", "2026-02-11T09:00:05Z", "Deduction",  "Annual", -3,   "LR-0655", "Approved request"),
    L("E-2002", "u-nour", "2026-06-15T09:00:05Z", "Deduction",  "Annual", -5,   "LR-0820", "Approved request"),
    L("E-2003", "u-nour", "2026-09-03T09:00:05Z", "Deduction",  "Annual", -2,   "LR-0951", "Approved request"),
    L("E-2004", "u-nour", "2026-09-15T16:30:04Z", "Refund",     "Annual", 2,    "LR-0951", "Request cancelled"),
    L("E-2005", "u-nour", "2026-09-29T11:15:04Z", "Deduction",  "Annual", -2,   "LR-0988", "Approved request"),
    L("E-2006", "u-nour", "2026-10-08T13:40:00Z", "Adjustment", "Annual", 1,    "ADJ-0031", "Worked on Armed Forces Day (Oct 6)")
  );
  ledger.sort((a, b) => a.at.localeCompare(b.at));

  // Snapshot balances for everyone else (Annual, Casual), days
  const balances = {
    "u-karim":  { Annual: 18.5,  Casual: 4 }, "u-omar":   { Annual: 9.25, Casual: 5 },
    "u-yara":   { Annual: 12.0,  Casual: 3 }, "u-ahmed":  { Annual: 6.5,  Casual: 2 },
    "u-laila":  { Annual: 14.75, Casual: 6 }, "u-mostafa":{ Annual: 3.5,  Casual: 6 },
    "u-salma":  { Annual: 11.0,  Casual: 4 }, "u-hany":   { Annual: 20.25,Casual: 1 },
    "u-dina":   { Annual: 0.70,  Casual: 6 }, "u-sherif": { Annual: 16.0, Casual: 5 },
    "u-tarek":  { Annual: 2.0,   Casual: 0 }, "u-rana":   { Annual: 10.25,Casual: 4 },
    "u-mahmoud":{ Annual: 7.75,  Casual: 3 }, "u-farida": { Annual: 13.5, Casual: 5 },
    "u-youssef":{ Annual: 19.0,  Casual: 6 }, "u-heba":   { Annual: 22.0, Casual: 6 },
    "u-amr":    { Annual: 8.0,   Casual: 2 }, "u-mariam": { Annual: 15.25,Casual: 5 },
    "u-mona":   { Annual: 17.5,  Casual: 6 }, "u-khaled": { Annual: 9.0,  Casual: 4 }
  };

  const accrualRuns = [];
  const months = ["January","February","March","April","May","June","July","August","September","October","November"];
  const heads = [17,17,18,18,18,18,19,19,19,20,21];
  months.forEach((name, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const prorata = [0,0,1,0,0,0,1,0,0,1,1][i];
    accrualRuns.push({
      id: "ACR-2026-" + mm, month: "2026-" + mm, label: name + " 2026",
      startedAt: "2026-" + mm + "-01T00:10:00Z", durationMs: 1400 + i * 37,
      employees: heads[i], proRata: prorata, totalDays: +(heads[i] * 1.75 - prorata * 0.9).toFixed(2),
      trigger: i === 10 ? "Manual (demo)" : "Scheduler", status: "Completed", duplicatesSkipped: i === 6 ? 1 : 0
    });
  });
  accrualRuns.reverse();

  const audit = [
    { id: "A-9912", at: "2026-11-23T07:30:04Z", actor: "Mostafa Kamel", action: "REQUEST_SUBMITTED", target: "LR-1045", result: "OK", service: "requests" },
    { id: "A-9911", at: "2026-11-23T06:50:10Z", actor: "Karim Adel",    action: "REQUEST_APPROVED",  target: "LR-1030", result: "OK", service: "approvals" },
    { id: "A-9910", at: "2026-11-23T06:41:00Z", actor: "unknown",       action: "LOGIN_FAILED",      target: "tarek@leaveflow.test", result: "DENIED", service: "requests" },
    { id: "A-9909", at: "2026-11-22T21:04:00Z", actor: "Ahmed Samir",   action: "ACCESS_DENIED",     target: "GET /balances", result: "403", service: "balances" },
    { id: "A-9908", at: "2026-11-22T08:05:04Z", actor: "Ahmed Samir",   action: "REQUEST_SUBMITTED", target: "LR-1044", result: "OK", service: "requests" },
    { id: "A-9907", at: "2026-11-21T10:12:03Z", actor: "Nour Hassan",   action: "REQUEST_SUBMITTED", target: "LR-1042", result: "OK", service: "requests" },
    { id: "A-9906", at: "2026-11-20T16:02:00Z", actor: "Mona Fathy",    action: "POLICY_UPDATED",    target: "/leaveflow/policy/annual-notice-days 5 → 7", result: "OK", service: "balances" },
    { id: "A-9905", at: "2026-11-18T09:00:00Z", actor: "Approval workflow", action: "REQUEST_ESCALATED", target: "LR-1029", result: "OK", service: "approvals" },
    { id: "A-9904", at: "2026-11-17T12:30:00Z", actor: "unknown",       action: "ACCOUNT_LOCKED",    target: "omar@leaveflow.test", result: "LOCKED", service: "requests" },
    { id: "A-9903", at: "2026-11-16T09:00:00Z", actor: "Mona Fathy",    action: "BALANCE_ADJUSTED",  target: "Dina Wael · Annual +0.70", result: "OK", service: "balances" },
    { id: "A-9902", at: "2026-11-01T00:10:00Z", actor: "accrual-fn",    action: "ACCRUAL_RUN",       target: "2026-11 · 21 employees", result: "OK", service: "balances" },
    { id: "A-9901", at: "2026-10-08T13:40:00Z", actor: "Mona Fathy",    action: "BALANCE_ADJUSTED",  target: "Nour Hassan · Annual +1.00", result: "OK", service: "balances" },
    { id: "A-9900", at: "2026-09-15T16:30:04Z", actor: "balances-worker", action: "EVENT_DUPLICATE_SKIPPED", target: "request.cancelled LR-0951", result: "SKIPPED", service: "balances" }
  ];

  const notifications = [
    { id: "N-301", userId: "u-nour",  at: "2026-11-21T10:12:05Z", title: "Request submitted", body: "LR-1042 · Annual, 14–17 Dec is waiting for Karim Adel.", link: "pages/requests/request.html?id=LR-1042", read: false },
    { id: "N-288", userId: "u-nour",  at: "2026-11-01T00:10:05Z", title: "+1.75 days accrued", body: "November accrual added to your Annual balance.", link: "pages/balance/my-balance.html", read: false },
    { id: "N-240", userId: "u-nour",  at: "2026-09-29T11:15:05Z", title: "Request approved", body: "Karim Adel approved LR-0988 (11–12 Oct).", link: "pages/requests/request.html?id=LR-0988", read: true },
    { id: "N-305", userId: "u-karim", at: "2026-11-23T07:30:05Z", title: "New request to review", body: "Mostafa Kamel · Unpaid, 20–24 Dec (5 days).", link: "pages/approvals/queue.html", read: false },
    { id: "N-304", userId: "u-karim", at: "2026-11-22T08:05:05Z", title: "New request to review", body: "Ahmed Samir · Casual, 8 Dec.", link: "pages/approvals/queue.html", read: false },
    { id: "N-302", userId: "u-karim", at: "2026-11-21T10:12:05Z", title: "New request to review", body: "Nour Hassan · Annual, 14–17 Dec (4 days).", link: "pages/approvals/queue.html", read: false },
    { id: "N-299", userId: "u-karim", at: "2026-11-21T14:22:05Z", title: "Escalation in 4 hours", body: "Yara Mostafa's request goes to HR if not decided.", link: "pages/approvals/queue.html", read: true },
    { id: "N-306", userId: "u-mona",  at: "2026-11-18T09:00:05Z", title: "Escalated to you", body: "Rana Ali · Annual, 30 Nov–2 Dec. Pending 48h with Sherif Mansour.", link: "pages/approvals/queue.html", read: false },
    { id: "N-307", userId: "u-mona",  at: "2026-11-18T10:00:05Z", title: "HR step waiting", body: "Tarek Youssef · Unpaid, 10 days.", link: "pages/approvals/queue.html", read: false }
  ];

  const policy = [
    { name: "accrual-per-month",   label: "Accrual per month",      value: 1.75, unit: "days",  min: 0.5, max: 3,  step: 0.25, help: "Added to every Annual balance on the 1st. Pro-rata for mid-month joiners." },
    { name: "carryover-cap",       label: "Year-end carry-over cap", value: 5,    unit: "days",  min: 0,   max: 15, step: 1,    help: "Unused Annual days above this are dropped on 1 January." },
    { name: "annual-notice-days",  label: "Annual leave notice",     value: 7,    unit: "days",  min: 0,   max: 30, step: 1,    help: "How far ahead an Annual request must be submitted." },
    { name: "max-consecutive-days",label: "Max consecutive days",    value: 15,   unit: "working days", min: 1, max: 30, step: 1, help: "Longest single request allowed." }
  ];

  const blackouts = [{ start: "2026-12-27", end: "2026-12-31", dept: "Sales", name: "Year-end sales close" }];

  return { users, holidays, requests, history, tasks, decisions, ledger, balances, accrualRuns, audit, notifications, policy, blackouts, seq: 1046 };
};
