// Reads the database URL: from .env when running locally, from Secrets Manager in Lambda.
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { cfg, awsClientConfig } from './config.js';

let cached;
export async function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (cached) return cached;
  const sm = new SecretsManagerClient(awsClientConfig());
  const res = await sm.send(new GetSecretValueCommand({ SecretId: cfg.secretName }));
  cached = JSON.parse(res.SecretString).databaseUrl;
  return cached;
}
