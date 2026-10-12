// AdminController: administrator functions. M6 adds the demo trigger; the category / location /
// user / deadline-rule CRUD and the dashboard arrive in M9.
import { escalationScheduler } from '../scheduler/EscalationScheduler.js';

export const AdminController = {
  // POST /api/admin/run-deadline-check   DEMO ONLY: runs EscalationScheduler.checkDeadlines(now) immediately,
  // so the escalation and auto-close can be shown without waiting for the timer.
  async runDeadlineCheck(req, res) {
    res.json(await escalationScheduler.checkDeadlines(new Date()));
  },
};
