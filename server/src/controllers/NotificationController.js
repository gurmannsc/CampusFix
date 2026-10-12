// GET /api/notifications and POST /api/notifications/:id/read (the NotificationBell in the client).
// A user only ever sees and changes their own notifications.
import { DomainError, ValidationError } from '../domain/index.js';
import { notificationRepository } from '../repositories/notificationRepository.js';
import { parseId } from './helpers.js';

const MAX_LIMIT = 200;

const toDto = (n) => ({
  notificationId: n.notificationId, complaintId: n.complaintId, message: n.message, isRead: n.isRead, sentAt: n.sentAt,
});

export const NotificationController = {
  // Query: unread=true (only unread), limit=1..200 (default 50).
  // unreadCount is the total number of unread notifications, whatever the limit, for the bell badge.
  async list(req, res) {
    const { unread, limit } = req.query;
    const errors = {};
    if (unread != null && unread !== 'true' && unread !== 'false') errors.unread = 'must be true or false';
    const max = limit == null ? 50 : Number(limit);
    if (!Number.isInteger(max) || max < 1 || max > MAX_LIMIT) errors.limit = `must be a whole number from 1 to ${MAX_LIMIT}`;
    if (Object.keys(errors).length) throw new ValidationError('Invalid query', errors);

    // User.viewNotifications() from the class diagram (wired to this repository in userRepository.js)
    const notifications = await req.user.viewNotifications({ unreadOnly: unread === 'true', limit: max });
    res.json({ notifications: notifications.map(toDto), unreadCount: await notificationRepository.countUnread(req.user.userId) });
  },

  // Notification.markRead(). Marking one that is already read is fine (idempotent). Someone else's
  // notification looks exactly like a missing one (404), so ids cannot be probed.
  async markRead(req, res) {
    const id = parseId(req.params.id, 'notification id');
    const notification = await notificationRepository.findById(id);
    if (!notification || notification.userId !== req.user.userId) throw new DomainError(`Notification ${id} not found`, 404);
    notification.markRead();
    await notificationRepository.save(notification);
    res.json({ notification: toDto(notification), unreadCount: await notificationRepository.countUnread(req.user.userId) });
  },
};
