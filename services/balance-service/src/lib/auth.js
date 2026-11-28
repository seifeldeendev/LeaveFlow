import { createRemoteJWKSet, jwtVerify } from 'jose';
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { cfg, awsClientConfig } from './config.js';
import { HttpError } from './errors.js';
import { log } from './log.js';

let jwks;
const getJwks = () => (jwks ??= createRemoteJWKSet(new URL(cfg.jwksUrl)));

export const PRIVILEGED_GROUPS = ['Manager', 'HRAdmin'];

function parseGroups(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.replace(/[\[\]]/g, '').split(/[ ,]+/).filter(Boolean);
  return [];
}

const nameFrom = (c) => c.name || String(c.email || '').split('@')[0].split(/[._-]/)[0].replace(/^./, (x) => x.toUpperCase());
const roleOf = (groups) => (groups.includes('HRAdmin') ? 'HRAdmin' : groups.includes('Manager') ? 'Manager' : 'Employee');

export function toUser(c) {
  const groups = parseGroups(c['cognito:groups']);
  return {
    id: c.sub,
    email: c.email,
    name: nameFrom(c),
    groups,
    role: roleOf(groups),
    department: c['custom:department'],
    dept: c['custom:department'],
    managerId: c['custom:managerId'] || null,
  };
}

const MFA_OK_TTL_MS = 5 * 60 * 1000;
const MFA_NO_TTL_MS = 30 * 1000;
const mfaCache = new Map();
let cognito;
let mfaLookup = async (username) => {
  cognito ??= new CognitoIdentityProviderClient(awsClientConfig());
  const out = await cognito.send(new AdminGetUserCommand({ UserPoolId: cfg.userPoolId, Username: username }));
  return (out.UserMFASettingList || []).includes('SOFTWARE_TOKEN_MFA');
};
export function setMfaLookup(fn) { mfaLookup = fn; mfaCache.clear(); }

const mfaRequired = () => process.env.REQUIRE_PRIVILEGED_MFA !== 'false';

async function hasMfa(username, tokenId) {
  const okKey = `ok:${username}`; const noKey = `no:${username}:${tokenId ?? ''}`;
  for (const k of [okKey, noKey]) {
    const hit = mfaCache.get(k);
    if (hit && hit.until > Date.now()) return k === okKey;
  }
  const ok = await mfaLookup(username);
  if (mfaCache.size > 5000) mfaCache.clear();
  mfaCache.set(ok ? okKey : noKey, { until: Date.now() + (ok ? MFA_OK_TTL_MS : MFA_NO_TTL_MS) });
  return ok;
}

export async function enforcePrivilegedMfa(user, username, tokenId) {
  if (!mfaRequired() || !user.groups.some((g) => PRIVILEGED_GROUPS.includes(g))) return user;
  let ok = false;
  try {
    ok = await hasMfa(username || user.id, tokenId);
  } catch (err) {
    log('error', 'MFA_CHECK_FAILED', { userId: user.id, message: err.name || 'error' });
  }
  if (ok) return user;
  log('warn', 'PRIVILEGE_WITHHELD_NO_MFA', { userId: user.id, groups: user.groups.filter((g) => PRIVILEGED_GROUPS.includes(g)) });
  const groups = user.groups.filter((g) => !PRIVILEGED_GROUPS.includes(g));
  return { ...user, groups, role: roleOf(groups), privilegesWithheld: true };
}

export async function requireAuth(req, _res, next) {
  try {
    if (process.env.NODE_ENV === 'test' && req.get('x-test-user')) {
      req.user = JSON.parse(req.get('x-test-user'));
      return next();
    }
    const claims = req.lambdaEvent?.requestContext?.authorizer?.jwt?.claims;
    if (claims?.sub) {
      req.user = await enforcePrivilegedMfa(toUser(claims), claims['cognito:username'], claims.jti || claims.iat);
      return next();
    }
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Login required');
    const { payload } = await jwtVerify(token, getJwks(), { issuer: cfg.issuer, audience: cfg.clientId });
    if (payload.token_use !== 'id') throw new HttpError(401, 'UNAUTHENTICATED', 'Wrong token type');
    req.user = await enforcePrivilegedMfa(toUser(payload), payload['cognito:username'], payload.jti || payload.iat);
    return next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    return next(new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
  }
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (roles.some((r) => req.user?.groups.includes(r))) return next();
  if (req.user?.privilegesWithheld && roles.some((r) => PRIVILEGED_GROUPS.includes(r))) {
    return next(new HttpError(403, 'MFA_REQUIRED', 'Manager and HR access needs multi-factor sign-in. Sign in through LeaveFlow to set up your authenticator app.'));
  }
  return next(new HttpError(403, 'FORBIDDEN', 'Your role cannot do this'));
};
