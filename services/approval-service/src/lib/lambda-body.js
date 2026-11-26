// serverless-http + Express 5: inside Lambda the request already looks "finished", so Express 5's
// body parser skips it and every POST/PATCH body would arrive empty. We parse the JSON body here,
// at the Lambda entry, with the same rules as express.json: JSON only, 10 KB max, bad JSON -> 400.
const LIMIT = 10 * 1024;

export function parseLambdaBody(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body : null;
  req.body = undefined;
  if (!raw || raw.length === 0) return;
  if (raw.length > LIMIT) { req.bodyError = 'too_large'; return; }
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return; // app.js answers 415
  try { req.body = JSON.parse(raw.toString('utf8')); } catch { req.bodyError = 'bad_json'; }
}

// Express middleware: turns the flags above into the usual error responses.
export function lambdaBodyErrors(req, _res, next) {
  if (req.bodyError === 'too_large') return next(Object.assign(new Error('too large'), { type: 'entity.too.large' }));
  if (req.bodyError === 'bad_json') return next(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' }));
  next();
}
