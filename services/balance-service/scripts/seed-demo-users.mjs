import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { neon } from '@neondatabase/serverless';
import { cfg, awsClientConfig } from '../src/lib/config.js';
import { getDatabaseUrl } from '../src/lib/secrets.js';
import { DEMO_USERS, resolveAll, buildPlan, applyPlan } from '../src/services/demo-seed.js';

const cognitoFile = fileURLToPath(new URL('../../leave-request-service/deploy/cognito-outputs.json', import.meta.url));
if (!process.env.COGNITO_USER_POOL_ID && existsSync(cognitoFile)) {
  const c = JSON.parse(readFileSync(cognitoFile, 'utf8').replace(/^﻿/, ''));
  process.env.COGNITO_USER_POOL_ID = c.userPoolId;
}
if (!process.env.COGNITO_USER_POOL_ID) {
  console.error('Cognito pool id missing. Run deploy-cognito.ps1 or set COGNITO_USER_POOL_ID locally.');
  process.exit(2);
}
if (!process.env.DATABASE_URL && !process.env.SECRET_NAME) {
  console.error('Database configuration missing. Set DATABASE_URL locally or SECRET_NAME for Secrets Manager.');
  process.exit(2);
}

const apply = process.argv.includes('--apply');
const cognito = new CognitoIdentityProviderClient(awsClientConfig());
const listUsers = (args) => cognito.send(new ListUsersCommand(args));

try {
  const resolved = await resolveAll(listUsers, process.env.COGNITO_USER_POOL_ID || cfg.userPoolId);
  const plan = buildPlan(resolved);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Demo users resolved: ${resolved.length} (expected ${DEMO_USERS.length})`);
  for (const { user } of resolved) console.log(`  ${user.email} -> sub resolved`);
  console.log(`Planned ledger entries: ${plan.length} (expected ${DEMO_USERS.length * 2})`);
  for (const e of plan) {
    console.log(`  ${e.leaveType} ${e.amount} | kind=${e.kind} | reason="${e.reason}" | created_by=${e.createdBy}`);
  }

  if (!apply) {
    console.log('Dry run only: no database writes were performed. Re-run with --apply to seed.');
    process.exit(0);
  }

  const sql = neon(await getDatabaseUrl());
  const inserted = await applyPlan(sql, plan);
  console.log(`Seed complete: ${inserted} entries inserted, ${plan.length - inserted} already present (idempotent no-ops).`);
} catch (err) {
  console.error(`Seed aborted: ${err?.code || 'ERROR'} - ${err?.message || 'unknown failure'}. No further writes were attempted.`);
  process.exit(1);
}
