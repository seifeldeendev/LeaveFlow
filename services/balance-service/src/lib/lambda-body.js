const LIMIT = 10 * 1024;

export function parseLambdaBody(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body : null;
  req.body = undefined;
  if (!raw || raw.length === 0) return;
  if (raw.length > LIMIT) { req.bodyError = 'too_large'; return; }
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return;
  try { req.body = JSON.parse(raw.toString('utf8')); } catch { req.bodyError = 'bad_json'; }
}

export function lambdaBodyErrors(req, _res, next) {
  if (req.bodyError === 'too_large') return next(Object.assign(new Error('too large'), { type: 'entity.too.large' }));
  if (req.bodyError === 'bad_json') return next(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' }));
  next();
}
