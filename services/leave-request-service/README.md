# LeaveFlow: Leave Request & Policy Engine service

**Owner:** Sohaila Taher (GitHub [SohailaTaher](https://github.com/SohailaTaher)) · Team 15 · Cloud Computing & Cloud Security (26CSCN29H)

This is my individual component of **LeaveFlow**, an HR leave-request system built as three microservices on AWS
(emulated with [Floci](https://floci.io)). The integrated project lives in the team repository
[seifeldeendev/LeaveFlow-Frontend](https://github.com/seifeldeendev/LeaveFlow-Frontend), where this service is
`services/leave-request-service/`. This repository contains the same folder **with its full commit history**
(copied with `git subtree`), as proof of my individual work.

- My commits in the team repo: [commits by SohailaTaher](https://github.com/seifeldeendev/LeaveFlow-Frontend/commits?author=SohailaTaher)
- My pull requests: [PRs by SohailaTaher](https://github.com/seifeldeendev/LeaveFlow-Frontend/pulls?q=author%3ASohailaTaher)

## What this service does
It decides whether a leave request is allowed under company policy, and owns the request from submission to its final state.

| Function | Details |
|---|---|
| **Identity** (shared by all services) | Cognito user pool with groups Employee / Manager / HRAdmin and custom attributes (department, manager, join date); login with **account lockout** (5 failures → 15 minutes), **MFA (TOTP) required for Managers and HR**, refresh tokens and real logout (`GlobalSignOut`) |
| **Policy engine** | Working days without Fridays, Saturdays and Egyptian public holidays (Nager.Date, cached in Neon); notice period per leave type; maximum consecutive days; blackout dates per department; no overlap with the employee's own requests (also enforced by a Postgres exclusion constraint); projected-balance check by invoking the Balance service's Lambda |
| **Request lifecycle** | Fixed states Pending → Approved / Rejected / Withdrawn / Cancelled; only allowed transitions; full status history; publishes `request.submitted` / `request.cancelled` and `audit` events to EventBridge; applies `request.approved` / `request.rejected` from the Approval service exactly once |
| **Medical certificates** | Sick leave over 2 days needs a certificate; private S3 bucket encrypted with my own KMS key; 5-minute pre-signed upload and view links; PDF/JPG/PNG only, 5 MB max, enforced by S3 itself |

## AWS services I own (on Floci)
| Service | Use |
|---|---|
| **Cognito** | Users, roles (groups), passwords, MFA, ID/access/refresh tokens |
| **S3** | Private, versioned bucket for medical certificates; public access blocked; bucket policy denies unencrypted uploads |
| **KMS** | Customer key (with rotation) encrypting the certificates, because they are health data |
| **Secrets Manager** | The Neon database URL; nothing secret in code or environment files |
| API Gateway (HTTP API) | `requests-api`, rate-limited (10 req/s, burst 20) |
| Lambda | `requests-fn`: the Express app (via serverless-http) plus the EventBridge consumer |
| IAM | Least-privilege role; every policy is a JSON file in `deploy/policies/` |
| CloudWatch Logs | One JSON log line per security event (`LOGIN_FAILED`, `ACCOUNT_LOCKED`, `MFA_FAILED`, `ACCESS_DENIED`, `EVENT_REJECTED`), 14-day retention |
| EventBridge | Publishes to the shared `leaveflow-bus` |

**Database:** Neon Postgres `leaveflow-requests` (my own database; the other services have their own databases and least-privilege logins and never read mine).

## Security controls
- Tokens verified on every protected route (signature, issuer, audience, expiry, token type) with `jose`; roles and ownership checked in code. Another user's request returns **404**, so ids can't be probed.
- Generic login errors (no user enumeration), lockout, MFA for privileged roles, 15-minute ID tokens, idle logout in the frontend.
- Input validation on every field; **415** for non-JSON, **10 KB** body limit; parameterised SQL only; CHECK constraints as a second line of defence.
- CORS only for the frontend origin; `X-Content-Type-Options: nosniff`; no stack traces in errors.
- Events: only the trusted source is accepted, each `eventId` is applied once (`processed_events`), and a request never moves backwards.

## API (`requests-api`)
| Method and path | Who |
|---|---|
| `POST /auth/login`, `/auth/mfa`, `/auth/mfa/setup`, `/auth/mfa/verify`, `/auth/refresh`, `/auth/logout` | Anyone / signed in |
| `GET /me` | Signed in |
| `GET /working-days?start=&end=&type=` | Signed in (preview with every policy check) |
| `POST /leave-requests` · `GET /leave-requests?status=&type=&from=&to=` | Own requests |
| `GET /leave-requests/{id}` | Owner, their manager, HR |
| `PATCH /leave-requests/{id}/status` `{action: withdraw\|cancel}` | Owner |
| `POST` / `GET` / `DELETE /leave-requests/{id}/certificate` | Owner (view: also manager and HR) |

## Frontend pages I built (in the team repo)
`pages/requests/` with `js/pages/new-request.js` (live working-day preview), `my-requests.js`, `request.js` (timeline, withdraw/cancel, certificates);
the live Cognito session, MFA setup and token refresh in `js/api.js` and `js/pages/login.js`.

## Run and deploy
```powershell
npm install
copy .env.example .env                      # fill in; never commit .env
npm run dev                                 # http://localhost:3000
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-cognito.ps1   # once: Cognito pool, groups, test users
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1           # KMS, S3, secret, IAM, Lambda, API
powershell -ExecutionPolicy Bypass -File .\tests\smoke.ps1 -Api <apiUrl>
```
Database: run `db/schema.sql`, `db/002_policy.sql` and `db/003_frontend_fields.sql` in Neon.

## Notes on Floci (honest limitations)
- Floci's HTTP API JWT authorizer refuses to fetch keys from a `localhost` issuer (an SSRF guard), so on Floci the
  token is verified inside the Lambda; on real AWS set `LEAVEFLOW_GATEWAY_JWT=true` to also reject bad tokens at the gateway.
- Floci stores IAM policies but does not enforce most of them; they are still written least-privilege for real AWS.
- Inside Lambda, Express 5's body parser skips requests created by serverless-http, so `src/lib/lambda-body.js` parses JSON with the same limits.
