// Reads people from the Cognito user pool: team sizes for the coverage check, HR users to notify.
// Read-only (ListUsers, ListUsersInGroup); the IAM policy allows nothing else in Cognito.
import { CognitoIdentityProviderClient, ListUsersCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { cfg, awsClientConfig } from './config.js';

const cognito = new CognitoIdentityProviderClient(awsClientConfig());
const CACHE_MS = 60_000;
let cache = { at: 0, users: [] };

const attr = (u, name) => (u.Attributes || u.UserAttributes || []).find((a) => a.Name === name)?.Value || '';
const nameFromEmail = (email) => String(email || '').split('@')[0].split(/[._-]/)[0].replace(/^./, (x) => x.toUpperCase());
const toPerson = (u) => ({
  id: attr(u, 'sub'),
  email: attr(u, 'email'),
  name: attr(u, 'name') || nameFromEmail(attr(u, 'email')),
  dept: attr(u, 'custom:department'),
  managerId: attr(u, 'custom:managerId') || null,
});

// Every user in the pool (Cognito cannot filter on custom attributes, so we filter in code).
export async function allUsers() {
  if (Date.now() - cache.at < CACHE_MS) return cache.users;
  const users = [];
  let token;
  do {
    const out = await cognito.send(new ListUsersCommand({ UserPoolId: cfg.userPoolId, Limit: 60, PaginationToken: token }));
    users.push(...(out.Users || []).filter((u) => u.Enabled !== false).map(toPerson));
    token = out.PaginationToken;
  } while (token);
  cache = { at: Date.now(), users };
  return users;
}

export async function departmentMembers(dept) {
  return (await allUsers()).filter((u) => u.dept === dept);
}

export async function hrUserIds() {
  const out = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: cfg.userPoolId, GroupName: 'HRAdmin', Limit: 60 }));
  return (out.Users || []).map((u) => attr(u, 'sub')).filter(Boolean);
}
