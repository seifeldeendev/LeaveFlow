import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const ISSUER = 'https://cognito-idp.test.invalid/us-east-1_testpool';
const CLIENT = 'test-client-id';
const kp = await generateKeyPair('RS256');
const key = { priv: kp.privateKey, pub: kp.publicKey };
const otherKey = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(key.pub)), kid: 'k1', alg: 'RS256', use: 'sig' };
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.COGNITO_JWKS_URL = `http://127.0.0.1:${server.address().port}/jwks.json`;
process.env.COGNITO_ISSUER = ISSUER;
process.env.COGNITO_CLIENT_ID = CLIENT;
process.env.COGNITO_USER_POOL_ID = 'us-east-1_testpool';
delete process.env.REQUIRE_PRIVILEGED_MFA;
const auth = await import('../src/lib/auth.js');

after(() => server.close());

let lookups;
beforeEach(() => {
  delete process.env.REQUIRE_PRIVILEGED_MFA;
  lookups = [];
  auth.setMfaLookup(async (username) => { lookups.push(username); return username.startsWith('mfa-'); });
});

const now = () => Math.floor(Date.now() / 1000);
async function token(claims = {}, { signWith = key.priv, alg = 'RS256', kid = 'k1', exp = now() + 900 } = {}) {
  const base = { sub: claims.sub || 'user-1', token_use: 'id', 'cognito:username': claims.sub || 'user-1', email: 'x@leaveflow.test', ...claims };
  return new SignJWT(base).setProtectedHeader({ alg, kid }).setIssuer(claims.iss || ISSUER).setAudience(claims.aud || CLIENT)
    .setIssuedAt(now() - 60).setExpirationTime(exp).sign(signWith);
}
const unsigned = (claims) => `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;

async function run(authorization, lambdaEvent) {
  const req = { get: (h) => (h.toLowerCase() === 'authorization' ? authorization : undefined), lambdaEvent };
  let err;
  await auth.requireAuth(req, {}, (e) => { err = e; });
  return { user: req.user, err };
}
const roleCheck = (user, ...roles) => { let err; auth.requireRole(...roles)({ user }, {}, (e) => { err = e; }); return err; };

test('AUTH-1 missing token -> 401', async () => {
  const { err } = await run(undefined);
  assert.equal(err.status, 401); assert.equal(err.code, 'UNAUTHENTICATED');
});

test('AUTH-2 malformed token -> 401', async () => {
  const { err } = await run('Bearer not-a-jwt');
  assert.equal(err.status, 401);
});

test('AUTH-3 token signed by another key -> 401', async () => {
  const { err } = await run(`Bearer ${await token({ 'cognito:groups': ['HRAdmin'] }, { signWith: otherKey.privateKey })}`);
  assert.equal(err.status, 401);
});

test('AUTH-4 alg=none token -> 401', async () => {
  const { err } = await run(`Bearer ${unsigned({ sub: 'u', token_use: 'id', iss: ISSUER, aud: CLIENT, exp: now() + 900, 'cognito:groups': ['HRAdmin'] })}`);
  assert.equal(err.status, 401);
});

test('AUTH-5 wrong issuer -> 401', async () => {
  const { err } = await run(`Bearer ${await token({ iss: 'https://evil.example/pool' })}`);
  assert.equal(err.status, 401);
});

test('AUTH-6 wrong audience (other app client) -> 401', async () => {
  const { err } = await run(`Bearer ${await token({ aud: 'another-client' })}`);
  assert.equal(err.status, 401);
});

test('AUTH-7 access token instead of ID token -> 401', async () => {
  const { err } = await run(`Bearer ${await token({ token_use: 'access' })}`);
  assert.equal(err.status, 401); assert.match(err.message, /Wrong token type/);
});

test('AUTH-8 expired token -> 401', async () => {
  const { err } = await run(`Bearer ${await token({}, { exp: now() - 5 })}`);
  assert.equal(err.status, 401);
});

test('MFA-1 Employee token is accepted without any MFA lookup', async () => {
  const { user, err } = await run(`Bearer ${await token({ sub: 'emp-1', 'cognito:groups': ['Employee'] })}`);
  assert.equal(err, undefined); assert.equal(user.role, 'Employee'); assert.deepEqual(lookups, []);
});

test('MFA-2 HRAdmin with TOTP enrolled keeps HR privileges', async () => {
  const { user, err } = await run(`Bearer ${await token({ sub: 'mfa-hr', 'cognito:groups': ['HRAdmin'] })}`);
  assert.equal(err, undefined); assert.equal(user.role, 'HRAdmin'); assert.equal(user.privilegesWithheld, undefined);
  assert.equal(roleCheck(user, 'HRAdmin'), undefined);
});

test('MFA-3 HRAdmin token without MFA enrolment (direct Cognito sign-in) loses HR privileges -> 403 MFA_REQUIRED', async () => {
  const { user, err } = await run(`Bearer ${await token({ sub: 'nomfa-hr', 'cognito:groups': ['HRAdmin'] })}`);
  assert.equal(err, undefined, 'still authenticated as a normal user');
  assert.equal(user.role, 'Employee'); assert.equal(user.privilegesWithheld, true); assert.deepEqual(user.groups, []);
  const e = roleCheck(user, 'HRAdmin');
  assert.equal(e.status, 403); assert.equal(e.code, 'MFA_REQUIRED');
  assert.deepEqual(lookups, ['nomfa-hr']);
});

test('MFA-4 Manager without MFA cannot use Manager routes', async () => {
  const { user } = await run(`Bearer ${await token({ sub: 'nomfa-mgr', 'cognito:groups': ['Manager'] })}`);
  const e = roleCheck(user, 'Manager', 'HRAdmin');
  assert.equal(e.status, 403); assert.equal(e.code, 'MFA_REQUIRED');
});

test('MFA-5 Cognito lookup failure fails closed (privileges withheld)', async () => {
  auth.setMfaLookup(async () => { throw Object.assign(new Error('boom'), { name: 'ServiceUnavailable' }); });
  const { user } = await run(`Bearer ${await token({ sub: 'mfa-hr2', 'cognito:groups': ['HRAdmin'] })}`);
  assert.equal(user.privilegesWithheld, true);
  assert.equal(roleCheck(user, 'HRAdmin').code, 'MFA_REQUIRED');
});

test('MFA-6 positive MFA result is cached (one Cognito call for repeated requests)', async () => {
  const t = await token({ sub: 'mfa-cache', 'cognito:groups': ['Manager'] });
  await run(`Bearer ${t}`); await run(`Bearer ${t}`);
  assert.deepEqual(lookups, ['mfa-cache']);
});

test('MFA-7 the lookup uses cognito:username, not a client-supplied value', async () => {
  await run(`Bearer ${await token({ sub: 'mfa-sub', 'cognito:username': 'mfa-username', 'cognito:groups': ['HRAdmin'] })}`);
  assert.deepEqual(lookups, ['mfa-username']);
});

test('MFA-8 gateway-verified claims path is enforced too', async () => {
  const claims = { sub: 'nomfa-gw', 'cognito:username': 'nomfa-gw', 'cognito:groups': '[HRAdmin]' };
  const { user } = await run(undefined, { requestContext: { authorizer: { jwt: { claims } } } });
  assert.equal(user.privilegesWithheld, true);
});

test('MFA-9 Employee wrong-role checks still return FORBIDDEN, not MFA_REQUIRED', async () => {
  const { user } = await run(`Bearer ${await token({ sub: 'emp-2', 'cognito:groups': ['Employee'] })}`);
  assert.equal(roleCheck(user, 'HRAdmin').code, 'FORBIDDEN');
});

test('MFA-10 REQUIRE_PRIVILEGED_MFA=false is the documented rollback switch (enforcement off)', async () => {
  process.env.REQUIRE_PRIVILEGED_MFA = 'false';
  const { user } = await run(`Bearer ${await token({ sub: 'nomfa-hr3', 'cognito:groups': ['HRAdmin'] })}`);
  assert.equal(user.role, 'HRAdmin'); assert.deepEqual(lookups, []);
});

test('MFA-11 a negative result is not reused for a newer token (user who just enrolled and signed in with MFA)', async () => {
  let enrolled = false;
  auth.setMfaLookup(async (u) => { lookups.push(u); return enrolled; });
  const before = await token({ sub: 'late-hr', jti: 'first-sign-in', 'cognito:groups': ['HRAdmin'] });
  assert.equal((await run(`Bearer ${before}`)).user.privilegesWithheld, true);
  assert.equal((await run(`Bearer ${before}`)).user.privilegesWithheld, true);
  assert.equal(lookups.length, 1, 'same token: negative result cached');
  enrolled = true;
  const later = await token({ sub: 'late-hr', jti: 'second-sign-in', 'cognito:groups': ['HRAdmin'] });
  const { user } = await run(`Bearer ${later}`);
  assert.equal(user.role, 'HRAdmin'); assert.equal(lookups.length, 2);
});
