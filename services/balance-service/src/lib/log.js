import { cfg } from './config.js';

const SECRET_PATTERNS = [
  [/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgres://<redacted>'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '<redacted-jwt>'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer <redacted>'],
  [/npg_[A-Za-z0-9]{8,}/g, '<redacted>'],
  [/AKIA[0-9A-Z]{16}/g, '<redacted-aws-key>'],
];
export const redact = (text) => SECRET_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text);

export function log(level, event, fields = {}) {
  const line = { time: new Date().toISOString(), level, service: cfg.service, event, ...fields };
  (level === 'error' ? console.error : console.log)(redact(JSON.stringify(line)));
}
