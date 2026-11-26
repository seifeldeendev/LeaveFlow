import express from 'express';
import { lambdaBodyErrors } from './lib/lambda-body.js';
import { cfg } from './lib/config.js';
import { errorHandler, notFound, HttpError } from './lib/errors.js';
import authRoutes, { meHandler } from './routes/auth.js';
import requestRoutes, { workingDaysPreview } from './routes/requests.js';
import { requireAuth } from './lib/auth.js';

const app = express();
app.disable('x-powered-by');

// CORS: only our frontend may call this API from a browser.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', cfg.corsOrigin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Bodies must be JSON and small.
app.use((req, _res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0' && !req.is('application/json')) {
    return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with Content-Type: application/json'));
  }
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(lambdaBodyErrors); // body errors found at the Lambda entry (see lib/lambda-body.js)

app.get('/health', (_req, res) => res.json({ status: 'ok', service: cfg.service }));
app.use('/auth', authRoutes);
app.use('/leave-requests', requestRoutes);
app.get('/working-days', requireAuth, workingDaysPreview);
app.get('/me', requireAuth, meHandler); // profile for the frontend shell

app.use(notFound);
app.use(errorHandler);

export default app;
