// Small request helpers shared by the controllers.
import { ComplaintStatus, Priority, ValidationError, CAMPUS_USER_ROLES, Role } from '../domain/index.js';

export function parseId(value, label = 'complaint id') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`Invalid ${label}`);
  return id;
}

// Who may see a complaint: its reporter, its assignee, and every supervisor/administrator.
export function canView(user, { reporterId, assigneeId }) {
  if (user.role === Role.SUPERVISOR || user.role === Role.ADMIN) return true;
  if (CAMPUS_USER_ROLES.includes(user.role)) return reporterId === user.userId;
  if (user.role === Role.STAFF) return assigneeId === user.userId;
  return false;
}

// Query-string filters of GET /api/complaints: status, priority (comma-separated lists), category
// (id or name), block, from, to (dates). Returns validated values or throws a 400 listing every problem.
// `to` given as a plain date (2026-03-10) includes that whole day, so it is returned as the start
// of the next day and used with "<".
export function parseComplaintFilters(query) {
  const errors = {};
  const list = (name, allowed) => {
    if (query[name] == null || query[name] === '') return undefined;
    const values = String(query[name]).split(',').map((s) => s.trim());
    const bad = values.filter((v) => !allowed.includes(v));
    if (bad.length) errors[name] = `unknown value: ${bad.join(', ')}`;
    return values;
  };
  const date = (name, isEnd) => {
    if (query[name] == null || query[name] === '') return undefined;
    const raw = String(query[name]);
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      errors[name] = 'must be a date such as 2026-03-10';
      return undefined;
    }
    if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  };

  const filters = {
    status: list('status', Object.values(ComplaintStatus)),
    priority: list('priority', Object.values(Priority)),
    block: query.block ? String(query.block) : undefined,
    from: date('from', false),
    to: date('to', true),
  };
  if (query.category != null && query.category !== '') {
    filters.category = /^\d+$/.test(String(query.category)) ? Number(query.category) : String(query.category);
  }
  if (Object.keys(errors).length) throw new ValidationError('Invalid filters', errors);
  return filters;
}

// Query-string filters of GET /api/dashboard: category (id or name), block, from, to.
// Same rules and messages as the complaint list; any other parameter is ignored.
export function parseDashboardFilters(query) {
  const { category, block, from, to } = parseComplaintFilters({
    category: query.category, block: query.block, from: query.from, to: query.to,
  });
  return { category, block, from, to };
}
