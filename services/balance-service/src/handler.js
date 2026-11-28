import serverless from 'serverless-http';
import app from './app.js';
import { parseLambdaBody } from './lib/lambda-body.js';
import { handleQueue } from './events/consumer.js';
import { handleAuditQueue } from './events/audit-consumer.js';
import { projection } from './services/projection.js';
import { log } from './lib/log.js';

const http = serverless(app, { request(req, event) { req.lambdaEvent = event; parseLambdaBody(req); } });

const isAuditArn = (arn) => typeof arn === 'string' && arn.endsWith(':audit-inbox');

export const handler = async (event, context) => {
  if (Array.isArray(event?.Records) && event.Records[0]?.eventSource === 'aws:sqs') {
    const records = event.Records;
    const audit = records.filter((r) => isAuditArn(r.eventSourceARN));
    const balances = records.filter((r) => !isAuditArn(r.eventSourceARN));
    const results = {};
    if (balances.length) { const r = await handleQueue({ Records: balances }); Object.assign(results, { balances: r }); }
    if (audit.length) { const r = await handleAuditQueue({ Records: audit }); Object.assign(results, { audit: r }); }
    return results;
  }
  if (event && Object.prototype.hasOwnProperty.call(event, 'employeeId')
      && Object.prototype.hasOwnProperty.call(event, 'leaveType')) {
    log('info', 'PROJECTION_INVOKE', { leaveType: event.leaveType });
    return projection(event);
  }
  if (event?.source && event['detail-type']) {
    const { handleEvent } = await import('./events/consumer.js');
    const { handleAuditEvent } = await import('./events/audit-consumer.js');
    return event['detail-type'] === 'audit' ? handleAuditEvent(event) : handleEvent(event);
  }
  return http(event, context);
};
