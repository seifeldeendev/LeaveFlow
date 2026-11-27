import serverless from 'serverless-http';
import app from './app.js';
import { parseLambdaBody } from './lib/lambda-body.js';
import { handleEvent } from './events/consumer.js';

const http = serverless(app, { request(req, event) { req.lambdaEvent = event; parseLambdaBody(req); } });

// One Lambda, two doors: API Gateway calls (HTTP) and EventBridge events from the approval service.
export const handler = async (event, context) => {
  if (event?.source && event['detail-type']) return handleEvent(event);
  return http(event, context);
};
