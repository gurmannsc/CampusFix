// Data access for complaints (all SQL is parameterised). Two kinds of reads:
//   - findById(): the Complaint domain entity, used before changing it (can lock the row)
//   - findDetails() / list(): plain JSON for the API, with names joined in
// ComplaintList.findOverdue (docs/05) is added here in M6.
import { pool } from '../db.js';
import { Complaint, Category, DeadlineRule, OPEN_STATES } from '../domain/index.js';

const ENTITY_SQL = `
  SELECT c.*, cat.name AS category_name, cat.type AS category_type, cat.default_priority AS category_default_priority,
         r.resolution_hours, r.escalation_interval_hours,
         (SELECT MAX(e.escalated_at) FROM escalations e WHERE e.complaint_id = c.complaint_id) AS last_escalated_at
  FROM complaints c
  JOIN categories cat ON cat.category_id = c.category_id
  JOIN deadline_rules r ON r.priority = c.priority
  WHERE c.complaint_id = ?`;

function toEntity(row) {
  return new Complaint({
    complaintId: row.complaint_id, title: row.title, description: row.description, photoPath: row.photo_path,
    priority: row.priority, status: row.status, createdAt: row.created_at, dueAt: row.due_at,
    resolvedAt: row.resolved_at, closedAt: row.closed_at, escalationLevel: row.escalation_level,
    reopenCount: row.reopen_count, reporterId: row.reporter_id, categoryId: row.category_id,
    locationId: row.location_id, supervisorId: row.supervisor_id, assigneeId: row.assignee_id,
    lastEscalatedAt: row.last_escalated_at,
    category: new Category({
      categoryId: row.category_id, name: row.category_name, type: row.category_type, defaultPriority: row.category_default_priority,
    }),
    deadlineRule: new DeadlineRule({
      priority: row.priority, resolutionHours: row.resolution_hours, escalationIntervalHours: row.escalation_interval_hours,
    }),
  });
}

// Columns and joins shared by the list and the details view.
const VIEW_SQL = `
  SELECT c.complaint_id, c.title, c.description, c.priority, c.status, c.created_at, c.due_at, c.resolved_at,
         c.closed_at, c.escalation_level, c.reopen_count, c.photo_path IS NOT NULL AS has_photo,
         cat.category_id, cat.name AS category_name, cat.type AS category_type,
         l.location_id, l.block, l.floor, l.room, l.area_type,
         rep.user_id AS reporter_id, rep.name AS reporter_name,
         asg.user_id AS assignee_id, asg.name AS assignee_name,
         sup.user_id AS supervisor_id, sup.name AS supervisor_name
  FROM complaints c
  JOIN categories cat ON cat.category_id = c.category_id
  JOIN locations l ON l.location_id = c.location_id
  JOIN users rep ON rep.user_id = c.reporter_id
  LEFT JOIN users asg ON asg.user_id = c.assignee_id
  LEFT JOIN users sup ON sup.user_id = c.supervisor_id`;

// "Overdue" here means the same as Complaint.isOverdue: an Open complaint past its dueAt.
function toView(row, now = new Date()) {
  return {
    complaintId: row.complaint_id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    dueAt: row.due_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
    escalationLevel: row.escalation_level,
    reopenCount: row.reopen_count,
    overdue: OPEN_STATES.includes(row.status) && now > row.due_at,
    photoUrl: row.has_photo ? `/api/complaints/${row.complaint_id}/photo` : null,
    category: { categoryId: row.category_id, name: row.category_name, type: row.category_type },
    location: { locationId: row.location_id, block: row.block, floor: row.floor, room: row.room, areaType: row.area_type },
    reporter: { userId: row.reporter_id, name: row.reporter_name },
    assignee: row.assignee_id ? { userId: row.assignee_id, name: row.assignee_name } : null,
    supervisor: row.supervisor_id ? { userId: row.supervisor_id, name: row.supervisor_name } : null,
  };
}

// Default order: priority, then dueAt (docs/06). Finished complaints (CLOSED, INVALID) come last so
// that old closed CRITICAL ones do not push live complaints out of view; each group keeps that order.
const DEFAULT_ORDER = "c.status IN ('CLOSED', 'INVALID'), FIELD(c.priority, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'), c.due_at, c.complaint_id";

export const complaintRepository = {
  // forUpdate locks the complaint row until the surrounding transaction ends, so two people
  // changing the same complaint at once are handled one after the other (the second then sees
  // the new status and gets a 409 from the state machine).
  async findById(complaintId, { conn = pool, forUpdate = false } = {}) {
    const [rows] = await conn.query(ENTITY_SQL + (forUpdate ? ' FOR UPDATE OF c' : ''), [complaintId]);
    return rows[0] ? toEntity(rows[0]) : null;
  },

  // Inserts a new complaint or updates an existing one, then writes everything queued in the
  // entity's outbox (StatusUpdate / Feedback / Escalation rows). Returns that outbox so the
  // caller can send its notifications. Must run inside a transaction (pass its connection).
  async save(complaint, conn) {
    if (complaint.complaintId == null) {
      const [res] = await conn.query(
        `INSERT INTO complaints (title, description, photo_path, priority, status, created_at, due_at, resolved_at, closed_at,
           escalation_level, reopen_count, reporter_id, category_id, location_id, supervisor_id, assignee_id)
         VALUES (?)`,
        [[complaint.title, complaint.description, complaint.photoPath, complaint.priority, complaint.status,
          complaint.createdAt, complaint.dueAt, complaint.resolvedAt, complaint.closedAt, complaint.escalationLevel,
          complaint.reopenCount, complaint.reporterId, complaint.categoryId, complaint.locationId,
          complaint.supervisorId, complaint.assigneeId]],
      );
      complaint.complaintId = res.insertId;
    } else {
      await conn.query(
        `UPDATE complaints SET priority = ?, status = ?, due_at = ?, resolved_at = ?, closed_at = ?, escalation_level = ?,
           reopen_count = ?, supervisor_id = ?, assignee_id = ? WHERE complaint_id = ?`,
        [complaint.priority, complaint.status, complaint.dueAt, complaint.resolvedAt, complaint.closedAt,
          complaint.escalationLevel, complaint.reopenCount, complaint.supervisorId, complaint.assigneeId, complaint.complaintId],
      );
    }
    const id = complaint.complaintId;
    const out = complaint.takeOutbox();
    for (const u of out.statusUpdates) {
      await conn.query(
        'INSERT INTO status_updates (complaint_id, from_status, to_status, remarks, updated_by, updated_at) VALUES (?)',
        [[id, u.fromStatus, u.toStatus, u.remarks, u.updatedBy, u.updatedAt]],
      );
    }
    for (const f of out.feedback) {
      await conn.query('INSERT INTO feedback (complaint_id, is_fixed, rating, comment, given_at) VALUES (?)',
        [[id, f.isFixed, f.rating, f.comment, f.givenAt]]);
    }
    for (const e of out.escalations) {
      await conn.query('INSERT INTO escalations (complaint_id, level, reason, escalated_at) VALUES (?)',
        [[id, e.level, e.reason, e.escalatedAt]]);
    }
    return out;
  },

  // Who may see a complaint (and its photo): used for access checks before loading details.
  async findAccessInfo(complaintId) {
    const [rows] = await pool.query(
      'SELECT reporter_id, assignee_id, photo_path FROM complaints WHERE complaint_id = ?', [complaintId]);
    return rows[0] ? { reporterId: rows[0].reporter_id, assigneeId: rows[0].assignee_id, photoPath: rows[0].photo_path } : null;
  },

  // Full details for the API: the complaint plus status history, feedback and escalations.
  async findDetails(complaintId) {
    const [rows] = await pool.query(`${VIEW_SQL} WHERE c.complaint_id = ?`, [complaintId]);
    if (!rows[0]) return null;
    const [history] = await pool.query(
      `SELECT su.update_id, su.from_status, su.to_status, su.remarks, su.updated_at, su.updated_by, u.name AS updated_by_name
       FROM status_updates su LEFT JOIN users u ON u.user_id = su.updated_by
       WHERE su.complaint_id = ? ORDER BY su.updated_at, su.update_id`, [complaintId]);
    const [feedback] = await pool.query(
      'SELECT feedback_id, is_fixed, rating, comment, given_at FROM feedback WHERE complaint_id = ? ORDER BY given_at, feedback_id', [complaintId]);
    const [escalations] = await pool.query(
      'SELECT escalation_id, level, reason, escalated_at FROM escalations WHERE complaint_id = ? ORDER BY escalated_at, escalation_id', [complaintId]);
    return {
      ...toView(rows[0]),
      statusHistory: history.map((h) => ({
        updateId: h.update_id, fromStatus: h.from_status, toStatus: h.to_status, remarks: h.remarks,
        updatedAt: h.updated_at, updatedBy: h.updated_by ? { userId: h.updated_by, name: h.updated_by_name } : null, // null = Timer
      })),
      feedback: feedback.map((f) => ({
        feedbackId: f.feedback_id, isFixed: Boolean(f.is_fixed), rating: f.rating, comment: f.comment, givenAt: f.given_at,
      })),
      escalations: escalations.map((e) => ({ escalationId: e.escalation_id, level: e.level, reason: e.reason, escalatedAt: e.escalated_at })),
    };
  },

  // Role-filtered list (docs/06): a reporter sees their own complaints, staff the ones assigned
  // to them, supervisors and administrators everything. Default order: priority, then dueAt.
  // filters: { status[], priority[], category (id or name), block, from, to }
  async list(user, filters = {}) {
    const where = [];
    const params = [];
    if (user.role === 'STUDENT' || user.role === 'FACULTY') {
      where.push('c.reporter_id = ?');
      params.push(user.userId);
    } else if (user.role === 'STAFF') {
      where.push('c.assignee_id = ?');
      params.push(user.userId);
    }
    if (filters.status?.length) { where.push('c.status IN (?)'); params.push(filters.status); }
    if (filters.priority?.length) { where.push('c.priority IN (?)'); params.push(filters.priority); }
    if (filters.category != null) {
      where.push(Number.isInteger(filters.category) ? 'cat.category_id = ?' : 'cat.name = ?');
      params.push(filters.category);
    }
    if (filters.block) { where.push('l.block = ?'); params.push(filters.block); }
    if (filters.from) { where.push('c.created_at >= ?'); params.push(filters.from); }
    if (filters.to) { where.push('c.created_at < ?'); params.push(filters.to); } // `to` is exclusive; see parseComplaintFilters
    const sql = `${VIEW_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY ${DEFAULT_ORDER}`;
    const [rows] = await pool.query(sql, params);
    const now = new Date();
    return rows.map((r) => toView(r, now));
  },
};
