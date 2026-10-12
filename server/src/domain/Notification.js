export class Notification {
  constructor({ notificationId = null, userId, complaintId = null, message, isRead = false, sentAt }) {
    this.notificationId = notificationId;
    this.userId = userId;
    this.complaintId = complaintId;
    this.message = message;
    this.isRead = isRead;
    this.sentAt = sentAt;
  }

  // The notification endpoint (M7) saves the entity after calling this.
  markRead() {
    this.isRead = true;
  }
}
