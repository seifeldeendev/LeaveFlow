import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
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
  role: (u.Groups || []).map((g) => g.GroupName).includes('HRAdmin') ? 'HRAdmin'
      : (u.Groups || []).map((g) => g.GroupName).includes('Manager') ? 'Manager' : 'Employee',
  managerId: attr(u, 'custom:managerId') || null,
  joinDate: attr(u, 'custom:joinDate') || null,
});

let injected;
export function setTestUsers(fn) { injected = fn; }

export async function allUsers() {
  if (injected) return injected();
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
