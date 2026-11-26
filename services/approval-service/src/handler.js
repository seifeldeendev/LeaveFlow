import serverless from 'serverless-http';
import app from './app.js';
import { parseLambdaBody } from './lib/lambda-body.js';
import { handleEvent } from './events/consumer.js';
import { escalateStep } from './services/workflow.js';

const http = serverless(app, { request(req, event) { req.lambdaEvent = event; parseLambdaBody(req); } });

// One Lambda, three doors:
//  1. EventBridge events from the requests service (request.submitted, request.cancelled)
//  2. The Step Functions escalation timer ({ action: 'escalate', stepId })
//  3. API Gateway HTTP calls
export const handler = async (event, context) => {
  if (event?.source && event['detail-type']) return handleEvent(event);
  if (event?.action === 'escalate') return escalateStep(event.stepId);
  return http(event, context);
};
