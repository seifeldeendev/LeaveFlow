import { Router } from 'express';
import { requireAuth, requireRole } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { allUsers } from '../lib/directory.js';
import { balancesFor, append, audit, isUuid, TYPES } from '../services/ledger.js';
import { randomUUID } from 'node:crypto';

const router = Router();
router.use(requireAuth, requireRole('HRAdmin'));

router.get('/', async (req, res) => {
  const sql = await db();
  let people = await allUsers();
  if (req.query.department) people = people.filter((p) => p.dept === req.query.department);
  const out = [];
  for (const p of people) out.push({
    id: p.id, name: p.name, dept: p.dept, role: p.role, joinDate: p.joinDate,
    balance: await balancesFor(sql, p.id),
  });
  res.json(out);
});

router.post('/:id/adjustments', async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Employee not found.');
  const people = await allUsers();
  const emp = people.find((p) => p.id === req.params.id);
  if (!emp) throw new HttpError(404, 'NOT_FOUND', 'Employee not found.');

  const b = req.body || {};
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 10) {
    throw new HttpError(400, 'BAD_AMOUNT', 'Amount must be between -10 and +10 days, not zero.');
  }
  const reason = String(b.reason || '').trim();
  if (reason.length < 5) throw new HttpError(400, 'REASON_REQUIRED', 'A reason of at least 5 characters is required.');
  if (!TYPES.includes(b.type) || (b.type !== 'Annual' && b.type !== 'Casual')) {
    throw new HttpError(400, 'BAD_TYPE', 'Choose Annual or Casual.');
  }
  const sql = await db();
  const key = `adjustment:${randomUUID()}`;
  const result = await append(sql, {
    employeeId: emp.id, kind: 'Adjustment', type: b.type, amount, reason,
    eventId: key, actor: { id: req.user.id, name: req.user.name },
  });
  await audit(sql, req.user, 'BALANCE_ADJUSTED', `${emp.name} - ${b.type} ${amount > 0 ? '+' : ''}${amount}`,
    'OK', { reason });
  res.status(201).json({
    id: result.entry?.id, employeeId: emp.id, kind: 'Adjustment', type: b.type,
    amount: Math.round(amount * 100) / 100, reason, reference: key, at: new Date().toISOString(),
  });
});

router.get('/:id/ledger', async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Employee not found.');
  const sql = await db();
  const people = await allUsers();
  if (!people.some((p) => p.id === req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Employee not found.');
  const { ledgerWithRunningBalance } = await import('../services/ledger.js');
  res.json(await ledgerWithRunningBalance(sql, req.params.id));
});

export default router;
