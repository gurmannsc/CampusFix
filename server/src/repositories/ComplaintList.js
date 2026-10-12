// ComplaintList: the repository object of sd Escalate Overdue Complaint (findOverdue(now)),
// plus the query for the 48-hour auto-close that the same scheduler run performs.
// The returned complaints are a snapshot taken WITHOUT a lock; the scheduler re-loads each one
// with a row lock before changing it (see EscalationScheduler), so a complaint that changed in
// the meantime is simply skipped.
import { pool } from '../db.js';
import { OPEN_STATES, AUTO_CLOSE_HOURS } from '../domain/index.js';
import { complaintRepository } from './complaintRepository.js';

const HOUR_MS = 3600 * 1000;

async function loadAll(ids) {
  const complaints = await Promise.all(ids.map((id) => complaintRepository.findById(id)));
  return complaints.filter(Boolean);
}

export const ComplaintList = {
  // Complaints that need Complaint.escalate():
  //   row 12: an Open complaint with now > dueAt
  //   row 13: an ESCALATED complaint whose last Escalation is at least escalationIntervalHours old
  // Oldest deadline first.
  async findOverdue(now = new Date()) {
    const [rows] = await pool.query(
      `SELECT c.complaint_id
       FROM complaints c
       JOIN deadline_rules r ON r.priority = c.priority
       WHERE (c.status IN (?) AND c.due_at < ?)
          OR (c.status = 'ESCALATED'
              AND (SELECT MAX(e.escalated_at) FROM escalations e WHERE e.complaint_id = c.complaint_id)
                  <= DATE_SUB(?, INTERVAL r.escalation_interval_hours HOUR))
       ORDER BY c.due_at, c.complaint_id`,
      [OPEN_STATES, now, now],
    );
    return loadAll(rows.map((r) => r.complaint_id));
  },

  // Row 11: RESOLVED complaints with no response for at least 48 hours.
  async findAutoCloseable(now = new Date()) {
    const cutoff = new Date(new Date(now).getTime() - AUTO_CLOSE_HOURS * HOUR_MS);
    const [rows] = await pool.query(
      "SELECT complaint_id FROM complaints WHERE status = 'RESOLVED' AND resolved_at <= ? ORDER BY resolved_at, complaint_id",
      [cutoff],
    );
    return loadAll(rows.map((r) => r.complaint_id));
  },
};
