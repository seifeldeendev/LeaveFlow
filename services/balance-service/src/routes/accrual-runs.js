import { Router } from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import { HttpError } from '../lib/errors.js';
import { db } from '../lib/db.js';
import { allUsers } from '../lib/directory.js';
import { listRuns, runAccrual, runDetails } from '../services/accrual.js';
import { isMonth } from '../services/ledger.js';
import { projection } from '../services/projection.js';
import { runCasualGrant, runYearEnd } from '../services/yearly.js';

const router = Router();
router.use(requireAuth, requireRole('HRAdmin'));

router.get('/', async (req, res) => res.json(await listRuns(req)));

router.post('/casual-grant', async (req, res) => {
  const year = String(req.body?.year || new Date().getUTCFullYear());
  res.status(201).json(await runCasualGrant({ year, actor: req.user, directory: allUsers }));
});
router.post('/year-end', async (req, res) => {
  const year = String(req.body?.year || new Date().getUTCFullYear());
  res.status(201).json(await runYearEnd({ year, actor: req.user, directory: allUsers }));
});

router.get('/:month/details', async (req, res) => res.json(await runDetails(req)));

router.post('/', async (req, res) => {
  const month = String(req.body?.month || new Date().toISOString().slice(0, 7));
  if (!isMonth(month)) throw new HttpError(400, 'BAD_MONTH', 'Provide a month as YYYY-MM.');
  const run = await runAccrual({ month, actor: req.user, directory: allUsers });
  res.status(201).json(run);
});

router.post('/projection', async (req, res) => {
  res.json(await projection(req.body || {}));
});

export default router;
