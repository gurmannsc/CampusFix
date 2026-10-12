// ReportService: the numbers on the administrator's dashboard (US-10, GET /api/dashboard).
// Two steps, so the arithmetic can be tested without a database:
//   1. reportService.dashboard() reads the complaints in scope (filters: category, block, from, to)
//   2. computeDashboard() turns those rows into the metrics
//
// Definitions (the docs name the metrics, these are the exact rules):
//   resolution time   resolvedAt - createdAt, for complaints now RESOLVED or CLOSED. A complaint that was
//                     rejected and fixed again counts until its final resolution. INVALID ones are left out.
//   open / closed     closed = CLOSED, invalid = INVALID, open = everything else (including RESOLVED, which
//                     still waits for the reporter).
//   deadline breach   a complaint breached its deadline if it was ever escalated, OR it was resolved after
//                     dueAt, OR it is still Open and past dueAt right now. (dueAt is reset on reopen and on
//                     reassignment, so an Escalation row is the reliable trace of an earlier breach.)
//                     Breach % = breached / eligible, where eligible = complaints that are finished
//                     (RESOLVED, CLOSED) or breached. Open complaints still inside their deadline are
//                     left out so that they do not water the percentage down. INVALID ones are left out.
//   rating            average of the 1 to 5 ratings given when a reporter confirmed a fix.
//   workload          per staff member (and per Administrator who has SERVICE complaints): complaints
//                     currently ASSIGNED, IN_PROGRESS, ON_HOLD or ESCALATED, and how many were completed.
import { pool } from '../db.js';

const OPEN_STATES = ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'];
const WORKING_STATES = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'];
const STATUSES = ['SUBMITTED', 'INVALID', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'REOPENED', 'ESCALATED', 'CLOSED'];

const round1 = (x) => Math.round(x * 10) / 10;
const mean = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);
const percent = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : null);

// ---- step 2: pure calculation ---------------------------------------------------------------

// complaints: [{ complaintId, status, createdAt, dueAt, resolvedAt, assigneeId, categoryId, categoryName, categoryType, escalated }]
// ratings:    [{ rating, categoryId, assigneeId }]       staff: [{ userId, name, trade, role }]
export function computeDashboard({ complaints, ratings, staff, now = new Date() }) {
  const hours = (c) => (new Date(c.resolvedAt) - new Date(c.createdAt)) / 3600000;
  const isResolved = (c) => ['RESOLVED', 'CLOSED'].includes(c.status) && c.resolvedAt != null;
  const isBreached = (c) => c.status !== 'INVALID' && (
    c.escalated
    || (c.resolvedAt != null && new Date(c.resolvedAt) > new Date(c.dueAt))
    || (OPEN_STATES.includes(c.status) && new Date(c.dueAt) < new Date(now))
  );
  const isEligible = (c) => c.status !== 'INVALID' && (['RESOLVED', 'CLOSED'].includes(c.status) || isBreached(c));

  // metrics of any group of complaints
  const measure = (list, listRatings) => {
    const eligible = list.filter(isEligible);
    const breached = eligible.filter(isBreached);
    return {
      total: list.length,
      open: list.filter((c) => !['CLOSED', 'INVALID'].includes(c.status)).length,
      closed: list.filter((c) => c.status === 'CLOSED').length,
      invalid: list.filter((c) => c.status === 'INVALID').length,
      resolvedCount: list.filter(isResolved).length,
      avgResolutionHours: mean(list.filter(isResolved).map(hours)),
      breached: breached.length,
      breachEligible: eligible.length,
      breachPercent: percent(breached.length, eligible.length),
      avgRating: mean(listRatings.map((r) => r.rating)),
      ratingCount: listRatings.length,
    };
  };

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, complaints.filter((c) => c.status === s).length]));

  const categoryIds = [...new Map(complaints.map((c) => [c.categoryId, c])).values()];
  const byCategory = categoryIds
    .map((first) => ({
      categoryId: first.categoryId,
      name: first.categoryName,
      type: first.categoryType,
      ...measure(complaints.filter((c) => c.categoryId === first.categoryId), ratings.filter((r) => r.categoryId === first.categoryId)),
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const distribution = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, ratings.filter((r) => r.rating === n).length]));

  const workload = staff
    .map((person) => {
      const mine = complaints.filter((c) => c.assigneeId === person.userId);
      return {
        userId: person.userId,
        name: person.name,
        trade: person.trade ?? null,
        role: person.role,
        openAssignments: mine.filter((c) => WORKING_STATES.includes(c.status)).length,
        completed: mine.filter(isResolved).length,
        totalAssigned: mine.length,
        avgRating: mean(ratings.filter((r) => r.assigneeId === person.userId).map((r) => r.rating)),
        ratingCount: ratings.filter((r) => r.assigneeId === person.userId).length,
      };
    })
    // every maintenance staff member is listed (a zero shows spare capacity); an Administrator only with SERVICE complaints
    .filter((p) => p.role === 'STAFF' || p.totalAssigned > 0)
    .sort((a, b) => b.openAssignments - a.openAssignments || b.totalAssigned - a.totalAssigned || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date(now),
    summary: measure(complaints, ratings),
    byStatus,
    byCategory,
    ratings: { average: mean(ratings.map((r) => r.rating)), count: ratings.length, distribution },
    workload,
  };
}

// ---- step 1: read the complaints in scope ---------------------------------------------------

// filters: { category (id or name), block, from, to }; `to` is exclusive (see parseComplaintFilters).
function scope(filters) {
  const where = [];
  const params = [];
  if (filters.category != null) {
    where.push(Number.isInteger(filters.category) ? 'cat.category_id = ?' : 'cat.name = ?');
    params.push(filters.category);
  }
  if (filters.block) { where.push('l.block = ?'); params.push(filters.block); }
  if (filters.from) { where.push('c.created_at >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('c.created_at < ?'); params.push(filters.to); }
  return { where: where.length ? `AND ${where.join(' AND ')}` : '', params };
}

const FROM = `FROM complaints c
  JOIN categories cat ON cat.category_id = c.category_id
  JOIN locations l ON l.location_id = c.location_id`;

export const reportService = {
  async dashboard(filters = {}, now = new Date()) {
    const { where, params } = scope(filters);
    const [complaintRows] = await pool.query(
      `SELECT c.complaint_id, c.status, c.created_at, c.due_at, c.resolved_at, c.assignee_id,
              cat.category_id, cat.name AS category_name, cat.type AS category_type,
              EXISTS (SELECT 1 FROM escalations e WHERE e.complaint_id = c.complaint_id) AS escalated
       ${FROM} WHERE 1 = 1 ${where}`, params);
    const [ratingRows] = await pool.query(
      `SELECT f.rating, c.category_id, c.assignee_id
       FROM feedback f JOIN complaints c ON c.complaint_id = f.complaint_id
       JOIN categories cat ON cat.category_id = c.category_id
       JOIN locations l ON l.location_id = c.location_id
       WHERE f.is_fixed = TRUE AND f.rating IS NOT NULL ${where}`, params);
    const [staffRows] = await pool.query("SELECT user_id, name, trade, role FROM users WHERE role IN ('STAFF', 'ADMIN')");

    return computeDashboard({
      complaints: complaintRows.map((r) => ({
        complaintId: r.complaint_id, status: r.status, createdAt: r.created_at, dueAt: r.due_at, resolvedAt: r.resolved_at,
        assigneeId: r.assignee_id, categoryId: r.category_id, categoryName: r.category_name, categoryType: r.category_type,
        escalated: Boolean(r.escalated),
      })),
      ratings: ratingRows.map((r) => ({ rating: r.rating, categoryId: r.category_id, assigneeId: r.assignee_id })),
      staff: staffRows.map((r) => ({ userId: r.user_id, name: r.name, trade: r.trade, role: r.role })),
      now,
    });
  },
};
