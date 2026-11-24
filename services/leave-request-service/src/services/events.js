// Publishes our events to the shared EventBridge bus. Ammar's rules route them.
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'node:crypto';
import { awsClientConfig, cfg } from '../lib/config.js';
import { log } from '../lib/log.js';

const eb = new EventBridgeClient(awsClientConfig());
export const SOURCE = 'leaveflow.requests';

export async function publish(detailType, detail) {
  const eventId = randomUUID();
  const out = await eb.send(new PutEventsCommand({
    Entries: [{ EventBusName: cfg.busName, Source: SOURCE, DetailType: detailType, Detail: JSON.stringify({ eventId, ...detail }) }],
  }));
  if (out.FailedEntryCount) throw new Error(`PutEvents failed: ${out.Entries?.[0]?.ErrorCode}`);
  log('info', 'EVENT_PUBLISHED', { detailType, eventId, requestId: detail.requestId });
  return eventId;
}

// Audit events must never break the user's action; failures are only logged.
export async function audit(actor, action, requestId, extra = {}) {
  try {
    await publish('audit', { actor, action, requestId, service: cfg.service, at: new Date().toISOString(), ...extra });
  } catch (err) {
    log('error', 'AUDIT_PUBLISH_FAILED', { action, requestId, message: err.message });
  }
}
