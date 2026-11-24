import { log } from './log.js';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (req, res) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });

// Same error shape everywhere; never leak stack traces.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) {
      log('warn', 'ACCESS_DENIED', { path: req.path, status: err.status, userId: req.user?.id, code: err.code });
    }
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  }
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Body is not valid JSON' } });
  log('error', 'UNHANDLED_ERROR', { path: req.path, name: err?.name, message: err?.message, cause: err?.cause?.message });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}
