# Approval Workflow service (owner: Ammar, GitHub 3enany)

Decides who must approve a leave request and moves it through the approval steps.

| Function | What it does |
|---|---|
| Routing | `request.submitted` creates a Manager step for the employee's manager. More than 5 working days or Unpaid leave also needs HR as a second step. No manager on file means HR decides. |
| Team coverage check | A manager can't approve if more than 30% of the department would be off on any day (warning above 20%). HR can still decide. |
| Escalation | A Manager step left for 48 hours (2 minutes with `DEMO_MODE=true`) moves to HR. A Step Functions timer triggers it, and the queue re-checks overdue steps on every load as a safety net. |
| Notifications | The SNS topic `leaveflow-notifications` plus the in-app inbox (unread bell). |

## AWS services (all on Floci)
API Gateway (`approvals-api`, JWT authorizer), Lambda (`approvals-fn`), IAM (least-privilege roles in `deploy/policies/`),
CloudWatch Logs, Step Functions (`leave-approval-escalation`), EventBridge (`leaveflow-bus` and all routing rules),
SNS (`leaveflow-notifications`), CloudWatch metric filters and alarms, Secrets Manager (`leaveflow/approvals`).
The database is Neon `leaveflow-approvals` (`db/schema.sql`).

## API (approvals-api)
| Method and path | Who | Notes |
|---|---|---|
| `GET /approvals` | Manager, HR | Only steps assigned to the caller; never their own request |
| `POST /approvals/{taskId}/decision` | Assigned approver | `{ decision: "Approved"/"Rejected", comment }`. Comment required on reject. 403 if the task isn't yours or the request is your own; 409 if already decided or the coverage limit is hit |
| `GET /approvals/history` | Manager, HR | Decisions the caller made |
| `GET /team-calendar` | Manager, HR | Own department (HR: everyone) |
| `GET /notifications`, `PATCH /notifications`, `PATCH`/`DELETE /notifications/{id}` | Anyone signed in | Own notifications only (others' are 404) |
| `GET /health` | Public | |

## Events
Consumes `request.submitted` and `request.cancelled` (source `leaveflow.requests`). Publishes `request.approved`,
`request.rejected` and `audit` (source `leaveflow.approvals`). Every eventId is processed once (`processed_events`).

## Run
```
npm install
copy .env.example .env        # then put DATABASE_URL in .env (never commit it)
node db/migrate.mjs db/schema.sql
npm run dev                   # http://localhost:3001  (Cognito ids come from ../leave-request-service/deploy/cognito-outputs.json)
powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1
powershell -ExecutionPolicy Bypass -File .\tests\smoke.ps1
```

## Limitations on Floci
Floci stores IAM policies but does not enforce most of them, unlike real AWS. Alarms and metric filters are created,
but whether Floci evaluates them depends on its CloudWatch support. Escalation also runs on every queue load,
so the demo works even if the Step Functions timer does not fire.
