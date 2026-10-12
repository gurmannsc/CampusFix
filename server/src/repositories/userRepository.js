// Data access for users. Returns domain objects (Student, MaintenanceStaff, ...), never raw rows.
import { pool } from '../db.js';
import { userFromRow } from '../domain/index.js';
import { notificationRepository } from './notificationRepository.js';
import { reportService } from '../services/ReportService.js';
import { adminService } from '../services/AdminService.js';

// Collaborators handed to every User object (see domain/User.js). Only what is wired so far;
// an operation needing anything else says so with a clear error.
const deps = { notificationRepository, reportService, adminService };

export const userRepository = {
  async findById(userId) {
    const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [userId]);
    return rows[0] ? userFromRow(rows[0], deps) : null;
  },

  // US-06: who may be offered for a complaint. INFRASTRUCTURE: staff whose trade equals the category
  // name and who are available. SERVICE: Administrators (never maintenance staff, US-11).
  // openAssignments helps the supervisor pick the least loaded person.
  async findEligibleAssignees(category) {
    const isService = category.type === 'SERVICE';
    const [rows] = await pool.query(
      `SELECT u.user_id, u.name, u.trade, u.is_available,
              (SELECT COUNT(*) FROM complaints c WHERE c.assignee_id = u.user_id
                 AND c.status IN ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED')) AS open_assignments
       FROM users u
       WHERE ${isService ? "u.role = 'ADMIN'" : "u.role = 'STAFF' AND u.trade = ? AND u.is_available = TRUE"}
       ORDER BY open_assignments, u.name`,
      isService ? [] : [category.name],
    );
    return rows.map((r) => ({
      userId: r.user_id, name: r.name, trade: r.trade, isAvailable: r.is_available == null ? null : Boolean(r.is_available),
      openAssignments: Number(r.open_assignments),
    }));
  },

  // users.email is UNIQUE and the column collation is case-insensitive.
  async findByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] ? userFromRow(rows[0], deps) : null;
  },
};
