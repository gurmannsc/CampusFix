// EscalationScheduler (sd Escalate Overdue Complaint). The Timer (node-cron) calls
// checkDeadlines(now) every DEADLINE_CHECK_MINUTES; the admin "Run deadline check" button
// calls the same method. One run does all the timer-driven transitions of docs/04:
//   row 12  Open complaint with now > dueAt            -> ESCALATED, level 1, supervisor notified
//   row 13  ESCALATED, escalation interval has passed  -> level + 1, supervisor and Administrator notified
//   row 11  RESOLVED for 48 hours without a response   -> CLOSED (auto-close)
// Every complaint is handled in its own transaction with a row lock, so one failing complaint
// does not stop the others, and a complaint that changed since it was selected is skipped.
import cron from 'node-cron';
import { config } from '../config.js';
import { DomainError, TIMER } from '../domain/index.js';
import { ComplaintList } from '../repositories/ComplaintList.js';
import { updateComplaint } from '../services/complaintWorkflow.js';
import { notificationService } from '../services/NotificationService.js';

// "Every n minutes" as a cron expression. 1 to 59 -> every n minutes; 60 and more -> every n/60 hours.
export function cronExpression(minutes) {
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error(`DEADLINE_CHECK_MINUTES must be a whole number of minutes, or 0 to switch the timer off (got ${minutes})`);
  if (minutes < 60) return `*/${minutes} * * * *`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `0 */${hours} * * *` : '0 0 * * *';
}

export class EscalationScheduler {
  #running = false;
  #task = null;

  // The collaborators can be replaced in tests.
  constructor({ complaintList = ComplaintList, workflow = updateComplaint, notifications = notificationService, minutes = config.deadlineCheckMinutes } = {}) {
    this.complaintList = complaintList;
    this.workflow = workflow;
    this.notifications = notifications;
    this.minutes = minutes;
  }

  get isScheduled() {
    return this.#task !== null;
  }

  // Starts the Timer. Returns false (and does nothing) when the interval is 0.
  start() {
    if (this.minutes === 0) {
      console.log('Deadline timer is off (DEADLINE_CHECK_MINUTES=0). Use the admin "Run deadline check" button.');
      return false;
    }
    if (this.#task) return true;
    this.#task = cron.schedule(cronExpression(this.minutes), async () => {
      try {
        const r = await this.checkDeadlines(new Date());
        const changed = r.escalated.length + r.reescalated.length + r.autoClosed.length;
        if (changed || r.failed.length) {
          console.log(`Deadline check: ${r.escalated.length} escalated, ${r.reescalated.length} escalated again, ${r.autoClosed.length} auto-closed, ${r.failed.length} failed`);
        }
      } catch (err) {
        if (!(err instanceof DomainError)) console.error('Deadline check failed:', err); // DomainError = a run was already in progress
      }
    });
    console.log(`Deadline timer started: checking every ${this.minutes} minute(s).`);
    return true;
  }

  stop() {
    this.#task?.stop();
    this.#task = null;
  }

  // Timer -> EscalationScheduler.checkDeadlines(now). Returns what happened, for logs and the demo button.
  async checkDeadlines(now = new Date()) {
    if (this.#running) throw new DomainError('A deadline check is already running', 409);
    this.#running = true;
    const result = { checkedAt: now, escalated: [], reescalated: [], autoClosed: [], skipped: [], failed: [] };
    try {
      // sd Escalate Overdue Complaint: findOverdue(now), then for each c: c.escalate() -> e.notifyResponsible()
      for (const c of await this.complaintList.findOverdue(now)) {
        let outcome;
        const ok = await this.#handle(result, c, async (complaint, conn) => {
          const wasEscalated = complaint.status === 'ESCALATED';
          const e = complaint.escalate({ actor: TIMER, now }); // row 12, or row 13 when already ESCALATED
          // Notifications use the transaction's own connection: they commit or roll back with the escalation.
          await e.notifyResponsible({ send: (recipient, message, complaintId) => this.notifications.send(recipient, message, complaintId, conn) });
          outcome = { complaintId: complaint.complaintId, title: complaint.title, level: e.level, wasEscalated };
        });
        if (ok) (outcome.wasEscalated ? result.reescalated : result.escalated).push({ complaintId: outcome.complaintId, title: outcome.title, level: outcome.level });
      }

      // Row 11, part of the same run (docs/05).
      for (const c of await this.complaintList.findAutoCloseable(now)) {
        let title;
        const ok = await this.#handle(result, c, (complaint) => {
          complaint.autoClose({ actor: TIMER, now });
          title = complaint.title;
        });
        if (ok) result.autoClosed.push({ complaintId: c.complaintId, title });
      }
      return result;
    } finally {
      this.#running = false;
    }
  }

  // Runs one complaint's change in its own transaction. A DomainError means the complaint is no longer in
  // the state we selected it in (someone resolved it meanwhile): skip. Anything else is a real failure.
  async #handle(result, snapshot, change) {
    try {
      await this.workflow(snapshot.complaintId, change);
      return true;
    } catch (err) {
      if (err instanceof DomainError) {
        result.skipped.push({ complaintId: snapshot.complaintId, reason: err.message });
      } else {
        console.error(`Deadline check failed for complaint ${snapshot.complaintId}:`, err);
        result.failed.push({ complaintId: snapshot.complaintId, error: err.message });
      }
      return false;
    }
  }
}

export const escalationScheduler = new EscalationScheduler();
