// GET /team-calendar   who is off or waiting for a decision: the manager's department, or everyone for HR.
import { Router } from 'express';
import { db } from '../lib/db.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { allUsers } from '../lib/directory.js';

const router = Router();

router.get('/', requireAuth, requireRole('Manager', 'HRAdmin'), async (req, res) => {
  const u = req.user;
  const everyone = await allUsers();
  const members = u.groups.includes('HRAdmin') ? everyone : everyone.filter((m) => m.dept === u.department);
  const ids = members.map((m) => m.id);
  const sql = await db();
  const rows = ids.length ? await sql`
    SELECT request_id, employee_id, employee_name, department, leave_type, status, working_days,
           start_date::text AS start_date, end_date::text AS end_date
    FROM approval_tasks
    WHERE status IN ('Approved', 'InProgress') AND employee_id = ANY(${ids})
      AND end_date >= current_date - 30` : [];
  res.json({
    members: members.map((m) => ({ id: m.id, name: m.name, dept: m.dept })),
    requests: rows.map((r) => ({
      id: r.request_id, employeeId: r.employee_id, type: r.leave_type, start: r.start_date, end: r.end_date,
      status: r.status === 'Approved' ? 'Approved' : 'Pending', workingDays: Number(r.working_days),
      employee: { id: r.employee_id, name: r.employee_name, dept: r.department },
    })),
    holidays: [], // public holidays live in the requests service
  });
});

export default router;
