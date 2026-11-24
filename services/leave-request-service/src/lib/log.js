// One JSON line per event, read by CloudWatch Logs. Never pass passwords, tokens or leave reasons here.
import { cfg } from './config.js';

export function log(level, event, fields = {}) {
  const line = { time: new Date().toISOString(), level, service: cfg.service, event, ...fields };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}
