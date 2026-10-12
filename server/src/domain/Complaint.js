// Complaint entity (class diagram, Figure 5). Its status can only change through
// complaintStateMachine.js: the status field has no setter, every operation below asks the
// state machine first, and updateStatus() re-checks that the move exists in the table.
//
// The entity does no I/O. Each change is recorded in `outbox` (StatusUpdate / Feedback /
// Escalation rows and notifications to send). Controllers save the complaint plus
// takeOutbox() in one database transaction.
//
// Differences from the diagram's signatures (listed in docs/DEVIATIONS.md):
//   - operations take a trailing context { actor, now } because the state machine checks "who"
//   - applyEvent() and reprioritise() are extra helpers for events the diagram has no method for
import { ComplaintStatus as S, OPEN_STATES, Priority } from './enums.js';
import { IllegalTransitionError, ValidationError } from './errors.js';
import { transition, createComplaint, isLegalMove } from './complaintStateMachine.js';
import { StatusUpdate } from './StatusUpdate.js';
import { Feedback } from './Feedback.js';
import { Escalation } from './Escalation.js';

// Fields the state machine is allowed to change besides status.
const MUTABLE_FIELDS = ['assigneeId', 'supervisorId', 'resolvedAt', 'closedAt', 'reopenCount', 'escalationLevel', 'dueAt', 'lastEscalatedAt'];

export class Complaint {
  #status;

  // category (Category) and deadlineRule (DeadlineRule) are the "belongs to" / "governed by" links.
  // lastEscalatedAt is the time of the newest Escalation row (needed for row 13).
  constructor({
    complaintId = null, title, description, photoPath = null, priority, status = S.SUBMITTED,
    createdAt, dueAt, resolvedAt = null, closedAt = null, escalationLevel = 0, reopenCount = 0,
    reporterId, categoryId, locationId, supervisorId = null, assigneeId = null, lastEscalatedAt = null,
    category, deadlineRule,
  }) {
    Object.assign(this, {
      complaintId, title, description, photoPath, priority, createdAt, dueAt, resolvedAt, closedAt,
      escalationLevel, reopenCount, reporterId, categoryId, locationId, supervisorId, assigneeId,
      lastEscalatedAt, category, deadlineRule,
    });
    this.#status = status;
    this.outbox = { statusUpdates: [], feedback: [], escalations: [], notifications: [] };
  }

  get status() {
    return this.#status;
  }

  // <<create>>(details, priority, dueAt) in sd Raise Complaint. The status is SUBMITTED and the
  // first StatusUpdate (null -> SUBMITTED) is queued. `outbox.notifications` holds "New complaint".
  static create({ details, reporter, category, deadlineRule, now = new Date() }) {
    const result = createComplaint({ details, reporter, category, deadlineRule, now });
    const complaint = new Complaint({ ...result.fields, category, deadlineRule });
    complaint.outbox.statusUpdates.push(new StatusUpdate({
      fromStatus: null, toStatus: S.SUBMITTED, remarks: null, updatedBy: result.updatedBy, updatedAt: now,
    }));
    complaint.outbox.notifications.push(...result.notifications);
    return complaint;
  }

  // Returns the queued rows and notifications and empties the outbox (call after saving).
  takeOutbox() {
    const out = this.outbox;
    this.outbox = { statusUpdates: [], feedback: [], escalations: [], notifications: [] };
    return out;
  }

  // ---- operations from the class diagram ----

  // Supervisor (or Administrator for SERVICE) assigns. `assignee` is the staff User (the guard needs
  // its trade and availability, so an id alone is not enough). Rows 3 and 4.
  assignTo(assignee, ctx) {
    return this.applyEvent('assign', { staff: assignee }, ctx);
  }

  // Low-level status setter used by the operations below. It refuses any move that is not in the
  // state machine table, so even a direct call cannot reach an illegal status.
  updateStatus(newStatus, { remarks = null, updatedBy = null, at = new Date() } = {}) {
    if (!isLegalMove(this.#status, newStatus)) {
      throw new IllegalTransitionError(`Illegal status change ${this.#status} -> ${newStatus}`);
    }
    this.outbox.statusUpdates.push(new StatusUpdate({
      fromStatus: this.#status, toStatus: newStatus, remarks, updatedBy, updatedAt: at,
    }));
    this.#status = newStatus;
  }

  markResolved(remarks, ctx) {
    return this.applyEvent('markResolved', { remarks }, ctx);
  }

  // sd Confirm Resolution, isFixed = true: confirm(rating, comment) -> updateStatus(CLOSED)
  confirm(rating, comment, ctx) {
    return this.applyEvent('confirm', { rating, comment }, ctx);
  }

  // sd Confirm Resolution, isFixed = false: reopen(reason) -> updateStatus(REOPENED)
  reopen(reason, ctx) {
    return this.applyEvent('rejectFix', { reason }, ctx);
  }

  // sd Escalate Overdue Complaint. Open -> ESCALATED (row 12) or a repeat escalation while already
  // ESCALATED (row 13). Returns the Escalation; the scheduler then calls e.notifyResponsible().
  escalate(ctx) {
    const event = this.#status === S.ESCALATED ? 'reescalate' : 'escalate';
    this.applyEvent(event, {}, ctx);
    return this.outbox.escalations[this.outbox.escalations.length - 1];
  }

  autoClose(ctx) {
    return this.applyEvent('autoClose', {}, ctx);
  }

  // Only Open complaints can be overdue; ESCALATED ones are handled by row 13 instead.
  isOverdue(now) {
    return OPEN_STATES.includes(this.#status) && new Date(now) > new Date(this.dueAt);
  }

  // ---- helpers ----

  // Runs any event of the state machine (startWork, partsNeeded, markInvalid, resolveEscalation, ...)
  // and applies the result. ctx = { actor: { userId, role }, now }.
  applyEvent(event, payload, { actor, now = new Date() } = {}) {
    const result = transition(event, {
      complaint: this, category: this.category, actor, payload, now, deadlineRule: this.deadlineRule,
    });
    this.#apply(result, now);
    return result;
  }

  #apply(result, now) {
    for (const key of Object.keys(result.changes)) {
      if (!MUTABLE_FIELDS.includes(key)) throw new Error(`State machine tried to change "${key}"`);
    }
    Object.assign(this, result.changes);
    // Row 13 is the only transition without a status change, and so without a StatusUpdate.
    if (result.statusUpdate) {
      this.updateStatus(result.toStatus, { remarks: result.remarks, updatedBy: result.updatedBy, at: now });
    }
    if (result.feedback) this.outbox.feedback.push(new Feedback({ complaintId: this.complaintId, ...result.feedback }));
    if (result.escalation) this.outbox.escalations.push(new Escalation({ complaintId: this.complaintId, ...result.escalation }));
    for (const n of result.notifications) {
      this.outbox.notifications.push({ recipient: n.recipient, message: n.message });
    }
  }

  // Supervisor changes the priority (US-05): dueAt is recalculated from createdAt (docs/01).
  // Not a status change, so it does not go through the state machine.
  reprioritise(priority, deadlineRule) {
    if (!Object.values(Priority).includes(priority) || deadlineRule?.priority !== priority) {
      throw new ValidationError('priority must be CRITICAL, HIGH, MEDIUM or LOW');
    }
    if ([S.INVALID, S.CLOSED, S.RESOLVED].includes(this.#status)) {
      throw new IllegalTransitionError(`Cannot change the priority of a ${this.#status} complaint`);
    }
    this.priority = priority;
    this.deadlineRule = deadlineRule;
    this.dueAt = deadlineRule.calculateDueAt(this.createdAt);
  }
}
