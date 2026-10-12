// One describe block per row of docs/04-state-machine.md (happy path + guards + wrong actor),
// then the illegal-transition tests. Rows are numbered exactly as in that table.
import {
  transition, createComplaint, validateRaiseDetails, isLegalMove, eventsFrom, TRANSITIONS, EVENTS,
  ComplaintStatus as S, TIMER, ForbiddenActionError, IllegalTransitionError, ValidationError, DomainError,
} from '../src/domain/index.js';
import {
  NOW, hoursFromNow, rules, hvac, mess, student, otherStudent, faculty, supervisor, admin,
  hvacStaff, otherHvacStaff, busyHvacStaff, plumber, complaintIn, makeComplaint,
} from './helpers/fixtures.js';

// Runs one event against a complaint and returns the TransitionResult.
const run = (event, complaint, actor, payload = {}, now = NOW) =>
  transition(event, { complaint, category: complaint.category, actor, payload, now, deadlineRule: complaint.deadlineRule });

const toUser = (id) => ({ kind: 'USER', userId: id });
const recipients = (result) => result.notifications.map((n) => n.recipient);

describe('the table has all 14 rows', () => {
  test('rows 2..14 are in TRANSITIONS exactly once; row 1 is createComplaint', () => {
    expect(TRANSITIONS.map((t) => t.row).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(createComplaint({
      details: { categoryId: 4, locationId: 1, description: 'x' }, reporter: student, category: hvac, deadlineRule: rules.MEDIUM, now: NOW,
    }).row).toBe(1);
  });

  test('from -> to pairs match docs/04 exactly', () => {
    const pairs = TRANSITIONS.flatMap((t) => t.from.map((f) => `${t.row}:${f}>${t.to}`)).sort();
    const expected = [
      '2:SUBMITTED>INVALID', '3:SUBMITTED>ASSIGNED', '4:REOPENED>ASSIGNED', '5:ASSIGNED>IN_PROGRESS',
      '6:IN_PROGRESS>ON_HOLD', '7:ON_HOLD>IN_PROGRESS', '8:IN_PROGRESS>RESOLVED', '9:RESOLVED>CLOSED',
      '10:RESOLVED>REOPENED', '11:RESOLVED>CLOSED',
      // row 12: any Open state ("Open" = SUBMITTED, ASSIGNED, IN_PROGRESS, ON_HOLD, REOPENED)
      '12:SUBMITTED>ESCALATED', '12:ASSIGNED>ESCALATED', '12:IN_PROGRESS>ESCALATED', '12:ON_HOLD>ESCALATED', '12:REOPENED>ESCALATED',
      '13:ESCALATED>ESCALATED', '14:ESCALATED>ASSIGNED',
    ].sort();
    expect(pairs).toEqual(expected);
  });
});

describe('row 1: raiseComplaint (initial -> SUBMITTED)', () => {
  const raise = (details, over = {}) => createComplaint({
    details, reporter: student, category: hvac, deadlineRule: rules.MEDIUM, now: NOW, ...over,
  });
  const details = { categoryId: 4, locationId: 1, title: 'Ceiling fan not working', description: 'Fan does not start' };

  test('sets SUBMITTED, priority = category default, dueAt = createdAt + resolutionHours', () => {
    const r = raise(details);
    expect(r.toStatus).toBe(S.SUBMITTED);
    expect(r.fields.priority).toBe('MEDIUM');
    expect(r.fields.dueAt).toEqual(hoursFromNow(48));
    expect(r.fields.createdAt).toEqual(NOW);
    expect(r.fields.reporterId).toBe(student.userId);
  });

  test('notifies all supervisors for INFRASTRUCTURE and all administrators for SERVICE', () => {
    expect(raise(details).notifications[0].recipient).toEqual({ kind: 'ALL_SUPERVISORS' });
    const service = raise({ ...details, categoryId: 8 }, { category: mess });
    expect(service.notifications[0].recipient).toEqual({ kind: 'ALL_ADMINISTRATORS' });
  });

  test('faculty can raise too', () => {
    expect(raise(details, { reporter: faculty }).fields.reporterId).toBe(faculty.userId);
  });

  test('US-01: fails without category and location, with a message per field', () => {
    expect.assertions(4);
    try {
      raise({ description: 'Fan does not start' });
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.httpStatus).toBe(400);
      expect(e.details).toHaveProperty('categoryId');
      expect(e.details).toHaveProperty('locationId');
    }
  });

  test('description is required; blank title falls back to the start of the description', () => {
    expect(() => raise({ ...details, description: '   ' })).toThrow(ValidationError);
    expect(validateRaiseDetails({ ...details, title: '' }).title).toBe('Fan does not start');
  });

  test('title longer than 150 characters is rejected', () => {
    expect(() => validateRaiseDetails({ ...details, title: 'x'.repeat(151) })).toThrow(ValidationError);
  });

  test('only students and faculty can raise', () => {
    expect(() => raise(details, { reporter: supervisor })).toThrow(ForbiddenActionError);
  });
});

describe('row 2: markInvalid (SUBMITTED -> INVALID)', () => {
  test('supervisor with a reason: INVALID, reporter notified, StatusUpdate written', () => {
    const r = run('markInvalid', complaintIn('SUBMITTED'), supervisor, { reason: 'Duplicate of #3' });
    expect(r).toMatchObject({ row: 2, fromStatus: 'SUBMITTED', toStatus: 'INVALID', statusUpdate: true, remarks: 'Duplicate of #3' });
    expect(recipients(r)).toEqual([toUser(student.userId)]);
  });
  test('reason is required', () => {
    expect(() => run('markInvalid', complaintIn('SUBMITTED'), supervisor, { reason: ' ' })).toThrow(ValidationError);
  });
  test('only a supervisor may do it', () => {
    expect(() => run('markInvalid', complaintIn('SUBMITTED'), student, { reason: 'x' })).toThrow(ForbiddenActionError);
    expect(() => run('markInvalid', complaintIn('SUBMITTED'), hvacStaff, { reason: 'x' })).toThrow(ForbiddenActionError);
  });
});

describe('row 3: assign (SUBMITTED -> ASSIGNED)', () => {
  test('US-06: supervisor assigns eligible staff; assignee and reporter are notified', () => {
    const r = run('assign', complaintIn('SUBMITTED'), supervisor, { staff: hvacStaff });
    expect(r).toMatchObject({ row: 3, toStatus: 'ASSIGNED', statusUpdate: true });
    expect(r.changes).toEqual({ assigneeId: hvacStaff.userId, supervisorId: supervisor.userId });
    expect(recipients(r)).toEqual([toUser(hvacStaff.userId), toUser(student.userId)]);
  });
  test('staff whose trade differs from the category name is refused (409)', () => {
    expect(() => run('assign', complaintIn('SUBMITTED'), supervisor, { staff: plumber })).toThrow(IllegalTransitionError);
  });
  test('unavailable staff are refused (409)', () => {
    expect(() => run('assign', complaintIn('SUBMITTED'), supervisor, { staff: busyHvacStaff })).toThrow(/not available/);
  });
  test('staff is required', () => {
    expect(() => run('assign', complaintIn('SUBMITTED'), supervisor, {})).toThrow(ValidationError);
  });
  test('only a supervisor assigns INFRASTRUCTURE complaints', () => {
    expect(() => run('assign', complaintIn('SUBMITTED'), admin, { staff: hvacStaff })).toThrow(ForbiddenActionError);
    expect(() => run('assign', complaintIn('SUBMITTED'), student, { staff: hvacStaff })).toThrow(ForbiddenActionError);
  });
  describe('US-11: SERVICE complaints', () => {
    const service = () => makeComplaint({ category: mess, categoryId: 8 });
    test('the Administrator assigns it (to an Administrator); supervisorId stays null', () => {
      const r = run('assign', service(), admin, { staff: admin });
      expect(r.toStatus).toBe('ASSIGNED');
      expect(r.changes).toEqual({ assigneeId: admin.userId, supervisorId: null });
    });
    test('never to maintenance staff', () => {
      expect(() => run('assign', service(), admin, { staff: hvacStaff })).toThrow(/only be assigned to an Administrator/);
    });
    test('a supervisor cannot assign a SERVICE complaint', () => {
      expect(() => run('assign', service(), supervisor, { staff: admin })).toThrow(ForbiddenActionError);
    });
  });
});

describe('row 4: assign (REOPENED -> ASSIGNED)', () => {
  test('same guard as row 3; only the assignee is notified', () => {
    const r = run('assign', complaintIn('REOPENED'), supervisor, { staff: otherHvacStaff });
    expect(r).toMatchObject({ row: 4, fromStatus: 'REOPENED', toStatus: 'ASSIGNED' });
    expect(r.changes.assigneeId).toBe(otherHvacStaff.userId);
    expect(recipients(r)).toEqual([toUser(otherHvacStaff.userId)]);
  });
  test('wrong-trade staff refused', () => {
    expect(() => run('assign', complaintIn('REOPENED'), supervisor, { staff: plumber })).toThrow(IllegalTransitionError);
  });
});

describe('row 5: startWork (ASSIGNED -> IN_PROGRESS)', () => {
  test('the assignee starts work', () => {
    const r = run('startWork', complaintIn('ASSIGNED'), hvacStaff);
    expect(r).toMatchObject({ row: 5, toStatus: 'IN_PROGRESS', statusUpdate: true, updatedBy: hvacStaff.userId });
  });
  test('staff starting work on a complaint not assigned to them is refused (403)', () => {
    expect(() => run('startWork', complaintIn('ASSIGNED'), otherHvacStaff)).toThrow(ForbiddenActionError);
  });
  test('reporter and supervisor cannot start work', () => {
    expect(() => run('startWork', complaintIn('ASSIGNED'), student)).toThrow(ForbiddenActionError);
    expect(() => run('startWork', complaintIn('ASSIGNED'), supervisor)).toThrow(ForbiddenActionError);
  });
});

describe('row 6: partsNeeded (IN_PROGRESS -> ON_HOLD)', () => {
  test('assignee puts it on hold with a reason', () => {
    const r = run('partsNeeded', complaintIn('IN_PROGRESS'), hvacStaff, { reason: 'waiting for capacitor' });
    expect(r).toMatchObject({ row: 6, toStatus: 'ON_HOLD', remarks: 'waiting for capacitor' });
  });
  test('reason is required (US-07)', () => {
    expect(() => run('partsNeeded', complaintIn('IN_PROGRESS'), hvacStaff, {})).toThrow(ValidationError);
  });
  test('only the assignee', () => {
    expect(() => run('partsNeeded', complaintIn('IN_PROGRESS'), otherHvacStaff, { reason: 'x' })).toThrow(ForbiddenActionError);
  });
});

describe('row 7: partsReceived (ON_HOLD -> IN_PROGRESS)', () => {
  test('assignee resumes', () => {
    expect(run('partsReceived', complaintIn('ON_HOLD'), hvacStaff)).toMatchObject({ row: 7, toStatus: 'IN_PROGRESS' });
  });
  test('only the assignee', () => {
    expect(() => run('partsReceived', complaintIn('ON_HOLD'), otherHvacStaff)).toThrow(ForbiddenActionError);
  });
});

describe('row 8: markResolved (IN_PROGRESS -> RESOLVED)', () => {
  test('sets resolvedAt = now and notifies the reporter to confirm', () => {
    const r = run('markResolved', complaintIn('IN_PROGRESS'), hvacStaff, { remarks: 'Replaced capacitor' });
    expect(r).toMatchObject({ row: 8, toStatus: 'RESOLVED', remarks: 'Replaced capacitor' });
    expect(r.changes.resolvedAt).toEqual(NOW);
    expect(recipients(r)).toEqual([toUser(student.userId)]);
  });
  test('remarks are required (US-07)', () => {
    expect(() => run('markResolved', complaintIn('IN_PROGRESS'), hvacStaff, {})).toThrow(ValidationError);
  });
  test('only the assignee', () => {
    expect(() => run('markResolved', complaintIn('IN_PROGRESS'), otherHvacStaff, { remarks: 'x' })).toThrow(ForbiddenActionError);
  });
});

describe('row 9: confirm (RESOLVED -> CLOSED)', () => {
  test('US-08: rating 1..5 closes, records Feedback(isFixed = true), sets closedAt', () => {
    const r = run('confirm', complaintIn('RESOLVED'), student, { rating: 4, comment: 'Works well' });
    expect(r).toMatchObject({ row: 9, toStatus: 'CLOSED', statusUpdate: true });
    expect(r.feedback).toEqual({ isFixed: true, rating: 4, comment: 'Works well', givenAt: NOW });
    expect(r.changes.closedAt).toEqual(NOW);
  });
  test.each([1, 5])('rating %i is accepted', (rating) => {
    expect(run('confirm', complaintIn('RESOLVED'), student, { rating }).feedback.rating).toBe(rating);
  });
  test.each([0, 6, -1, 3.5, '4', null, undefined, NaN])('rating %p is refused (400)', (rating) => {
    expect(() => run('confirm', complaintIn('RESOLVED'), student, { rating })).toThrow(ValidationError);
  });
  test('a non-reporter cannot confirm', () => {
    expect(() => run('confirm', complaintIn('RESOLVED'), otherStudent, { rating: 5 })).toThrow(ForbiddenActionError);
    expect(() => run('confirm', complaintIn('RESOLVED'), supervisor, { rating: 5 })).toThrow(ForbiddenActionError);
    expect(() => run('confirm', complaintIn('RESOLVED'), hvacStaff, { rating: 5 })).toThrow(ForbiddenActionError);
  });
});

describe('row 10: rejectFix (RESOLVED -> REOPENED)', () => {
  test('reopens with Feedback(isFixed = false), reopenCount + 1, notifies the supervisor', () => {
    const r = run('rejectFix', complaintIn('RESOLVED'), student, { reason: 'Still not working' });
    expect(r).toMatchObject({ row: 10, toStatus: 'REOPENED', remarks: 'Still not working' });
    expect(r.feedback).toEqual({ isFixed: false, rating: null, comment: 'Still not working', givenAt: NOW });
    expect(r.changes.reopenCount).toBe(1);
    expect(recipients(r)).toEqual([toUser(supervisor.userId)]);
  });
  test('increments an existing reopenCount', () => {
    expect(run('rejectFix', complaintIn('RESOLVED', { reopenCount: 2 }), student, { reason: 'x' }).changes.reopenCount).toBe(3);
  });
  test('kickoff decision: dueAt restarts from now and escalationLevel resets', () => {
    const r = run('rejectFix', complaintIn('RESOLVED', { escalationLevel: 2 }), student, { reason: 'x' });
    expect(r.changes.dueAt).toEqual(hoursFromNow(48));
    expect(r.changes.escalationLevel).toBe(0);
  });
  test('SERVICE complaints notify the Administrators (they have no supervisor)', () => {
    const c = complaintIn('RESOLVED', { category: mess, categoryId: 8, assigneeId: admin.userId, supervisorId: null });
    expect(recipients(run('rejectFix', c, student, { reason: 'x' }))).toEqual([{ kind: 'ALL_ADMINISTRATORS' }]);
  });
  test('reason is required', () => {
    expect(() => run('rejectFix', complaintIn('RESOLVED'), student, { reason: '' })).toThrow(ValidationError);
  });
  test('a non-reporter cannot reject', () => {
    expect(() => run('rejectFix', complaintIn('RESOLVED'), otherStudent, { reason: 'x' })).toThrow(ForbiddenActionError);
  });
});

describe('row 11: autoClose (RESOLVED -> CLOSED after 48 hours)', () => {
  test('the Timer closes it once 48 h have passed since resolvedAt; no Feedback is created', () => {
    const c = complaintIn('RESOLVED', { resolvedAt: hoursFromNow(-48) });
    const r = run('autoClose', c, TIMER);
    expect(r).toMatchObject({ row: 11, toStatus: 'CLOSED', statusUpdate: true, updatedBy: null });
    expect(r.changes.closedAt).toEqual(NOW);
    expect(r.feedback).toBeNull();
  });
  test('49 hours (the demo seed) is enough', () => {
    expect(run('autoClose', complaintIn('RESOLVED', { resolvedAt: hoursFromNow(-49) }), TIMER).toStatus).toBe('CLOSED');
  });
  test('refused before 48 hours (409)', () => {
    const c = complaintIn('RESOLVED', { resolvedAt: new Date(hoursFromNow(-48).getTime() + 1000) });
    expect(() => run('autoClose', c, TIMER)).toThrow(IllegalTransitionError);
  });
  test('only the Timer', () => {
    const c = complaintIn('RESOLVED', { resolvedAt: hoursFromNow(-60) });
    expect(() => run('autoClose', c, student)).toThrow(ForbiddenActionError);
    expect(() => run('autoClose', c, admin)).toThrow(ForbiddenActionError);
  });
});

describe('row 12: escalate (any Open state -> ESCALATED when now > dueAt)', () => {
  const overdue = (status) => complaintIn(status, { dueAt: hoursFromNow(-6) });

  test.each(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'])('from %s: level 1, Escalation saved, supervisor notified', (status) => {
    const r = run('escalate', overdue(status), TIMER);
    expect(r).toMatchObject({ row: 12, fromStatus: status, toStatus: 'ESCALATED', statusUpdate: true });
    expect(r.changes).toEqual({ escalationLevel: 1, lastEscalatedAt: NOW });
    expect(r.escalation).toMatchObject({ level: 1, reason: 'Complaint overdue' });
    // Once assigned the complaint has its own supervisor; a SUBMITTED one has none yet (see next test).
    const expected = status === 'SUBMITTED' ? { kind: 'ALL_SUPERVISORS' } : toUser(supervisor.userId);
    expect(r.escalation.notifications.map((n) => n.recipient)).toEqual([expected]);
  });
  test('an unassigned SUBMITTED complaint notifies every supervisor', () => {
    expect(run('escalate', overdue('SUBMITTED'), TIMER).escalation.notifications[0].recipient).toEqual({ kind: 'ALL_SUPERVISORS' });
  });
  test('a SERVICE complaint notifies the Administrators', () => {
    const c = complaintIn('ASSIGNED', { category: mess, categoryId: 8, dueAt: hoursFromNow(-1), supervisorId: null, assigneeId: admin.userId });
    expect(run('escalate', c, TIMER).escalation.notifications[0].recipient).toEqual({ kind: 'ALL_ADMINISTRATORS' });
  });
  test('not overdue: refused (409). Exactly due is not yet overdue', () => {
    expect(() => run('escalate', complaintIn('ASSIGNED', { dueAt: hoursFromNow(1) }), TIMER)).toThrow(/not overdue/);
    expect(() => run('escalate', complaintIn('ASSIGNED', { dueAt: NOW }), TIMER)).toThrow(IllegalTransitionError);
  });
  test('only the Timer', () => {
    expect(() => run('escalate', overdue('ASSIGNED'), supervisor)).toThrow(ForbiddenActionError);
  });
});

describe('row 13: reescalate (ESCALATED -> ESCALATED after escalationIntervalHours)', () => {
  const escalated = (level, lastHoursAgo) =>
    complaintIn('ESCALATED', { dueAt: hoursFromNow(-30), escalationLevel: level, lastEscalatedAt: hoursFromNow(-lastHoursAgo) });

  test('US-09: 25 hours after level 1 -> level 2; supervisor AND Administrator notified', () => {
    const r = run('reescalate', escalated(1, 25), TIMER);
    expect(r).toMatchObject({ row: 13, fromStatus: 'ESCALATED', toStatus: 'ESCALATED' });
    expect(r.changes).toEqual({ escalationLevel: 2, lastEscalatedAt: NOW });
    expect(r.escalation.level).toBe(2);
    expect(r.escalation.notifications.map((n) => n.recipient)).toEqual([toUser(supervisor.userId), { kind: 'ALL_ADMINISTRATORS' }]);
  });
  test('writes NO StatusUpdate (status unchanged)', () => {
    expect(run('reescalate', escalated(1, 25), TIMER).statusUpdate).toBe(false);
  });
  test('each further interval adds a level', () => {
    expect(run('reescalate', escalated(2, 24), TIMER).escalation.level).toBe(3);
  });
  test('SERVICE complaint: Administrator notified once (no duplicate)', () => {
    const c = complaintIn('ESCALATED', { category: mess, categoryId: 8, supervisorId: null, assigneeId: admin.userId, escalationLevel: 1, lastEscalatedAt: hoursFromNow(-25) });
    expect(run('reescalate', c, TIMER).escalation.notifications).toHaveLength(1);
  });
  test('refused before the interval has passed (409)', () => {
    expect(() => run('reescalate', escalated(1, 23), TIMER)).toThrow(IllegalTransitionError);
  });
  test('uses the complaint priority rule interval', () => {
    const c = escalated(1, 10);
    c.deadlineRule = { ...rules.HIGH, escalationIntervalHours: 6 };
    expect(run('reescalate', c, TIMER).escalation.level).toBe(2);
  });
  test('only the Timer', () => {
    expect(() => run('reescalate', escalated(1, 30), supervisor)).toThrow(ForbiddenActionError);
  });
});

describe('row 14: resolveEscalation (ESCALATED -> ASSIGNED)', () => {
  const escalated = (over = {}) => complaintIn('ESCALATED', { dueAt: hoursFromNow(-30), escalationLevel: 2, ...over });

  test('reassign: new assignee, fresh dueAt, level back to 0, assignee notified', () => {
    const r = run('resolveEscalation', escalated(), supervisor, { action: 'reassign', staff: otherHvacStaff });
    expect(r).toMatchObject({ row: 14, fromStatus: 'ESCALATED', toStatus: 'ASSIGNED', statusUpdate: true });
    expect(r.changes).toEqual({ assigneeId: otherHvacStaff.userId, supervisorId: supervisor.userId, dueAt: hoursFromNow(48), escalationLevel: 0 });
    expect(recipients(r)).toEqual([toUser(otherHvacStaff.userId)]);
  });
  test('reassign applies the same trade / availability guard', () => {
    expect(() => run('resolveEscalation', escalated(), supervisor, { action: 'reassign', staff: plumber })).toThrow(IllegalTransitionError);
    expect(() => run('resolveEscalation', escalated(), supervisor, { action: 'reassign', staff: busyHvacStaff })).toThrow(IllegalTransitionError);
  });
  test('extend: keeps the assignee, sets dueAt = newDueAt, resets level, notifies the assignee', () => {
    const newDueAt = hoursFromNow(12);
    const r = run('resolveEscalation', escalated(), supervisor, { action: 'extend', newDueAt, reason: 'Parts on order' });
    expect(r.toStatus).toBe('ASSIGNED');
    expect(r.changes).toEqual({ dueAt: newDueAt, escalationLevel: 0 });
    expect(r.remarks).toContain('Parts on order');
    expect(recipients(r)).toEqual([toUser(hvacStaff.userId)]);
  });
  test('extend needs a reason and a future date', () => {
    expect(() => run('resolveEscalation', escalated(), supervisor, { action: 'extend', newDueAt: hoursFromNow(12) })).toThrow(ValidationError);
    expect(() => run('resolveEscalation', escalated(), supervisor, { action: 'extend', newDueAt: hoursFromNow(-1), reason: 'x' })).toThrow(ValidationError);
    expect(() => run('resolveEscalation', escalated(), supervisor, { action: 'extend', newDueAt: 'not a date', reason: 'x' })).toThrow(ValidationError);
  });
  test('extend on an unassigned complaint is refused; it must be reassigned', () => {
    expect(() => run('resolveEscalation', escalated({ assigneeId: null }), supervisor, { action: 'extend', newDueAt: hoursFromNow(5), reason: 'x' }))
      .toThrow(/unassigned/);
    expect(run('resolveEscalation', escalated({ assigneeId: null }), supervisor, { action: 'reassign', staff: hvacStaff }).toStatus).toBe('ASSIGNED');
  });
  test('unknown action is a 400', () => {
    expect(() => run('resolveEscalation', escalated(), supervisor, { action: 'ignore' })).toThrow(ValidationError);
    expect(() => run('resolveEscalation', escalated(), supervisor, {})).toThrow(ValidationError);
  });
  test('only the supervisor (the Administrator for SERVICE)', () => {
    expect(() => run('resolveEscalation', escalated(), student, { action: 'reassign', staff: hvacStaff })).toThrow(ForbiddenActionError);
    expect(() => run('resolveEscalation', escalated(), admin, { action: 'reassign', staff: hvacStaff })).toThrow(ForbiddenActionError);
    const service = complaintIn('ESCALATED', { category: mess, categoryId: 8, supervisorId: null, assigneeId: admin.userId, dueAt: hoursFromNow(-3) });
    expect(run('resolveEscalation', service, admin, { action: 'extend', newDueAt: hoursFromNow(6), reason: 'vendor visit' }).toStatus).toBe('ASSIGNED');
  });
});

describe('illegal transitions are rejected with HTTP 409', () => {
  const illegal = (fn) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(IllegalTransitionError);
      expect(e.httpStatus).toBe(409);
      expect(e.message).toMatch(/Cannot/);
      return;
    }
    throw new Error('expected an IllegalTransitionError');
  };

  test('CLOSED -> REOPENED', () => {
    illegal(() => run('rejectFix', complaintIn('CLOSED'), student, { reason: 'x' }));
  });
  test('SUBMITTED -> RESOLVED', () => {
    illegal(() => run('markResolved', complaintIn('SUBMITTED'), hvacStaff, { remarks: 'x' }));
  });
  test('ASSIGNED -> RESOLVED (must start work first)', () => {
    illegal(() => run('markResolved', complaintIn('ASSIGNED'), hvacStaff, { remarks: 'x' }));
  });
  test('SUBMITTED -> CLOSED (confirm before it was resolved)', () => {
    illegal(() => run('confirm', complaintIn('SUBMITTED'), student, { rating: 5 }));
  });
  test('ON_HOLD -> RESOLVED', () => {
    illegal(() => run('markResolved', complaintIn('ON_HOLD'), hvacStaff, { remarks: 'x' }));
  });
  test('ASSIGNED -> ASSIGNED (assign twice)', () => {
    illegal(() => run('assign', complaintIn('ASSIGNED'), supervisor, { staff: hvacStaff }));
  });
  test('INVALID is final: nothing leaves it', () => {
    for (const event of EVENTS) {
      illegal(() => run(event, complaintIn('INVALID'), supervisor, {}));
    }
  });
  test('CLOSED is final: nothing leaves it', () => {
    for (const event of EVENTS) {
      illegal(() => run(event, complaintIn('CLOSED'), supervisor, {}));
    }
  });
  test('ESCALATED complaints cannot be worked on until the escalation is resolved', () => {
    illegal(() => run('startWork', complaintIn('ESCALATED'), hvacStaff));
    illegal(() => run('markResolved', complaintIn('ESCALATED'), hvacStaff, { remarks: 'x' }));
    illegal(() => run('markInvalid', complaintIn('ESCALATED'), supervisor, { reason: 'x' }));
  });
  test('a RESOLVED complaint is not escalated even when past dueAt', () => {
    illegal(() => run('escalate', complaintIn('RESOLVED', { dueAt: hoursFromNow(-100) }), TIMER));
  });

  // Exhaustive proof: for every event and every status that is NOT one of that event's "from"
  // statuses, the state machine refuses with a 409. Together with the row tests above, no other
  // status change exists.
  test('every (status, event) pair outside the table is a 409', () => {
    let checked = 0;
    for (const event of EVENTS) {
      const allowed = new Set(TRANSITIONS.filter((t) => t.event === event).flatMap((t) => t.from));
      for (const status of Object.values(S)) {
        if (allowed.has(status)) continue;
        illegal(() => run(event, complaintIn(status), supervisor, {}));
        checked += 1;
      }
    }
    // 12 events x 9 statuses = 108 pairs, of which the 17 (event, from) pairs in the table are legal.
    expect(checked).toBe(EVENTS.length * Object.values(S).length - TRANSITIONS.flatMap((t) => t.from).length);
    expect(checked).toBe(91);
  });

  test('unknown events are a programming error, not a silent no-op', () => {
    expect(() => run('teleport', complaintIn('ASSIGNED'), supervisor)).toThrow(/Unknown complaint event/);
  });

  test('isLegalMove / eventsFrom agree with the table', () => {
    expect(isLegalMove('CLOSED', 'REOPENED')).toBe(false);
    expect(isLegalMove('SUBMITTED', 'RESOLVED')).toBe(false);
    expect(isLegalMove('RESOLVED', 'REOPENED')).toBe(true);
    expect(isLegalMove(null, 'SUBMITTED')).toBe(true);
    expect(isLegalMove(null, 'CLOSED')).toBe(false);
    expect(eventsFrom('CLOSED')).toEqual([]);
    expect(eventsFrom('INVALID')).toEqual([]);
    expect(eventsFrom('RESOLVED').sort()).toEqual(['autoClose', 'confirm', 'rejectFix']);
  });

  test('errors carry the HTTP status the API must send', () => {
    expect(new IllegalTransitionError('x').httpStatus).toBe(409);
    expect(new ForbiddenActionError('x').httpStatus).toBe(403);
    expect(new ValidationError('x').httpStatus).toBe(400);
    expect(new IllegalTransitionError('x')).toBeInstanceOf(DomainError);
  });
});

describe('text length limit (keeps oversized input a 400 instead of a database error)', () => {
  test('reason, remarks and comment over 2000 characters are rejected; 2000 is fine', () => {
    const long = 'x'.repeat(2001);
    expect(() => run('markInvalid', complaintIn('SUBMITTED'), supervisor, { reason: long })).toThrow(/reason is too long/);
    expect(() => run('markResolved', complaintIn('IN_PROGRESS'), hvacStaff, { remarks: long })).toThrow(ValidationError);
    expect(() => run('confirm', complaintIn('RESOLVED'), student, { rating: 5, comment: long })).toThrow(ValidationError);
    expect(run('markInvalid', complaintIn('SUBMITTED'), supervisor, { reason: 'x'.repeat(2000) }).toStatus).toBe('INVALID');
  });
});
