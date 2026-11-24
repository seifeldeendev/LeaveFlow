// Login, MFA, refresh and logout. Passwords are checked by Cognito; we never store them.
import { Router } from 'express';
import {
  CognitoIdentityProviderClient, InitiateAuthCommand, RespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand, VerifySoftwareTokenCommand, SetUserMFAPreferenceCommand,
  GetUserCommand, GlobalSignOutCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { decodeJwt } from 'jose';
import { cfg, awsClientConfig } from '../lib/config.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/log.js';
import { requireAuth, toUser } from '../lib/auth.js';

const router = Router();
const cognito = new CognitoIdentityProviderClient(awsClientConfig());
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const PRIVILEGED = ['Manager', 'HRAdmin'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

function requireFields(body, fields) {
  const missing = fields.filter((f) => typeof body?.[f] !== 'string' || body[f].trim() === '');
  if (missing.length) throw new HttpError(400, 'VALIDATION_ERROR', `Missing or invalid: ${missing.join(', ')}`);
}

// Tokens plus the user's profile (read from the ID token Cognito just issued) for the frontend session.
const tokensOut = (r) => {
  const { groups, department, ...user } = toUser(decodeJwt(r.IdToken));
  return { idToken: r.IdToken, accessToken: r.AccessToken, refreshToken: r.RefreshToken, expiresIn: r.ExpiresIn, user, role: user.role, mfaRequired: false };
};

async function recordFailure(sql, email, ip) {
  const [row] = await sql`
    INSERT INTO login_attempts (email, failed_count, last_failed_at)
    VALUES (${email}, 1, now())
    ON CONFLICT (email) DO UPDATE SET failed_count = login_attempts.failed_count + 1, last_failed_at = now()
    RETURNING failed_count`;
  if (row.failed_count >= MAX_FAILURES) {
    await sql`UPDATE login_attempts SET locked_until = now() + make_interval(mins => ${LOCK_MINUTES}), failed_count = 0 WHERE email = ${email}`;
    log('warn', 'ACCOUNT_LOCKED', { email, ip });
  }
}

// POST /auth/login  { email, password }
router.post('/login', async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const email = req.body.email.trim().toLowerCase();
  if (!EMAIL.test(email) || req.body.password.length > 256) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid email or password format');
  const sql = await db();

  const [lock] = await sql`SELECT locked_until FROM login_attempts WHERE email = ${email} AND locked_until > now()`;
  if (lock) {
    log('warn', 'LOGIN_BLOCKED_LOCKED', { email, ip: req.ip });
    throw new HttpError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`);
  }

  let result;
  try {
    result = await cognito.send(new InitiateAuthCommand({
      ClientId: cfg.clientId, AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: req.body.password },
    }));
  } catch (err) {
    if (['NotAuthorizedException', 'UserNotFoundException'].includes(err.name)) {
      await recordFailure(sql, email, req.ip);
      log('warn', 'LOGIN_FAILED', { email, ip: req.ip });
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'); // same message for both cases
    }
    throw err;
  }
  await sql`DELETE FROM login_attempts WHERE email = ${email}`;

  if (result.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
    return res.json({ mfaRequired: true, session: result.Session });
  }

  const r = result.AuthenticationResult;
  const groups = decodeJwt(r.IdToken)['cognito:groups'] || [];
  if (groups.some((g) => PRIVILEGED.includes(g))) {
    // Managers and HR must set up MFA before they get a usable ID token.
    const me = await cognito.send(new GetUserCommand({ AccessToken: r.AccessToken }));
    if (!(me.UserMFASettingList || []).includes('SOFTWARE_TOKEN_MFA')) {
      log('info', 'MFA_SETUP_REQUIRED', { email });
      return res.json({ mfaSetupRequired: true, accessToken: r.AccessToken });
    }
  }
  log('info', 'LOGIN_SUCCESS', { email });
  return res.json(tokensOut(r));
});

// POST /auth/mfa  { email, session, code }  (second step for Manager / HR)
router.post('/mfa', async (req, res) => {
  requireFields(req.body, ['email', 'session', 'code']);
  if (!/^\d{6}$/.test(req.body.code)) throw new HttpError(400, 'VALIDATION_ERROR', 'Code must be 6 digits');
  try {
    const out = await cognito.send(new RespondToAuthChallengeCommand({
      ClientId: cfg.clientId, ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: req.body.session,
      ChallengeResponses: { USERNAME: req.body.email.trim().toLowerCase(), SOFTWARE_TOKEN_MFA_CODE: req.body.code },
    }));
    log('info', 'LOGIN_SUCCESS_MFA', { email: req.body.email });
    return res.json(tokensOut(out.AuthenticationResult));
  } catch (err) {
    log('warn', 'MFA_FAILED', { email: req.body.email, ip: req.ip });
    throw new HttpError(401, 'MFA_FAILED', 'The code is wrong or expired');
  }
});

// POST /auth/mfa/setup  { accessToken }  -> secret to add to an authenticator app
router.post('/mfa/setup', async (req, res) => {
  requireFields(req.body, ['accessToken']);
  const out = await cognito.send(new AssociateSoftwareTokenCommand({ AccessToken: req.body.accessToken }));
  const me = await cognito.send(new GetUserCommand({ AccessToken: req.body.accessToken }));
  const label = encodeURIComponent(`LeaveFlow:${me.Username}`);
  return res.json({ secretCode: out.SecretCode, otpauthUrl: `otpauth://totp/${label}?secret=${out.SecretCode}&issuer=LeaveFlow` });
});

// POST /auth/mfa/verify  { accessToken, code }  -> turns MFA on; then log in again
router.post('/mfa/verify', async (req, res) => {
  requireFields(req.body, ['accessToken', 'code']);
  if (!/^\d{6}$/.test(req.body.code)) throw new HttpError(400, 'VALIDATION_ERROR', 'Code must be 6 digits');
  const v = await cognito.send(new VerifySoftwareTokenCommand({ AccessToken: req.body.accessToken, UserCode: req.body.code }));
  if (v.Status !== 'SUCCESS') throw new HttpError(400, 'MFA_FAILED', 'Code not accepted');
  await cognito.send(new SetUserMFAPreferenceCommand({
    AccessToken: req.body.accessToken, SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
  }));
  log('info', 'MFA_ENABLED');
  return res.json({ ok: true, message: 'MFA is on. Please log in again.' });
});

// POST /auth/refresh  { refreshToken }
router.post('/refresh', async (req, res) => {
  requireFields(req.body, ['refreshToken']);
  try {
    const out = await cognito.send(new InitiateAuthCommand({
      ClientId: cfg.clientId, AuthFlow: 'REFRESH_TOKEN_AUTH', AuthParameters: { REFRESH_TOKEN: req.body.refreshToken },
    }));
    return res.json(tokensOut(out.AuthenticationResult));
  } catch {
    throw new HttpError(401, 'SESSION_EXPIRED', 'Please log in again');
  }
});

// POST /auth/logout  { accessToken }  -> revokes all refresh tokens for this user
router.post('/logout', async (req, res) => {
  requireFields(req.body, ['accessToken']);
  try { await cognito.send(new GlobalSignOutCommand({ AccessToken: req.body.accessToken })); } catch { /* already signed out */ }
  log('info', 'LOGOUT');
  return res.status(204).end();
});

// GET /auth/me  (protected)
export const meHandler = (req, res) => { const { groups, department, ...user } = req.user; res.json(user); };
router.get('/me', requireAuth, meHandler);

export default router;
