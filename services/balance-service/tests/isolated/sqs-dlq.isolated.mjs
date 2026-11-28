process.env.NODE_ENV = 'test';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, DeleteQueueCommand } from '@aws-sdk/client-sqs';

const endpoint = process.env.AWS_ENDPOINT_URL || '';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(endpoint)) { console.error('Refusing to run: AWS_ENDPOINT_URL must be a localhost Floci endpoint.'); process.exit(2); }
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1', endpoint });
const { setTestSql } = await import('../../src/lib/db.js');
const { setHoldsRepository } = await import('../../src/services/holds-repository.js');
const { createFakeSql, createTestHoldsRepository } = await import('../fake-sql.mjs');
const { handler } = await import('../../src/handler.js');
const sql = createFakeSql({}); setTestSql(sql); setHoldsRepository(createTestHoldsRepository(sql));

const tag = randomBytes(3).toString('hex');
const results = []; const urls = [];
const rec = (id, step, expected, actual, pass) => { results.push({ id, step, expected, actual, result: pass ? 'PASS' : 'FAIL' }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${step} -> ${actual}`); };
const attr = async (url, names) => (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: names }))).Attributes;
try {
  const dlqUrl = (await sqs.send(new CreateQueueCommand({ QueueName: `lf-sectest-dlq-${tag}` }))).QueueUrl; urls.push(dlqUrl);
  const dlqArn = (await attr(dlqUrl, ['QueueArn'])).QueueArn;
  const inUrl = (await sqs.send(new CreateQueueCommand({ QueueName: `lf-sectest-inbox-${tag}`, Attributes: {
    VisibilityTimeout: '1', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: '5' }) } }))).QueueUrl; urls.push(inUrl);
  const inArn = (await attr(inUrl, ['QueueArn'])).QueueArn;
  rec('ST-12-1', 'disposable queues with balances-inbox redrive shape', 'maxReceiveCount=5 to DLQ', (await attr(inUrl, ['RedrivePolicy'])).RedrivePolicy, true);

  await sqs.send(new SendMessageCommand({ QueueUrl: inUrl, MessageBody: '{not json' }));
  await sqs.send(new SendMessageCommand({ QueueUrl: inUrl, MessageBody: JSON.stringify({ id: randomUUID(), source: 'evil.source', 'detail-type': 'request.approved', detail: { eventId: randomUUID(), requestId: randomUUID() } }) }));

  const handlerOutcomes = new Map(); let receives = 0;
  for (let round = 0; round < 12; round++) {
    const out = await sqs.send(new ReceiveMessageCommand({ QueueUrl: inUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, AttributeNames: ['ApproximateReceiveCount'] }));
    for (const m of out.Messages || []) {
      receives++;
      const event = { Records: [{ eventSource: 'aws:sqs', eventSourceARN: inArn, messageId: m.MessageId, body: m.Body }] };
      let outcome;
      try { await handler(event, {}); outcome = 'handler returned (would be deleted)'; await sqs.send(new DeleteMessageCommand({ QueueUrl: inUrl, ReceiptHandle: m.ReceiptHandle })); } catch (err) { outcome = `handler threw (${err.message.slice(0, 60)}) - not deleted, SQS will retry`; }
      handlerOutcomes.set(m.Body.slice(0, 12), outcome);
    }
    await new Promise((r) => setTimeout(r, 1300));
  }
  for (const [body, outcome] of handlerOutcomes) rec('ST-12-2', `real balance handler on poison message "${body}..."`, 'throws (batch not acknowledged)', outcome, outcome.startsWith('handler threw'));
  const inDepth = Number((await attr(inUrl, ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'])).ApproximateNumberOfMessages);
  const dlqDepth = Number((await attr(dlqUrl, ['ApproximateNumberOfMessages'])).ApproximateNumberOfMessages);
  rec('ST-12-3', `after ${receives} receives: source queue depth`, '0', String(inDepth), inDepth === 0);
  rec('ST-12-4', 'DLQ depth (both poison messages dead-lettered)', '2', String(dlqDepth), dlqDepth === 2);
  const d = sql.__db; const counts = { ledger: d.ledger_entries.length, holds: d.pending_holds.length, processed: d.processed_events.length, audit: (d.audit_log || []).length };
  rec('ST-12-5', 'rows written by the failed messages (in-memory double)', 'all 0', JSON.stringify(counts), Object.values(counts).every((n) => n === 0));
} catch (err) {
  rec('ST-12-ERR', 'harness', 'no error', `${err.name}: ${err.message}`, false);
} finally {
  for (const u of urls) { if (/lf-sectest-/.test(u)) { try { await sqs.send(new DeleteQueueCommand({ QueueUrl: u })); } catch {              } } }
  console.log(`deleted disposable queues: ${urls.length}`);
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ executedAt: new Date().toISOString(), environment: `Floci ${endpoint} (disposable queues lf-sectest-*-${tag}, deleted)`, results }, null, 2));
}
