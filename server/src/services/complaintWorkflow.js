// The one way complaints are created or changed. Each call is a single database transaction:
//   lock the row -> run the domain operation -> save complaint + StatusUpdate/Feedback/Escalation
//   rows -> save the notifications. If anything throws (e.g. an illegal transition, 409), nothing
//   is written. Used by every controller that changes a complaint.
import { withTransaction } from '../db.js';
import { complaintRepository } from '../repositories/complaintRepository.js';
import { notificationService } from './NotificationService.js';
import { DomainError } from '../domain/index.js';

// Saves a brand-new Complaint (built with Complaint.create). Returns its id.
export function createComplaint(complaint) {
  return withTransaction(async (conn) => {
    const outbox = await complaintRepository.save(complaint, conn);
    await notificationService.dispatch(outbox.notifications, complaint.complaintId, conn);
    return complaint.complaintId;
  });
}

// Loads complaint `id` with a row lock, calls `mutate(complaint, conn)` (which uses domain
// operations such as complaint.assignTo(...)) and saves the result. Returns the updated entity.
// Concurrent calls on the same complaint run one after the other.
export function updateComplaint(complaintId, mutate) {
  return withTransaction(async (conn) => {
    const complaint = await complaintRepository.findById(complaintId, { conn, forUpdate: true });
    if (!complaint) throw new DomainError(`Complaint ${complaintId} not found`, 404);
    await mutate(complaint, conn);
    const outbox = await complaintRepository.save(complaint, conn);
    await notificationService.dispatch(outbox.notifications, complaint.complaintId, conn);
    return complaint;
  });
}
