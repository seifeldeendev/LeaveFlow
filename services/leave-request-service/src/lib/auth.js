// Shared auth helper. Ammar and Seif copy this file into their services unchanged.
// 1) Behind API Gateway, the JWT authorizer has already checked the token; we read its claims.
// 2) Running locally (no API Gateway), we verify the Cognito token ourselves.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cfg } from './config.js';
import { HttpError } from './errors.js';

let jwks;
const getJwks = () => (jwks ??= createRemoteJWKSet(new URL(cfg.jwksUrl)));

function parseGroups(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.replace(/[\[\]]/g, '').split(/[ ,]+/).filter(Boolean); // API Gateway sends "[Manager]"
  return [];
}

// "mona.employee@leaveflow.test" -> "Mona" when the pool has no name attribute.
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

export async function requireAuth(req, _res, next) {
  try {
    const claims = req.lambdaEvent?.requestContext?.authorizer?.jwt?.claims;
    if (claims?.sub) {
      req.user = toUser(claims);
      return next();
    }
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Login required');
    const { payload } = await jwtVerify(token, getJwks(), { issuer: cfg.issuer, audience: cfg.clientId });
    if (payload.token_use !== 'id') throw new HttpError(401, 'UNAUTHENTICATED', 'Wrong token type');
    req.user = toUser(payload);
    return next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    return next(new HttpError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
  }
}

// Usage: router.get('/x', requireAuth, requireRole('Manager', 'HRAdmin'), handler)
export const requireRole = (...roles) => (req, _res, next) =>
  roles.some((r) => req.user?.groups.includes(r))
    ? next()
    : next(new HttpError(403, 'FORBIDDEN', 'Your role cannot do this'));
