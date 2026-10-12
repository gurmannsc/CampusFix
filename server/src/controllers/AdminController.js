// AdminController: administrator functions: the dashboard (M9), the demo deadline-check trigger (M6), and
// management of categories, locations, users and deadline rules (docs/06 "CRUD /api/admin/..."). The rules
// for each live in services/AdminService.js; the methods here only read the request and return the result.
import { escalationScheduler } from '../scheduler/EscalationScheduler.js';
import { adminService } from '../services/AdminService.js';
import { parseDashboardFilters, parseId } from './helpers.js';

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

  // ---- categories ----
  async listCategories(req, res) { res.json({ categories: await adminService.listCategories() }); },
  // Administrator.manageCategory(category) from the class diagram
  async createCategory(req, res) { res.status(201).json({ category: await req.user.manageCategory(req.body ?? {}) }); },
  async updateCategory(req, res) {
    res.json({ category: await req.user.manageCategory({ ...(req.body ?? {}), categoryId: parseId(req.params.id, 'category id') }) });
  },
  async deleteCategory(req, res) { await adminService.deleteCategory(parseId(req.params.id, 'category id')); res.status(204).end(); },

  // ---- locations ----
  async listLocations(req, res) { res.json({ locations: await adminService.listLocations() }); },
  async createLocation(req, res) { res.status(201).json({ location: await adminService.createLocation(req.body ?? {}) }); },
  async updateLocation(req, res) { res.json({ location: await adminService.updateLocation(parseId(req.params.id, 'location id'), req.body ?? {}) }); },
  async deleteLocation(req, res) { await adminService.deleteLocation(parseId(req.params.id, 'location id')); res.status(204).end(); },

  // ---- users ----
  async listUsers(req, res) { res.json({ users: await adminService.listUsers({ role: req.query.role }) }); },
  async createUser(req, res) { res.status(201).json({ user: await adminService.createUser(req.body ?? {}) }); },
  async updateUser(req, res) { res.json({ user: await adminService.updateUser(parseId(req.params.id, 'user id'), req.body ?? {}) }); },
  async deleteUser(req, res) { await adminService.deleteUser(parseId(req.params.id, 'user id'), req.user.userId); res.status(204).end(); },

  // ---- deadline rules ----
  async listDeadlineRules(req, res) { res.json({ rules: await adminService.listDeadlineRules() }); },
  // Administrator.configureDeadline(priority, hours) from the class diagram (+ the optional escalation interval)
  async updateDeadlineRule(req, res) {
    const { resolutionHours, escalationIntervalHours } = req.body ?? {};
    res.json({ rule: await req.user.configureDeadline(req.params.priority, resolutionHours, escalationIntervalHours) });
  },
};
