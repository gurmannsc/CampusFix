// AdminController: administrator functions: the dashboard (M9) and the demo deadline-check trigger (M6).
import { escalationScheduler } from '../scheduler/EscalationScheduler.js';
import { parseDashboardFilters } from './helpers.js';

export const AdminController = {
  // GET /api/dashboard?category=&block=&from=&to=   US-10
  // Administrator.viewDashboard() from the class diagram, answered by ReportService.
  async dashboard(req, res) {
    const filters = parseDashboardFilters(req.query);
    const { category, block, from, to } = req.query;
    res.json({ ...(await req.user.viewDashboard(filters)), appliedFilters: { category: category ?? null, block: block ?? null, from: from ?? null, to: to ?? null } });
  },

  // POST /api/admin/run-deadline-check   DEMO ONLY: runs EscalationScheduler.checkDeadlines(now) immediately,
  // so the escalation and auto-close can be shown without waiting for the timer.
  async runDeadlineCheck(req, res) {
    res.json(await escalationScheduler.checkDeadlines(new Date()));
  },
};
