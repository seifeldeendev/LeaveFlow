// Notifications: every message goes to the SNS topic leaveflow-notifications (for any subscriber,
// e.g. email) and into the in-app inbox table that the unread bell reads.
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { awsClientConfig, cfg } from '../lib/config.js';
import { db } from '../lib/db.js';
import { log } from '../lib/log.js';

const sns = new SNSClient(awsClientConfig());
const clip = (s, n) => String(s ?? '').slice(0, n);

export async function notify(userIds, title, body, link) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length) return;
  const sql = await db();
  for (const userId of ids) {
    await sql`INSERT INTO notifications (user_id, title, body, link)
              VALUES (${userId}, ${clip(title, 120)}, ${clip(body, 500)}, ${clip(link, 300) || null})`;
  }
  if (!cfg.topicArn) return;
  try {
    await sns.send(new PublishCommand({
      TopicArn: cfg.topicArn,
      Subject: clip(title, 100),
      Message: JSON.stringify({ userIds: ids, title, body, link }),
      MessageAttributes: { kind: { DataType: 'String', StringValue: 'inbox' } },
    }));
  } catch (err) {
    // The inbox row is already saved, so the user still sees it; only the topic copy failed.
    log('error', 'NOTIFY_PUBLISH_FAILED', { message: err.message });
  }
}
