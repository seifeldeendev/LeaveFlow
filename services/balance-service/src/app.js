import express from 'express';
import { lambdaBodyErrors } from './lib/lambda-body.js';
import { cfg } from './lib/config.js';
import { errorHandler, notFound, HttpError } from './lib/errors.js';
import employeeBalances from './routes/employee-balances.js';
import hrBalances from './routes/hr-balances.js';
import accrualRuns from './routes/accrual-runs.js';
import { db } from './lib/db.js';

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.set('Access-Control-Allow-Origin', origin && cfg.corsOrigins.includes(origin) ? origin : cfg.corsOrigins[0]);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use((req, _res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0' && !req.is('application/json')) {
    return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with Content-Type: application/json'));
  }
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(lambdaBodyErrors);

app.get('/health', async (_req, res) => {
  try {
    const sql = await db();
    await sql`SELECT 1`;
    res.json({ status: 'ok', service: cfg.service, database: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', service: cfg.service, database: 'unavailable' });
  }
});

app.use('/balances/me', employeeBalances);
app.use('/balances', hrBalances);
app.use('/accrual-runs', accrualRuns);

app.use(notFound);
app.use(errorHandler);

export default app;
