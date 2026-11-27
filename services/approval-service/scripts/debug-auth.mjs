// Diagnoses a 401 with a valid login: prints what is inside the token (no secrets), the exact API answer,
// whether the token verifies locally, the latest Lambda log lines, and whether events reached the database.
// Usage: node scripts/debug-auth.mjs
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { neon } from '@neondatabase/serverless';

const aws = { region: 'us-east-1', endpoint: 'http://localhost:4566', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };
const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/^﻿/, ''));
const cog = readJson('../../leave-request-service/deploy/cognito-outputs.json');
const API = readJson('../deploy/approvals-outputs.json').apiUrl.replace(/\/$/, '');

let password = process.env.LEAVEFLOW_TEST_PASSWORD;
if (!password) { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); password = await rl.question('Test users password: '); rl.close(); process.stdout.write('\x1b[1A\x1b[2K'); }

const out = await new CognitoIdentityProviderClient(aws).send(new InitiateAuthCommand({
  AuthFlow: 'USER_PASSWORD_AUTH', ClientId: cog.clientId, AuthParameters: { USERNAME: 'sara.manager@leaveflow.test', PASSWORD: password } }));
const token = out.AuthenticationResult.IdToken;
const [h, p] = token.split('.').slice(0, 2).map((x) => JSON.parse(Buffer.from(x, 'base64url').toString()));
console.log('1) Token header:', JSON.stringify(h));
console.log('   Token claims:', JSON.stringify({ iss: p.iss, aud: p.aud, client_id: p.client_id, token_use: p.token_use, groups: p['cognito:groups'], exp: new Date(p.exp * 1000).toISOString() }));
console.log('   Expected iss: http://localhost:4566/' + cog.userPoolId + '   aud: ' + cog.clientId);

const res = await fetch(API + '/approvals', { headers: { Authorization: `Bearer ${token}` } });
console.log('\n2) GET /approvals ->', res.status, (await res.text()).slice(0, 300));
console.log('   (a body like {"error":{"code":"UNAUTHENTICATED"...}} comes from our Lambda; {"message":"Unauthorized"} comes from API Gateway)');

try {
  const jwks = createRemoteJWKSet(new URL(`http://localhost:4566/${cog.userPoolId}/.well-known/jwks.json`));
  await jwtVerify(token, jwks, { issuer: `http://localhost:4566/${cog.userPoolId}`, audience: cog.clientId });
  console.log('\n3) Token verifies locally with issuer + audience: YES');
} catch (e) { console.log('\n3) Token verifies locally: NO ->', e.code || e.name, e.message); }

try {
  const logs = await new CloudWatchLogsClient(aws).send(new FilterLogEventsCommand({ logGroupName: '/aws/lambda/approvals-fn', limit: 50, startTime: Date.now() - 30 * 60_000 }));
  const lines = (logs.events || []).map((e) => e.message.trim()).filter((m) => m.startsWith('{')).slice(-12);
  console.log('\n4) Last approvals-fn log lines (30 min):'); lines.forEach((l) => console.log('   ' + l.slice(0, 220)));
  if (!lines.length) console.log('   (none)');
} catch (e) { console.log('\n4) Could not read logs:', e.message); }

const sql = neon(process.env.DATABASE_URL);
const rows = await sql.query(`select count(*)::int as n from approval_tasks where created_at > now() - interval '30 minutes'`);
console.log('\n5) Requests that reached the database in the last 30 min:', rows[0].n);
