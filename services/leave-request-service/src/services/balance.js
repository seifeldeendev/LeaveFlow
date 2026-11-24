// Asks Seif's balance-projection-fn how many days are left after pending requests.
// Direct Lambda invoke, allowed by IAM only for our role; there is no public route for it.
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { awsClientConfig, cfg } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/log.js';

const lambda = new LambdaClient(awsClientConfig());

// Contract with Seif: input { employeeId, leaveType }  ->  output { available: number }
export async function projectedBalance(employeeId, leaveType) {
  if (!cfg.balanceCheck) {
    log('warn', 'BALANCE_CHECK_SKIPPED', { reason: 'BALANCE_CHECK=off (local only)' });
    return null;
  }
  try {
    const out = await lambda.send(new InvokeCommand({
      FunctionName: cfg.balanceFn,
      Payload: Buffer.from(JSON.stringify({ employeeId, leaveType })),
    }));
    if (out.FunctionError) throw new Error(`balance function error: ${out.FunctionError}`);
    const body = JSON.parse(Buffer.from(out.Payload).toString('utf8'));
    if (typeof body?.available !== 'number') throw new Error('balance function returned no "available" number');
    return body.available;
  } catch (err) {
    // Fail closed: without a balance answer we do not accept the request.
    log('error', 'BALANCE_UNAVAILABLE', { message: err.message });
    throw new HttpError(503, 'BALANCE_UNAVAILABLE', 'Leave balance could not be checked. Try again shortly.');
  }
}
