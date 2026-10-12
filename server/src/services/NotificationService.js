// NotificationService (in-app notifications). `send` is the operation drawn in the sequence
// diagrams: send(supervisorId, "New complaint"). M4 adds sending; M7 adds the read endpoints.
//
// `recipient` is a user id, or a descriptor produced by the state machine:
//   { kind: 'USER', userId } | { kind: 'ALL_SUPERVISORS' } | { kind: 'ALL_ADMINISTRATORS' }
// Groups are expanded to the matching users here, so the domain never needs a user directory.
// `db` is a pool or, normally, the connection of the surrounding transaction, so the
// notification is saved or rolled back together with the change that caused it.
import { pool } from '../db.js';

const MAX_MESSAGE = 255; // notifications.message is VARCHAR(255)

async function resolveUserIds(recipient, db) {
  if (typeof recipient === 'number') return [recipient];
  switch (recipient?.kind) {
    case 'USER':
      return [recipient.userId];
    case 'ALL_SUPERVISORS':
    case 'ALL_ADMINISTRATORS': {
      const role = recipient.kind === 'ALL_SUPERVISORS' ? 'SUPERVISOR' : 'ADMIN';
      const [rows] = await db.query('SELECT user_id FROM users WHERE role = ?', [role]);
      return rows.map((r) => r.user_id);
    }
    default:
      throw new Error(`Unknown notification recipient: ${JSON.stringify(recipient)}`);
  }
}

export const notificationService = {
  async send(recipient, message, complaintId = null, db = pool) {
    const userIds = await resolveUserIds(recipient, db);
    if (userIds.length === 0) return 0;
    const text = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message;
    const sentAt = new Date();
    await db.query('INSERT INTO notifications (user_id, complaint_id, message, is_read, sent_at) VALUES ?',
      [userIds.map((userId) => [userId, complaintId, text, false, sentAt])]);
    return userIds.length;
  },

  // Sends the notifications queued by the state machine ([{ recipient, message }]).
  async dispatch(notifications, complaintId, db = pool) {
    for (const { recipient, message } of notifications) {
      await this.send(recipient, message, complaintId, db);
    }
  },
};
