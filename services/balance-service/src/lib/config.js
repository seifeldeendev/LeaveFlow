export const cfg = {
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || undefined,
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
  jwksUrl: process.env.COGNITO_JWKS_URL,
  corsOrigins: String(process.env.CORS_ORIGIN || 'http://localhost:8080').split(',').map((o) => o.trim()).filter(Boolean),
  secretName: process.env.SECRET_NAME || 'leaveflow/balances',
  busName: process.env.EVENT_BUS_NAME || 'leaveflow-bus',
  inboxUrl: process.env.BALANCE_INBOX_URL,
  service: 'balance-service',
};

export const awsClientConfig = () => ({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}) });
