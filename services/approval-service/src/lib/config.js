// All settings come from the environment. Nothing secret lives in code.
export const cfg = {
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL || undefined, // Floci locally; unset on real AWS
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_CLIENT_ID,
  issuer: process.env.COGNITO_ISSUER,
  jwksUrl: process.env.COGNITO_JWKS_URL,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  secretName: process.env.SECRET_NAME || 'leaveflow/approvals',
  busName: process.env.EVENT_BUS_NAME || 'leaveflow-bus',
  topicArn: process.env.NOTIFY_TOPIC_ARN || undefined,
  stateMachineArn: process.env.ESCALATION_STATE_MACHINE_ARN || undefined,
  demoMode: process.env.DEMO_MODE === 'true',
  // Policy numbers agreed by the team (Final Phase Plan, section 1).
  escalateAfterSeconds: process.env.DEMO_MODE === 'true' ? 120 : 48 * 3600,
  hrOverDays: 5,          // more than 5 working days needs HR as a second step
  coverageBlockPct: 30,   // block a manager's approval above 30% of the team off
  coverageWarnPct: 20,    // warn above 20%
  service: 'approval-service',
};

export const awsClientConfig = () => ({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}) });
