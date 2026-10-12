// Complaint state machine: the ONLY place that decides whether a status change is legal.
// Mirrors the table in docs/04-state-machine.md (Figure 9 of the report); the `row` numbers below
// are that table's row numbers. Every route and the scheduler go through this module.
//
// The module is pure: it reads a complaint snapshot, checks the event, and returns a
// TransitionResult describing what must change. It does not touch the database or send
// anything; Complaint (domain/Complaint.js) applies the result and the controllers persist it.
//
// Order of checks in transition():
//   1. status  -> IllegalTransitionError (HTTP 409): the event is not legal from this status
//   2. who     -> ForbiddenActionError   (HTTP 403): wrong person / role for this event
//   3. guard   -> ValidationError (400) for bad input, IllegalTransitionError (409) for
//                 state guards (ineligible staff, not yet overdue, 48 h not elapsed)
import { ComplaintStatus as S, CategoryType, Role, OPEN_STATES, TIMER } from './enums.js';
import { IllegalTransitionError, ForbiddenActionError, ValidationError } from './errors.js';

export const AUTO_CLOSE_HOURS = 48; // docs/01: reporter has 48 h to respond to a RESOLVED complaint
const HOUR_MS = 3600 * 1000;
const hoursBetween = (later, earlier) => (new Date(later) - new Date(earlier)) / HOUR_MS;

// ---- small helpers --------------------------------------------------------------------------

const isBlank = (v) => typeof v !== 'string' || v.trim() === '';
function required(value, label) {
  if (isBlank(value)) throw new ValidationError(`${label} is required`);
}
const label = (c) => (c.complaintId ? `#${c.complaintId} "${c.title}"` : `"${c.title}"`);

// Notification recipients. They are descriptors; NotificationService resolves groups to users.
const user = (userId) => ({ kind: 'USER', userId });
const ALL_SUPERVISORS = { kind: 'ALL_SUPERVISORS' };
const ALL_ADMINISTRATORS = { kind: 'ALL_ADMINISTRATORS' };
// "The supervisor" of a complaint: its own supervisor once assigned, otherwise every supervisor.
// SERVICE complaints never involve a supervisor; the Administrator is told instead.
function supervisorOf(c, category) {
  if (category.type === CategoryType.SERVICE) return ALL_ADMINISTRATORS;
  return c.supervisorId ? user(c.supervisorId) : ALL_SUPERVISORS;
}
const note = (recipient, message) => ({ recipient, message });
function dedupe(notes) {
  const seen = new Set();
  return notes.filter((n) => {
    const key = JSON.stringify(n.recipient) + n.message;
    return seen.has(key) ? false : seen.add(key);
  });
}

// ---- "who" rules (the "Event (who)" column) -------------------------------------------------

const ACTORS = {
  REPORTER: {
    text: 'the reporter of the complaint',
    ok: (a, c) => a.userId != null && a.userId === c.reporterId && (a.role === Role.STUDENT || a.role === Role.FACULTY),
  },
  ASSIGNEE: {
    text: 'the assignee of the complaint',
    ok: (a, c) => a.userId != null && a.userId === c.assigneeId,
  },
  TIMER: { text: 'the Timer', ok: (a) => a.role === TIMER.role },
  // "Supervisor; Admin for SERVICE" (rows 3, 4, 14)
  HANDLER: {
    text: 'the supervisor (the administrator for SERVICE complaints)',
    ok: (a, c, category) => (category.type === CategoryType.SERVICE ? a.role === Role.ADMIN : a.role === Role.SUPERVISOR),
  },
};

// Guard of rows 3, 4 and 14(reassign): INFRASTRUCTURE needs staff whose trade equals the category
// name and who is available; SERVICE complaints can only go to an Administrator, never to staff.
function checkAssignable(staff, category) {
  if (!staff || staff.userId == null) throw new ValidationError('staff is required');
  if (category.type === CategoryType.SERVICE) {
    if (staff.role !== Role.ADMIN) {
      throw new IllegalTransitionError('SERVICE complaints can only be assigned to an Administrator');
    }
    return;
  }
  if (staff.role !== Role.STAFF || staff.trade !== category.name) {
    throw new IllegalTransitionError(`Assignee must be maintenance staff with trade "${category.name}"`);
  }
  if (!staff.isAvailable) throw new IllegalTransitionError('The selected staff member is not available');
}

// ---- the table ------------------------------------------------------------------------------
// Each entry: row, event, from (statuses), to, actor, guard(ctx), apply(ctx).
// ctx = { complaint, category, actor, payload, now, deadlineRule }.
// apply() returns { remarks, changes, feedback, escalation, notifications }.

const assignChanges = (ctx) => ({
  assigneeId: ctx.payload.staff.userId,
  // Only a Supervisor is recorded as supervisorId; an Administrator handling SERVICE leaves it NULL.
  supervisorId: ctx.actor.role === Role.SUPERVISOR ? ctx.actor.userId : ctx.complaint.supervisorId ?? null,
});

export const TRANSITIONS = [
  // Row 1 (initial -> SUBMITTED) is not here: it has no "from" status. See createComplaint() below.
  {
    row: 2, event: 'markInvalid', from: [S.SUBMITTED], to: S.INVALID, actor: 'HANDLER',
    guard: ({ payload }) => required(payload.reason, 'reason'),
    apply: ({ complaint: c, payload }) => ({
      remarks: payload.reason,
      notifications: [note(user(c.reporterId), `Your complaint ${label(c)} was marked invalid: ${payload.reason}`)],
    }),
  },
  {
    row: 3, event: 'assign', from: [S.SUBMITTED], to: S.ASSIGNED, actor: 'HANDLER',
    guard: ({ payload, category }) => checkAssignable(payload.staff, category),
    apply: (ctx) => ({
      changes: assignChanges(ctx),
      remarks: `Assigned to ${ctx.payload.staff.name ?? `user ${ctx.payload.staff.userId}`}`,
      notifications: [
        note(user(ctx.payload.staff.userId), `Complaint ${label(ctx.complaint)} has been assigned to you`),
        note(user(ctx.complaint.reporterId), `Your complaint ${label(ctx.complaint)} has been assigned`),
      ],
    }),
  },
  {
    row: 4, event: 'assign', from: [S.REOPENED], to: S.ASSIGNED, actor: 'HANDLER',
    guard: ({ payload, category }) => checkAssignable(payload.staff, category),
    apply: (ctx) => ({
      changes: assignChanges(ctx),
      remarks: `Reassigned to ${ctx.payload.staff.name ?? `user ${ctx.payload.staff.userId}`}`,
      notifications: [note(user(ctx.payload.staff.userId), `Reopened complaint ${label(ctx.complaint)} has been assigned to you`)],
    }),
  },
  { row: 5, event: 'startWork', from: [S.ASSIGNED], to: S.IN_PROGRESS, actor: 'ASSIGNEE', apply: () => ({}) },
  {
    row: 6, event: 'partsNeeded', from: [S.IN_PROGRESS], to: S.ON_HOLD, actor: 'ASSIGNEE',
    guard: ({ payload }) => required(payload.reason, 'reason'),
    apply: ({ payload }) => ({ remarks: payload.reason }),
  },
  { row: 7, event: 'partsReceived', from: [S.ON_HOLD], to: S.IN_PROGRESS, actor: 'ASSIGNEE', apply: () => ({}) },
  {
    row: 8, event: 'markResolved', from: [S.IN_PROGRESS], to: S.RESOLVED, actor: 'ASSIGNEE',
    guard: ({ payload }) => required(payload.remarks, 'remarks'),
    apply: ({ complaint: c, payload, now }) => ({
      changes: { resolvedAt: now },
      remarks: payload.remarks,
      notifications: [note(user(c.reporterId), `Complaint ${label(c)} was resolved. Please confirm or reject the fix`)],
    }),
  },
  {
    row: 9, event: 'confirm', from: [S.RESOLVED], to: S.CLOSED, actor: 'REPORTER',
    guard: ({ payload }) => {
      if (!(Number.isInteger(payload.rating) && payload.rating >= 1 && payload.rating <= 5)) {
        throw new ValidationError('rating must be a whole number from 1 to 5');
      }
    },
    apply: ({ payload, now }) => ({
      changes: { closedAt: now },
      feedback: { isFixed: true, rating: payload.rating, comment: payload.comment ?? null, givenAt: now },
      remarks: payload.comment ?? 'Confirmed by reporter',
    }),
  },
  {
    row: 10, event: 'rejectFix', from: [S.RESOLVED], to: S.REOPENED, actor: 'REPORTER',
    guard: ({ payload }) => required(payload.reason, 'reason'),
    apply: ({ complaint: c, category, payload, now, deadlineRule }) => ({
      // Kickoff decision: a reopened complaint gets a fresh deadline, otherwise it would be
      // overdue (and escalated) at the next timer tick. escalationLevel restarts from 0.
      changes: { reopenCount: c.reopenCount + 1, dueAt: deadlineRule.calculateDueAt(now), escalationLevel: 0 },
      feedback: { isFixed: false, rating: null, comment: payload.reason, givenAt: now },
      remarks: payload.reason,
      notifications: [note(supervisorOf(c, category), `Complaint ${label(c)} was reopened by the reporter`)],
    }),
  },
  {
    row: 11, event: 'autoClose', from: [S.RESOLVED], to: S.CLOSED, actor: 'TIMER',
    guard: ({ complaint: c, now }) => {
      if (!c.resolvedAt || hoursBetween(now, c.resolvedAt) < AUTO_CLOSE_HOURS) {
        throw new IllegalTransitionError(`Cannot auto-close: ${AUTO_CLOSE_HOURS} hours have not passed since the complaint was resolved`);
      }
    },
    apply: ({ now }) => ({
      changes: { closedAt: now },
      remarks: `Auto-closed after ${AUTO_CLOSE_HOURS} hours without a response`,
    }),
  },
  {
    row: 12, event: 'escalate', from: OPEN_STATES, to: S.ESCALATED, actor: 'TIMER',
    guard: ({ complaint: c, now }) => {
      if (!(new Date(now) > new Date(c.dueAt))) throw new IllegalTransitionError('Cannot escalate: the complaint is not overdue');
    },
    apply: ({ complaint: c, category, now }) => ({
      changes: { escalationLevel: 1, lastEscalatedAt: now },
      remarks: 'Overdue: escalated to level 1',
      escalation: {
        level: 1, reason: 'Complaint overdue', escalatedAt: now,
        notifications: [note(supervisorOf(c, category), `Complaint ${label(c)} is overdue`)],
      },
    }),
  },
  {
    // Self-transition: status stays ESCALATED, so no StatusUpdate row is written.
    row: 13, event: 'reescalate', from: [S.ESCALATED], to: S.ESCALATED, actor: 'TIMER', statusUpdate: false,
    guard: ({ complaint: c, now, deadlineRule }) => {
      if (!c.lastEscalatedAt) throw new IllegalTransitionError('Cannot escalate again: no previous escalation found');
      if (hoursBetween(now, c.lastEscalatedAt) < deadlineRule.escalationIntervalHours) {
        throw new IllegalTransitionError('Cannot escalate again: the escalation interval has not passed');
      }
    },
    apply: ({ complaint: c, category, now }) => {
      const level = c.escalationLevel + 1; // always >= 2 here, so the Administrator is told too
      const message = `Complaint ${label(c)} is still overdue (escalation level ${level})`;
      return {
        changes: { escalationLevel: level, lastEscalatedAt: now },
        remarks: `Still overdue: escalated to level ${level}`,
        escalation: {
          level, reason: 'Complaint still overdue', escalatedAt: now,
          notifications: dedupe([note(supervisorOf(c, category), message), note(ALL_ADMINISTRATORS, message)]),
        },
      };
    },
  },
  {
    row: 14, event: 'resolveEscalation', from: [S.ESCALATED], to: S.ASSIGNED, actor: 'HANDLER',
    guard: ({ complaint: c, category, payload, now }) => {
      if (payload.action === 'reassign') {
        checkAssignable(payload.staff, category);
      } else if (payload.action === 'extend') {
        required(payload.reason, 'reason');
        const due = new Date(payload.newDueAt);
        if (Number.isNaN(due.getTime()) || due <= new Date(now)) throw new ValidationError('newDueAt must be a date in the future');
        // An unassigned complaint (escalated straight from SUBMITTED) cannot go to ASSIGNED without an assignee.
        if (c.assigneeId == null) throw new IllegalTransitionError('Cannot extend an unassigned complaint; reassign it to a staff member instead');
      } else {
        throw new ValidationError('action must be "reassign" or "extend"');
      }
    },
    apply: (ctx) => {
      const { complaint: c, payload, now, deadlineRule } = ctx;
      if (payload.action === 'reassign') {
        return {
          // A reassigned complaint gets a fresh deadline (kickoff decision); level restarts at 0.
          changes: { ...assignChanges(ctx), dueAt: deadlineRule.calculateDueAt(now), escalationLevel: 0 },
          remarks: payload.reason ?? 'Reassigned after escalation',
          notifications: [note(user(payload.staff.userId), `Escalated complaint ${label(c)} has been reassigned to you`)],
        };
      }
      return {
        changes: { dueAt: new Date(payload.newDueAt), escalationLevel: 0 },
        remarks: `Deadline extended: ${payload.reason}`,
        notifications: [note(user(c.assigneeId), `Deadline of complaint ${label(c)} was extended`)],
      };
    },
  },
];

export const EVENTS = Object.freeze([...new Set(TRANSITIONS.map((t) => t.event))]);

// ---- queries --------------------------------------------------------------------------------

const LEGAL_MOVES = new Set([
  ...TRANSITIONS.flatMap((t) => t.from.map((f) => `${f}>${t.to}`)),
  `null>${S.SUBMITTED}`, // row 1
]);

// True if some row of the table allows going from `from` to `to`. Complaint.updateStatus uses this
// as a last line of defence so that no code path can reach a status the diagram does not allow.
export function isLegalMove(from, to) {
  return LEGAL_MOVES.has(`${from ?? null}>${to}`);
}

// Events that can be attempted from a status (the UI uses this to show buttons).
export function eventsFrom(status) {
  return [...new Set(TRANSITIONS.filter((t) => t.from.includes(status)).map((t) => t.event))];
}

// ---- transition -----------------------------------------------------------------------------

export function transition(event, { complaint, category, actor, payload = {}, now = new Date(), deadlineRule }) {
  const candidates = TRANSITIONS.filter((t) => t.event === event);
  if (candidates.length === 0) throw new Error(`Unknown complaint event "${event}"`);

  // 1. status
  const row = candidates.find((t) => t.from.includes(complaint.status));
  if (!row) {
    const allowed = [...new Set(candidates.flatMap((t) => t.from))].join(', ');
    throw new IllegalTransitionError(`Cannot ${event} a complaint that is ${complaint.status} (allowed from: ${allowed})`);
  }
  // 2. who
  const who = ACTORS[row.actor];
  if (!actor || !who.ok(actor, complaint, category)) {
    throw new ForbiddenActionError(`Only ${who.text} can ${event} this complaint`);
  }
  // 3. guard
  const ctx = { complaint, category, actor, payload, now, deadlineRule };
  row.guard?.(ctx);

  const out = row.apply(ctx);
  return {
    row: row.row,
    event,
    fromStatus: complaint.status,
    toStatus: row.to,
    statusUpdate: row.statusUpdate !== false, // false only for row 13
    updatedBy: actor.userId ?? null,
    remarks: out.remarks ?? null,
    changes: out.changes ?? {},
    feedback: out.feedback ?? null,
    escalation: out.escalation ?? null,
    notifications: out.notifications ?? [],
  };
}

// ---- row 1: raiseComplaint (initial -> SUBMITTED) ---------------------------------------------

// Guard of row 1 ("valid details"); also the `validate(details)` step of sd Raise Complaint.
// Returns normalised details, or throws ValidationError with a per-field `details` object.
export function validateRaiseDetails(details = {}) {
  const errors = {};
  const categoryId = Number(details.categoryId);
  const locationId = Number(details.locationId);
  if (!Number.isInteger(categoryId) || categoryId <= 0) errors.categoryId = 'category is required';
  if (!Number.isInteger(locationId) || locationId <= 0) errors.locationId = 'location is required';
  if (isBlank(details.description)) errors.description = 'description is required';
  if (details.title != null && typeof details.title !== 'string') errors.title = 'title must be text';
  if (typeof details.title === 'string' && details.title.length > 150) errors.title = 'title must be at most 150 characters';
  if (Object.keys(errors).length > 0) throw new ValidationError('Invalid complaint details', errors);

  const description = details.description.trim();
  const title = isBlank(details.title) ? description.slice(0, 60) : details.title.trim();
  return { categoryId, locationId, title, description };
}

// reporter: { userId, role }. deadlineRule must be the rule of category.getDefaultPriority().
export function createComplaint({ details, reporter, category, deadlineRule, now = new Date() }) {
  if (!reporter || (reporter.role !== Role.STUDENT && reporter.role !== Role.FACULTY)) {
    throw new ForbiddenActionError('Only students and faculty can raise complaints');
  }
  const valid = validateRaiseDetails(details);
  const priority = category.getDefaultPriority();
  if (deadlineRule.priority !== priority) throw new Error('deadlineRule does not match the category default priority');

  const fields = {
    ...valid,
    photoPath: details.photoPath ?? null,
    priority,
    status: S.SUBMITTED,
    createdAt: now,
    dueAt: deadlineRule.calculateDueAt(now),
    escalationLevel: 0,
    reopenCount: 0,
    reporterId: reporter.userId,
  };
  return {
    row: 1,
    event: 'raise',
    fromStatus: null,
    toStatus: S.SUBMITTED,
    statusUpdate: true,
    updatedBy: reporter.userId,
    remarks: null,
    fields,
    // Supervisors, or Administrators when the category type is SERVICE.
    notifications: [note(category.type === CategoryType.SERVICE ? ALL_ADMINISTRATORS : ALL_SUPERVISORS, `New complaint: "${fields.title}"`)],
  };
}
