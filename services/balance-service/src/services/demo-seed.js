import { HttpError } from '../lib/errors.js';

export const REASON = 'Opening balance 2026 (demo seed)';
export const CREATED_BY = 'system:seed';
export const SEED_YEAR = '2026';

export const DEMO_USERS = Object.freeze([
  { name: 'Mona', email: 'mona.employee@leaveflow.test', Annual: 15, Casual: 6 },
  { name: 'Omar', email: 'omar.employee@leaveflow.test', Annual: 2, Casual: 6 },
  { name: 'Ali', email: 'ali.employee@leaveflow.test', Annual: 15, Casual: 6 },
  { name: 'Nour', email: 'nour.employee@leaveflow.test', Annual: 15, Casual: 6 },
  { name: 'Sara', email: 'sara.manager@leaveflow.test', Annual: 15, Casual: 6 },
  { name: 'Karim', email: 'karim.manager@leaveflow.test', Annual: 15, Casual: 6 },
  { name: 'Hana', email: 'hana.hr@leaveflow.test', Annual: 15, Casual: 6 },
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUB_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const attr = (u, name) => (u.Attributes || u.UserAttributes || []).find((a) => a.Name === name)?.Value;

export async function findUserByEmail(cognito, userPoolId, email) {
  if (!userPoolId || typeof userPoolId !== 'string') {
    throw new HttpError(500, 'SEED_CONFIG_MISSING', 'Cognito User Pool id is missing.');
  }
  if (!email || typeof email !== 'string') throw new HttpError(400, 'BAD_EMAIL', 'A user email is required.');

  const matches = [];
  let token;
  do {
    const list = typeof cognito === 'function' ? cognito : cognito.listUsers.bind(cognito);
    const out = await list({ UserPoolId: userPoolId, Filter: `email="${email}"`, Limit: 60, PaginationToken: token });
    for (const u of out?.Users || []) {
      if (u.Enabled === false) continue;
      if (String(attr(u, 'email') || '').toLowerCase() === email.toLowerCase()) matches.push(u);
    }
    token = out?.PaginationToken;
  } while (token);

  if (matches.length === 0) throw new HttpError(404, 'SEED_USER_NOT_FOUND', `No Cognito user for ${email}.`);
  if (matches.length > 1) throw new HttpError(409, 'SEED_USER_DUPLICATE', `Multiple Cognito users for ${email}.`);
  const sub = attr(matches[0], 'sub');
  if (!sub || !SUB_UUID.test(sub)) throw new HttpError(500, 'SEED_SUB_INVALID', `Invalid Cognito sub for ${email}.`);
  return sub;
}

export function plannedEntries(userId, user) {
  return ['Annual', 'Casual'].map((leaveType) => ({
    employeeId: userId,
    leaveType,
    amount: user[leaveType],
    kind: 'Adjustment',
    reason: REASON,
    createdBy: CREATED_BY,
    eventId: `seed-opening:${SEED_YEAR}:${userId}:${leaveType}`,
  }));
}

export async function resolveAll(cognito, userPoolId, users = DEMO_USERS) {
  const resolved = [];
  for (const u of users) {
    const sub = await findUserByEmail(cognito, userPoolId, u.email);
    resolved.push({ user: u, sub });
  }
  return resolved;
}

export function buildPlan(resolved) {
  return resolved.flatMap(({ user, sub }) => plannedEntries(sub, user));
}

export async function applyPlan(sql, plan) {
  if (!sql) throw new HttpError(500, 'SEED_DB_MISSING', 'Database is not configured.');
  let inserted = 0;
  for (const e of plan) {
    if (!UUID.test(e.employeeId)) throw new HttpError(500, 'SEED_SUB_INVALID', 'Invalid Cognito sub.');
    if (!Number.isFinite(e.amount) || e.amount <= 0) throw new HttpError(500, 'SEED_AMOUNT_INVALID', 'Invalid opening amount.');
    const rows = await sql`
      INSERT INTO ledger_entries
        (employee_id, leave_type, kind, amount, request_id, event_id, accrual_run_id,
         reason, created_by, created_by_name)
      VALUES (${e.employeeId}, ${e.leaveType}, ${e.kind}, ${e.amount}, ${null},
              ${e.eventId}, ${null}, ${e.reason}, ${e.createdBy}, ${null})
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id`;
    if (rows.length) inserted++;
  }
  return inserted;
}
