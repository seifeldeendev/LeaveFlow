import express from 'express';
import { cfg } from './lib/config.js';
import { errorHandler, notFound, HttpError } from './lib/errors.js';
import approvalRoutes from './routes/approvals.js';
import notificationRoutes from './routes/notifications.js';
import calendarRoutes from './routes/calendar.js';

const app = express();
app.disable('x-powered-by');

// CORS: only our frontend may call this API from a browser.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', cfg.corsOrigin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Bodies must be JSON and small.
app.use((req, _res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] && req.headers['content-length'] !== '0' && !req.is('application/json')) {
    return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with Content-Type: application/json'));
  }
  next();
});
app.use(express.json({ limit: '10kb' }));
// Behind API Gateway, serverless-http hands Express the body as raw bytes (a Buffer), so express.json()
// skips it. Turn those bytes, or the raw API Gateway event body, into JSON here (same 10 KB limit).
app.use((req, _res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  let text = null;
  if (Buffer.isBuffer(req.body)) text = req.body.toString('utf8');
  else if ((!req.body || Object.keys(req.body).length === 0) && req.lambdaEvent?.body) {
    text = req.lambdaEvent.isBase64Encoded ? Buffer.from(req.lambdaEvent.body, 'base64').toString('utf8') : String(req.lambdaEvent.body);
  }
  if (text === null) return next();
  if (text.length > 10 * 1024) return next(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large'));
  try {
    req.body = text.trim() ? JSON.parse(text) : {};
    next();
  } catch {
    next(new HttpError(400, 'INVALID_JSON', 'Body is not valid JSON'));
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: cfg.service }));
app.use('/approvals', approvalRoutes);
app.use('/notifications', notificationRoutes);
app.use('/team-calendar', calendarRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
