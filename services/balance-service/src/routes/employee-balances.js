import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { balancesFor, ledgerWithRunningBalance, isUuid } from '../services/ledger.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const sql = await db();
  res.json(await balancesFor(sql, req.user.id));
});

router.get('/ledger', async (req, res) => {
  const sql = await db();
  const rows = await ledgerWithRunningBalance(sql, req.user.id);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(rows.slice(offset, offset + limit));
});

export default router;
