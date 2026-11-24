// All settings come from the environment. Nothing secret lives in code.
export const cfg = {
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || undefined, // Floci locally; unset on real AWS
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
  jwksUrl: process.env.COGNITO_JWKS_URL,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  secretName: process.env.SECRET_NAME || 'leaveflow/requests',
  busName: process.env.EVENT_BUS_NAME || 'leaveflow-bus',
  balanceFn: process.env.BALANCE_PROJECTION_FN || 'balance-projection-fn',
  balanceCheck: process.env.BALANCE_CHECK !== 'off', // 'off' only for local runs before Seif's function exists
  certBucket: process.env.CERT_BUCKET || 'leaveflow-certificates',
  kmsKeyId: process.env.CERT_KMS_KEY_ID || undefined,
  // Address the browser uses for S3 links. Inside Lambda, Floci is reached differently (AWS_ENDPOINT_URL).
  s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.AWS_ENDPOINT_URL || undefined,
  holidayCountry: process.env.HOLIDAY_COUNTRY || 'EG',
  timeZone: 'Africa/Cairo',
  service: 'leave-request-service',
};

export const awsClientConfig = () => ({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}) });
