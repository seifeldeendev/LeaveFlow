/* LeaveFlow frontend config — the one place the three API URLs live.
   MOCK = true serves every call from js/mock-data.js so the UI works with no backend.
   Set MOCK = false and fill the URLs once each API Gateway is deployed on Floci.
   LIVE switches one service at a time to its real API while the others stay on mock data
   (the mock parts then show the demo user with the same role). */
window.LF = window.LF || {};
LF.config = {
  MOCK: true,
  LIVE: { requests: false, approvals: false, balances: false },
  // Frozen "today" for the mock data so dates stay sensible during the demo.
  MOCK_TODAY: "2026-11-23",
  APIS: {
    requests: "http://73a86a72a8.execute-api.localhost.floci.io:4566", // Sohaila: deploy/requests-outputs.json apiUrl
    approvals: "http://localhost:4566/restapis/APPROVALS_API_ID/prod/_user_request_",
    balances: "http://localhost:4566/restapis/BALANCES_API_ID/prod/_user_request_"
  },
  IDLE_LOGOUT_MINUTES: 15,
  // Times are stored in UTC and shown on this clock.
  TIME_ZONE: "Africa/Cairo",
  // Simulated API delay in mock mode. Try 900 to see the loading shimmer the way a real server feels.
  MOCK_LATENCY_MS: 120
};
