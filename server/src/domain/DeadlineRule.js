const HOUR_MS = 3600 * 1000;

export class DeadlineRule {
  constructor({ priority, resolutionHours, escalationIntervalHours }) {
    this.priority = priority;
    this.resolutionHours = resolutionHours;
    this.escalationIntervalHours = escalationIntervalHours;
  }

  // dueAt = start + resolutionHours (docs/01). Callers pass createdAt (or "now" at creation).
  calculateDueAt(start) {
    return new Date(new Date(start).getTime() + this.resolutionHours * HOUR_MS);
  }
}
