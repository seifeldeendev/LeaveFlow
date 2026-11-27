// In-app inbox. Every query is filtered by the caller's own id, so another user's notification is a 404.
import { Router } from 'express';
import { db } from '../lib/db.js';
import { HttpError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const out = (n) => ({ id: n.id, title: n.title, body: n.body, link: n.link || 'pages/home.html', at: n.created_at, read: n.read });

router.get('/', async (req, res) => {
  const sql = await db();
  const rows = await sql`SELECT * FROM notifications WHERE user_id = ${req.user.id} ORDER BY created_at DESC LIMIT 50`;
  res.json(rows.map(out));
});

// Mark all of mine as read
router.patch('/', async (req, res) => {
  const sql = await db();
  await sql`UPDATE notifications SET read = true WHERE user_id = ${req.user.id} AND read = false`;
  res.json({ ok: true });
});

router.patch('/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  const sql = await db();
  const [n] = await sql`UPDATE notifications SET read = true WHERE id = ${req.params.id} AND user_id = ${req.user.id} RETURNING *`;
  if (!n) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  res.json(out(n));
});

router.delete('/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  const sql = await db();
  const [n] = await sql`DELETE FROM notifications WHERE id = ${req.params.id} AND user_id = ${req.user.id} RETURNING id`;
  if (!n) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
  res.json({ ok: true });
});

export default router;
