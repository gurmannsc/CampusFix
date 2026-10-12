// Complaint entity: operations from the class diagram, the outbox, and the sequence diagrams.
import {
  Complaint, ComplaintStatus as S, TIMER, ForbiddenActionError, IllegalTransitionError, ValidationError,
} from '../src/domain/index.js';
import {
  NOW, hoursFromNow, rules, hvac, mess, student, otherStudent, supervisor, admin, hvacStaff, otherHvacStaff,
  complaintIn, makeComplaint,
} from './helpers/fixtures.js';

const ctx = (actor, now = NOW) => ({ actor, now });
const trail = (c) => c.outbox.statusUpdates.map((u) => `${u.fromStatus}>${u.toStatus}`);

describe('sd Raise Complaint: Complaint.create', () => {
  const details = { categoryId: 4, locationId: 1, title: 'Ceiling fan not working', description: 'Fan does not start' };
  const create = (over = {}) => Complaint.create({ details, reporter: student, category: hvac, deadlineRule: rules.MEDIUM, now: NOW, ...over });

  test('creates a SUBMITTED complaint with priority and dueAt, and queues the first StatusUpdate', () => {
    const c = create();
    expect(c.status).toBe(S.SUBMITTED);
    expect(c).toMatchObject({ priority: 'MEDIUM', escalationLevel: 0, reopenCount: 0, reporterId: 1, categoryId: 4, locationId: 1 });
    expect(c.dueAt).toEqual(hoursFromNow(48));
    expect(c.outbox.statusUpdates).toHaveLength(1);
    expect(c.outbox.statusUpdates[0]).toMatchObject({ fromStatus: null, toStatus: 'SUBMITTED', updatedBy: 1 });
  });
  test('queues the "New complaint" notification', () => {
    expect(create().outbox.notifications).toEqual([{ recipient: { kind: 'ALL_SUPERVISORS' }, message: 'New complaint: "Ceiling fan not working"' }]);
    expect(create({ category: mess, details: { ...details, categoryId: 8 } }).outbox.notifications[0].recipient).toEqual({ kind: 'ALL_ADMINISTRATORS' });
  });
  test('US-04: a CRITICAL rule gives a 4-hour due date', () => {
    const crit = { ...hvac, getDefaultPriority: () => 'CRITICAL' };
    expect(Complaint.create({ details, reporter: student, category: crit, deadlineRule: rules.CRITICAL, now: NOW }).dueAt).toEqual(hoursFromNow(4));
  });
  test('invalid details create nothing', () => {
    expect(() => create({ details: { description: 'x' } })).toThrow(ValidationError);
  });
});

describe('status can only change through the state machine', () => {
  test('there is no status setter', () => {
    const c = makeComplaint();
    expect(() => { c.status = S.CLOSED; }).toThrow(TypeError);
    expect(c.status).toBe(S.SUBMITTED);
  });
  test('updateStatus refuses moves that are not in docs/04 (CLOSED -> REOPENED, SUBMITTED -> RESOLVED)', () => {
    expect(() => complaintIn('CLOSED').updateStatus(S.REOPENED)).toThrow(IllegalTransitionError);
    expect(() => complaintIn('SUBMITTED').updateStatus(S.RESOLVED)).toThrow(IllegalTransitionError);
    const c = complaintIn('SUBMITTED');
    expect(() => c.updateStatus(S.RESOLVED)).toThrow(/Illegal status change SUBMITTED -> RESOLVED/);
    expect(c.status).toBe(S.SUBMITTED);
    expect(c.outbox.statusUpdates).toHaveLength(0);
  });
  test('illegal event leaves the complaint untouched', () => {
    const c = complaintIn('SUBMITTED');
    expect(() => c.markResolved('done', ctx(hvacStaff))).toThrow(IllegalTransitionError);
    expect(c.status).toBe(S.SUBMITTED);
    expect(c.resolvedAt).toBeNull();
    expect(c.outbox.statusUpdates).toHaveLength(0);
  });
  test('a forbidden actor leaves the complaint untouched', () => {
    const c = complaintIn('RESOLVED');
    expect(() => c.confirm(5, null, ctx(otherStudent))).toThrow(ForbiddenActionError);
    expect(c.status).toBe(S.RESOLVED);
  });
});

describe('every status change writes exactly one StatusUpdate', () => {
  test('assignTo -> SUBMITTED to ASSIGNED, with updatedBy and remarks', () => {
    const c = makeComplaint();
    c.assignTo(hvacStaff, ctx(supervisor));
    expect(c.status).toBe(S.ASSIGNED);
    expect(c.assigneeId).toBe(hvacStaff.userId);
    expect(c.supervisorId).toBe(supervisor.userId);
    expect(c.outbox.statusUpdates).toHaveLength(1);
    expect(c.outbox.statusUpdates[0]).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'ASSIGNED', updatedBy: supervisor.userId, updatedAt: NOW });
  });
  test('escalate (row 12) writes one; repeat escalation (row 13) writes none', () => {
    const c = complaintIn('ASSIGNED', { dueAt: hoursFromNow(-6) });
    c.escalate(ctx(TIMER));
    expect(trail(c)).toEqual(['ASSIGNED>ESCALATED']);
    c.outbox.statusUpdates.length = 0;
    c.escalate(ctx(TIMER, hoursFromNow(25)));
    expect(c.status).toBe(S.ESCALATED);
    expect(c.escalationLevel).toBe(2);
    expect(c.outbox.statusUpdates).toHaveLength(0);
    expect(c.outbox.escalations).toHaveLength(2);
  });
});

describe('sd Confirm Resolution', () => {
  test('confirm(rating, comment): Feedback created, status CLOSED, closedAt set', () => {
    const c = complaintIn('RESOLVED');
    c.confirm(4, 'Works well', ctx(student));
    expect(c.status).toBe(S.CLOSED);
    expect(c.closedAt).toEqual(NOW);
    expect(c.outbox.feedback).toHaveLength(1);
    expect(c.outbox.feedback[0]).toMatchObject({ isFixed: true, rating: 4, comment: 'Works well', givenAt: NOW });
    expect(trail(c)).toEqual(['RESOLVED>CLOSED']);
  });
  test('reopen(reason): Feedback(isFixed = false), REOPENED, supervisor notified, reopenCount + 1', () => {
    const c = complaintIn('RESOLVED');
    c.reopen('Still broken', ctx(student));
    expect(c.status).toBe(S.REOPENED);
    expect(c.reopenCount).toBe(1);
    expect(c.outbox.feedback[0]).toMatchObject({ isFixed: false, rating: null, comment: 'Still broken' });
    expect(c.outbox.notifications).toEqual([{ recipient: { kind: 'USER', userId: supervisor.userId }, message: expect.stringContaining('reopened') }]);
    expect(c.dueAt).toEqual(hoursFromNow(48));
  });
  test('closed complaint cannot be reopened afterwards', () => {
    const c = complaintIn('RESOLVED');
    c.confirm(5, null, ctx(student));
    expect(() => c.reopen('x', ctx(student))).toThrow(IllegalTransitionError);
  });
});

describe('sd Escalate Overdue Complaint', () => {
  // A stand-in for NotificationService that records what it is asked to send.
  const fakeNotifications = () => {
    const sent = [];
    return { sent, send: async (recipient, message, complaintId) => { sent.push({ recipient, message, complaintId }); } };
  };

  test('isOverdue(now) is true only for Open complaints past dueAt', () => {
    expect(complaintIn('ASSIGNED', { dueAt: hoursFromNow(-1) }).isOverdue(NOW)).toBe(true);
    expect(complaintIn('ASSIGNED', { dueAt: hoursFromNow(1) }).isOverdue(NOW)).toBe(false);
    expect(complaintIn('ASSIGNED', { dueAt: NOW }).isOverdue(NOW)).toBe(false);
    for (const status of ['RESOLVED', 'CLOSED', 'INVALID', 'ESCALATED']) {
      expect(complaintIn(status, { dueAt: hoursFromNow(-100) }).isOverdue(NOW)).toBe(false);
    }
    for (const status of ['SUBMITTED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED']) {
      expect(complaintIn(status, { dueAt: hoursFromNow(-1) }).isOverdue(NOW)).toBe(true);
    }
  });

  test('escalate() returns an Escalation level 1; notifyResponsible tells only the supervisor', async () => {
    const c = complaintIn('ASSIGNED', { complaintId: 33, dueAt: hoursFromNow(-6) });
    const e = c.escalate(ctx(TIMER));
    expect(c.status).toBe(S.ESCALATED);
    expect(c.escalationLevel).toBe(1);
    expect(e).toMatchObject({ level: 1, reason: 'Complaint overdue', escalatedAt: NOW, complaintId: 33 });
    const ns = fakeNotifications();
    await e.notifyResponsible(ns);
    expect(ns.sent).toHaveLength(1);
    expect(ns.sent[0]).toMatchObject({ recipient: { kind: 'USER', userId: supervisor.userId }, complaintId: 33 });
  });

  test('US-09: 25 hours later the next escalation is level 2 and the Administrator is told too', async () => {
    const c = complaintIn('ASSIGNED', { complaintId: 33, dueAt: hoursFromNow(-6) });
    c.escalate(ctx(TIMER));
    const e2 = c.escalate(ctx(TIMER, hoursFromNow(25)));
    expect(e2.level).toBe(2);
    expect(c.escalationLevel).toBe(2);
    const ns = fakeNotifications();
    await e2.notifyResponsible(ns);
    expect(ns.sent.map((s) => s.recipient)).toEqual([{ kind: 'USER', userId: supervisor.userId }, { kind: 'ALL_ADMINISTRATORS' }]);
  });

  test('escalating again before the interval is refused', () => {
    const c = complaintIn('ASSIGNED', { dueAt: hoursFromNow(-6) });
    c.escalate(ctx(TIMER));
    expect(() => c.escalate(ctx(TIMER, hoursFromNow(10)))).toThrow(IllegalTransitionError);
  });

  test('autoClose(): RESOLVED 49 hours ago closes with no Feedback', () => {
    const c = complaintIn('RESOLVED', { resolvedAt: hoursFromNow(-49) });
    c.autoClose(ctx(TIMER));
    expect(c.status).toBe(S.CLOSED);
    expect(c.closedAt).toEqual(NOW);
    expect(c.outbox.feedback).toHaveLength(0);
    expect(trail(c)).toEqual(['RESOLVED>CLOSED']);
    expect(c.outbox.statusUpdates[0].updatedBy).toBeNull();
  });
  test('autoClose() before 48 hours is refused', () => {
    expect(() => complaintIn('RESOLVED', { resolvedAt: hoursFromNow(-47) }).autoClose(ctx(TIMER))).toThrow(IllegalTransitionError);
  });
});

describe('the demo flow (docs/07 steps 2 to 4) end to end', () => {
  test('assign, work, hold, resume, resolve, reject, reassign, resolve, confirm', () => {
    const c = makeComplaint();
    c.reprioritise('HIGH', rules.HIGH);
    c.assignTo(hvacStaff, ctx(supervisor, hoursFromNow(1)));
    c.applyEvent('startWork', {}, ctx(hvacStaff, hoursFromNow(2)));
    c.applyEvent('partsNeeded', { reason: 'waiting for capacitor' }, ctx(hvacStaff, hoursFromNow(3)));
    c.applyEvent('partsReceived', {}, ctx(hvacStaff, hoursFromNow(4)));
    c.markResolved('Replaced capacitor', ctx(hvacStaff, hoursFromNow(5)));
    c.reopen('Fan still wobbles', ctx(student, hoursFromNow(6)));
    c.assignTo(otherHvacStaff, ctx(supervisor, hoursFromNow(7)));
    c.applyEvent('startWork', {}, ctx(otherHvacStaff, hoursFromNow(8)));
    c.markResolved('Rebalanced blades', ctx(otherHvacStaff, hoursFromNow(9)));
    c.confirm(4, 'Good now', ctx(student, hoursFromNow(10)));

    expect(c.status).toBe(S.CLOSED);
    expect(trail(c)).toEqual([
      'SUBMITTED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'IN_PROGRESS>ON_HOLD', 'ON_HOLD>IN_PROGRESS', 'IN_PROGRESS>RESOLVED',
      'RESOLVED>REOPENED', 'REOPENED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'IN_PROGRESS>RESOLVED', 'RESOLVED>CLOSED',
    ]);
    expect(c.reopenCount).toBe(1);
    expect(c.assigneeId).toBe(otherHvacStaff.userId);
    expect(c.outbox.feedback.map((f) => [f.isFixed, f.rating])).toEqual([[false, null], [true, 4]]);
    expect(c.resolvedAt).toEqual(hoursFromNow(9));
    expect(c.closedAt).toEqual(hoursFromNow(10));
  });

  test('takeOutbox returns everything queued and empties it', () => {
    const c = makeComplaint();
    c.assignTo(hvacStaff, ctx(supervisor));
    const out = c.takeOutbox();
    expect(out.statusUpdates).toHaveLength(1);
    expect(out.notifications).toHaveLength(2);
    expect(c.outbox).toEqual({ statusUpdates: [], feedback: [], escalations: [], notifications: [] });
  });
});

describe('US-05 reprioritise: dueAt is recalculated from createdAt', () => {
  test('MEDIUM -> HIGH shortens the deadline; -> CRITICAL gives createdAt + 4 h; -> LOW lengthens', () => {
    const c = makeComplaint({ createdAt: hoursFromNow(-1), dueAt: hoursFromNow(47) });
    c.reprioritise('HIGH', rules.HIGH);
    expect(c.priority).toBe('HIGH');
    expect(c.dueAt).toEqual(hoursFromNow(23));
    c.reprioritise('CRITICAL', rules.CRITICAL);
    expect(c.dueAt).toEqual(hoursFromNow(3));
    c.reprioritise('LOW', rules.LOW);
    expect(c.dueAt).toEqual(hoursFromNow(119));
  });
  test('refused for finished complaints and for mismatching or unknown priorities', () => {
    expect(() => complaintIn('CLOSED').reprioritise('HIGH', rules.HIGH)).toThrow(IllegalTransitionError);
    expect(() => complaintIn('INVALID').reprioritise('HIGH', rules.HIGH)).toThrow(IllegalTransitionError);
    expect(() => makeComplaint().reprioritise('HIGH', rules.LOW)).toThrow(ValidationError);
    expect(() => makeComplaint().reprioritise('URGENT', rules.HIGH)).toThrow(ValidationError);
  });
  test('still allowed while ESCALATED', () => {
    const c = complaintIn('ESCALATED');
    c.reprioritise('LOW', rules.LOW);
    expect(c.status).toBe(S.ESCALATED);
  });
});
