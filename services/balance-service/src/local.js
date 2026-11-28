import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cognitoFile = fileURLToPath(new URL('../../leave-request-service/deploy/cognito-outputs.json', import.meta.url));
if (!process.env.COGNITO_USER_POOL_ID && existsSync(cognitoFile)) {
  const c = JSON.parse(readFileSync(cognitoFile, 'utf8').replace(/^﻿/, ''));
  const endpoint = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
  process.env.COGNITO_USER_POOL_ID = c.userPoolId;
  process.env.COGNITO_CLIENT_ID = c.clientId;
  process.env.COGNITO_ISSUER ||= `${endpoint}/${c.userPoolId}`;
  process.env.COGNITO_JWKS_URL ||= `${endpoint}/${c.userPoolId}/.well-known/jwks.json`;
}
if (!process.env.COGNITO_USER_POOL_ID) {
  console.error('Cognito settings missing. Run services/leave-request-service/deploy/deploy-cognito.ps1 first.');
  process.exit(1);
}

const { default: app } = await import('./app.js');
const port = Number(process.env.PORT) || 3003;
app.listen(port, (err) => {
  if (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${port} is already in use - another copy of the server is still running.`
      : `Server could not start: ${err.message}`);
    process.exit(1);
  }
  console.log(`balance-service on http://localhost:${port}`);
});
