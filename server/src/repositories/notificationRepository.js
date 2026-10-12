// Data access for notifications ("User receives Notification"). Sending is in
// services/NotificationService.js; this file is the read side and the "mark read" update.
import { pool } from '../db.js';
import { Notification } from '../domain/index.js';

const toEntity = (r) => new Notification({
  notificationId: r.notification_id, userId: r.user_id, complaintId: r.complaint_id,
  message: r.message, isRead: Boolean(r.is_read), sentAt: r.sent_at,
});

export const notificationRepository = {
  // Newest first. This is what User.viewNotifications() returns.
  async findByUser(userId, { unreadOnly = false, limit = 50 } = {}) {
    const [rows] = await pool.query(
      `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND is_read = FALSE' : ''}
       ORDER BY sent_at DESC, notification_id DESC LIMIT ?`,
      [userId, limit],
    );
    return rows.map(toEntity);
  },

  async countUnread(userId) {
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = FALSE', [userId]);
    return Number(row.n);
  },

  async findById(notificationId) {
    const [rows] = await pool.query('SELECT * FROM notifications WHERE notification_id = ?', [notificationId]);
    return rows[0] ? toEntity(rows[0]) : null;
  },

  // Only is_read can change after a notification was sent.
  async save(notification) {
    await pool.query('UPDATE notifications SET is_read = ? WHERE notification_id = ?', [notification.isRead, notification.notificationId]);
  },
};
