import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { cfg, awsClientConfig } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';

const PATHS = {
  annualMonthlyAccrual: '/leaveflow/balances/annual-monthly-accrual',
  carryoverCap: '/leaveflow/balances/carryover-cap',
  casualYearly: '/leaveflow/balances/casual-yearly',
};

let cached;
let injected;

export function setPolicyLoader(fn) { injected = fn; }
export function resetPolicyCache() { cached = undefined; }

function parseNumber(name, raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new HttpError(500, 'POLICY_INVALID', `${name} is missing or not numeric.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 60) {
    throw new HttpError(500, 'POLICY_INVALID', `${name} is outside the valid range 0..60.`);
  }
  return value;
}

async function readParameter(client, path) {
  if (injected) {
    const value = await injected(path);
    if (value === undefined || value === null) {
      throw new HttpError(500, 'POLICY_MISSING', `Required policy parameter is missing: ${path}`);
    }
    return value;
  }
  const out = await client.send(new GetParameterCommand({ Name: path, WithDecryption: false }));
  const value = out?.Parameter?.Value;
  if (value === undefined || value === null || value === '') {
    throw new HttpError(500, 'POLICY_MISSING', `Required policy parameter is missing: ${path}`);
  }
  return value;
}

export async function loadPolicy() {
  if (cached) return cached;
  try {
    const client = injected ? null : new SSMClient(awsClientConfig());
    const [accrual, cap, casual] = await Promise.all([
      readParameter(client, PATHS.annualMonthlyAccrual),
      readParameter(client, PATHS.carryoverCap),
      readParameter(client, PATHS.casualYearly),
    ]);
    cached = Object.freeze({
      annualMonthlyAccrual: parseNumber('annual-monthly-accrual', accrual),
      carryoverCap: parseNumber('carryover-cap', cap),
      casualYearly: parseNumber('casual-yearly', casual),
    });
    return cached;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, 'POLICY_UNAVAILABLE', 'Balance policy could not be loaded. Try again shortly.');
  }
}

export async function annualAccrualRate() {
  return (await loadPolicy()).annualMonthlyAccrual;
}

export const POLICY_PATHS = PATHS;
