// Data access for users. Returns domain objects (Student, MaintenanceStaff, ...), never raw rows.
import { pool } from '../db.js';
import { userFromRow } from '../domain/index.js';

export const userRepository = {
  async findById(userId) {
    const [rows] = await pool.query('SELECT * FROM users WHERE user_id = ?', [userId]);
    return rows[0] ? userFromRow(rows[0]) : null;
  },

  // users.email is UNIQUE and the column collation is case-insensitive.
  async findByEmail(email) {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] ? userFromRow(rows[0]) : null;
  },
};
