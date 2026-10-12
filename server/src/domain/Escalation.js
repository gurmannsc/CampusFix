// Created by Complaint.escalate(). The state machine decides WHO must be told (supervisor,
// plus Administrator from level 2) and stores that as `notifications`; notifyResponsible()
// then hands them to NotificationService, as in sd Escalate Overdue Complaint.
export class Escalation {
  constructor({ escalationId = null, complaintId = null, level, reason, escalatedAt, notifications = [] }) {
    this.escalationId = escalationId;
    this.complaintId = complaintId;
    this.level = level;
    this.reason = reason;
    this.escalatedAt = escalatedAt;
    this.notifications = notifications; // [{ recipient, message }]; see recipients in complaintStateMachine.js
  }

  // notificationService.send(recipient, message, complaintId): `recipient` is a user id
  // ({ kind: 'USER', userId }) or a group ({ kind: 'ALL_SUPERVISORS' | 'ALL_ADMINISTRATORS' }).
  async notifyResponsible(notificationService) {
    for (const { recipient, message } of this.notifications) {
      await notificationService.send(recipient, message, this.complaintId);
    }
  }
}
