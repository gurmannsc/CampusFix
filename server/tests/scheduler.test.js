// M6: EscalationScheduler. US-09 (overdue -> Escalation + supervisor; 24 h later the Administrator too)
// and rows 11, 12, 13 of the state machine, including the exact time boundaries.
// checkDeadlines(now) takes the time as a parameter, so "later" is simulated by passing a later `now`.
import { jest } from '@jest/globals';
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, anonymous, newComplaint, complaintIdByTitle, rows, statusOf, historyOf, notificationsOf, userIdOf, addUser,
} from './helpers/api.js';
import { EscalationScheduler, escalationScheduler, cronExpression } from '../src/scheduler/EscalationScheduler.js';
import { ComplaintList } from '../src/repositories/ComplaintList.js';
import { notificationService } from '../src/services/NotificationService.js';
import { Complaint, DomainError } from '../src/domain/index.js';

afterAll(closeDb);

const HOUR = 3600 * 1000;
// MySQL DATETIME keeps whole seconds (rounding to nearest). Rounding UP keeps this "now" at or after every
// event the test has already caused, like the real clock of the Timer, so history order stays correct.
const secondNow = () => new Date(Math.ceil(Date.now() / 1000) * 1000);
const ago = (now, hours) => new Date(now.getTime() - hours * HOUR);
const later = (now, hours) => new Date(now.getTime() + hours * HOUR);

const setDue = (id, date) => rows('UPDATE complaints SET due_at = ? WHERE complaint_id = ?', [date, id]);
const setResolvedAt = (id, date) => rows('UPDATE complaints SET resolved_at = ? WHERE complaint_id = ?', [date, id]);
const setLastEscalation = (id, date) => rows('UPDATE escalations SET escalated_at = ? WHERE complaint_id = ?', [date, id]);
const level = async (id) => (await rows('SELECT escalation_level l FROM complaints WHERE complaint_id = ?', [id]))[0].l;
const escalationRows = (id) => rows('SELECT level, reason FROM escalations WHERE complaint_id = ? ORDER BY escalation_id', [id]);
const notesFor = async (id, startAt = 0) => (await notificationsOf(id)).slice(startAt);
const where = (result, id) => ['escalated', 'reescalated', 'autoClosed', 'skipped', 'failed'].find((k) => result[k].some((x) => x.complaintId === id)) ?? null;
const check = (now) => escalationScheduler.checkDeadlines(now);

describe('demo step 5 (docs/07): the seeded scenarios', () => {
  beforeAll(resetTestDatabase);
  let result;
  let ids;
  let statusUpdatesBefore;
  let notesBefore;

  beforeAll(async () => {
    ids = {
      overdue: await complaintIdByTitle('No power in Classroom 204 sockets'),
      escalated: await complaintIdByTitle('No water supply in Hostel Block B'),
      resolved: await complaintIdByTitle('Study table drawer stuck'),
    };
    statusUpdatesBefore = (await rows('SELECT COUNT(*) n FROM status_updates'))[0].n;
    notesBefore = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, (await notificationsOf(id)).length])));
    result = await check(new Date());
  });

  test('the check reports exactly what changed: one escalated, one escalated to level 2, one auto-closed', () => {
    expect(result.escalated).toEqual([{ complaintId: ids.overdue, title: 'No power in Classroom 204 sockets', level: 1 }]);
    expect(result.reescalated).toEqual([{ complaintId: ids.escalated, title: 'No water supply in Hostel Block B', level: 2 }]);
    expect(result.autoClosed).toEqual([{ complaintId: ids.resolved, title: 'Study table drawer stuck' }]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  test('the overdue complaint (ASSIGNED, 6 h late) becomes ESCALATED at level 1; the supervisor is notified', async () => {
    expect(await statusOf(ids.overdue)).toBe('ESCALATED');
    expect(await level(ids.overdue)).toBe(1);
    expect(await escalationRows(ids.overdue)).toEqual([{ level: 1, reason: 'Complaint overdue' }]);
    const su = (await rows('SELECT from_status, to_status, updated_by, remarks FROM status_updates WHERE complaint_id = ? ORDER BY update_id DESC LIMIT 1', [ids.overdue]))[0];
    expect(su).toEqual({ from_status: 'ASSIGNED', to_status: 'ESCALATED', updated_by: null, remarks: 'Overdue: escalated to level 1' });
    const added = await notesFor(ids.overdue, notesBefore.overdue);
    expect(added.map((n) => n.email)).toEqual(['supervisor1@nmims.edu']); // level 1: supervisor only, no administrator
    expect(added[0].message).toMatch(/is overdue/);
  });

  test('the complaint escalated 25 h ago goes to level 2; supervisor AND administrator are notified; no StatusUpdate', async () => {
    expect(await statusOf(ids.escalated)).toBe('ESCALATED');
    expect(await level(ids.escalated)).toBe(2);
    expect((await escalationRows(ids.escalated)).map((e) => e.level)).toEqual([1, 2]);
    expect(await historyOf(ids.escalated)).toEqual(['null>SUBMITTED', 'SUBMITTED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'IN_PROGRESS>ESCALATED']); // unchanged
    const added = await notesFor(ids.escalated, notesBefore.escalated);
    expect(added.map((n) => n.email).sort()).toEqual(['admin1@nmims.edu', 'supervisor1@nmims.edu']);
    expect(added[0].message).toMatch(/still overdue \(escalation level 2\)/);
  });

  test('the complaint resolved 49 h ago is auto-closed: closedAt set, StatusUpdate by the Timer, no Feedback', async () => {
    expect(await statusOf(ids.resolved)).toBe('CLOSED');
    const [row] = await rows('SELECT closed_at, resolved_at FROM complaints WHERE complaint_id = ?', [ids.resolved]);
    expect(Math.abs(Date.now() - row.closed_at)).toBeLessThan(60 * 1000);
    const su = (await rows('SELECT from_status, to_status, updated_by, remarks FROM status_updates WHERE complaint_id = ? ORDER BY update_id DESC LIMIT 1', [ids.resolved]))[0];
    expect(su).toEqual({ from_status: 'RESOLVED', to_status: 'CLOSED', updated_by: null, remarks: 'Auto-closed after 48 hours without a response' });
    expect(await rows('SELECT 1 FROM feedback WHERE complaint_id = ?', [ids.resolved])).toHaveLength(0);
    expect((await notesFor(ids.resolved)).length).toBe(notesBefore.resolved); // nobody is notified (docs/04 row 11)
  });

  test('nothing else changed: exactly two StatusUpdates were added (escalation + auto-close)', async () => {
    expect((await rows('SELECT COUNT(*) n FROM status_updates'))[0].n).toBe(statusUpdatesBefore + 2);
    expect(await statusOf(await complaintIdByTitle('Washroom not cleaned in Hostel Block B'))).toBe('IN_PROGRESS');
    expect(await statusOf(await complaintIdByTitle('Projector not working in Classroom 204'))).toBe('ON_HOLD');
    expect(await statusOf(await complaintIdByTitle('Sparking switchboard near Computer Lab 2'))).toBe('SUBMITTED');
  });

  test('running it again straight away changes nothing', async () => {
    const again = await check(new Date());
    expect(again).toMatchObject({ escalated: [], reescalated: [], autoClosed: [], skipped: [], failed: [] });
  });

  test('the escalated complaints now show up for the supervisor (details include the Escalation rows)', async () => {
    const res = await (await as('supervisor1')).get(`/api/complaints/${ids.escalated}`);
    expect(res.body.complaint).toMatchObject({ status: 'ESCALATED', escalationLevel: 2 });
    expect(res.body.complaint.escalations.map((e) => e.level)).toEqual([1, 2]);
  });
});

describe('time passes: US-09 "24 h later the Administrator is also notified"', () => {
  beforeAll(resetTestDatabase);

  test('level 1 -> 2 -> 3, one interval (24 h) apart; the Administrator hears from level 2 on', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'ASSIGNED' });
    await setDue(id, ago(now, 1));

    const before1 = (await notificationsOf(id)).length;
    expect(where(await check(now), id)).toBe('escalated');
    expect(await level(id)).toBe(1);
    expect((await notesFor(id, before1)).map((n) => n.email)).toEqual(['supervisor1@nmims.edu']);

    const before2 = (await notificationsOf(id)).length;
    expect(where(await check(later(now, 23.5)), id)).toBeNull(); // too early
    expect(where(await check(later(now, 24)), id)).toBe('reescalated');
    expect(await level(id)).toBe(2);
    expect((await notesFor(id, before2)).map((n) => n.email).sort()).toEqual(['admin1@nmims.edu', 'supervisor1@nmims.edu']);

    const before3 = (await notificationsOf(id)).length;
    expect(where(await check(later(now, 47.9)), id)).toBeNull();
    expect(where(await check(later(now, 48)), id)).toBe('reescalated');
    expect(await level(id)).toBe(3);
    expect((await notesFor(id, before3)).map((n) => n.email).sort()).toEqual(['admin1@nmims.edu', 'supervisor1@nmims.edu']);
    expect((await escalationRows(id)).map((e) => e.level)).toEqual([1, 2, 3]);
    expect(await statusOf(id)).toBe('ESCALATED');
    expect(await historyOf(id)).toEqual(['null>SUBMITTED', 'SUBMITTED>ASSIGNED', 'ASSIGNED>ESCALATED']); // levels 2 and 3 add no StatusUpdate
  });

  test('the interval comes from the complaint\'s DeadlineRule (escalationIntervalHours)', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'ASSIGNED' });
    await setDue(id, ago(now, 1));
    await check(now);
    await rows("UPDATE deadline_rules SET escalation_interval_hours = 6 WHERE priority = 'MEDIUM'");
    try {
      expect(where(await check(later(now, 5.9)), id)).toBeNull();
      expect(where(await check(later(now, 6)), id)).toBe('reescalated');
    } finally {
      await rows("UPDATE deadline_rules SET escalation_interval_hours = 24 WHERE priority = 'MEDIUM'");
    }
  });
});

describe('row 12: an Open complaint with now > dueAt is escalated', () => {
  beforeAll(async () => {
    await resetTestDatabase();
    await addUser('supervisor2', 'SUPERVISOR');
  });

  test.each(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'])('from %s', async (stage) => {
    const now = secondNow();
    const id = await newComplaint({ stage });
    const notesBefore = (await notificationsOf(id)).length;
    await setDue(id, ago(now, 0.5));
    const result = await check(now);
    expect(where(result, id)).toBe('escalated');
    expect(await statusOf(id)).toBe('ESCALATED');
    expect(await level(id)).toBe(1);
    expect(await escalationRows(id)).toEqual([{ level: 1, reason: 'Complaint overdue' }]);
    expect((await historyOf(id)).at(-1)).toBe(`${stage}>ESCALATED`);
    const told = (await notesFor(id, notesBefore)).map((n) => n.email).sort();
    // an assigned complaint has its own supervisor; an unassigned one tells every supervisor
    expect(told).toEqual(stage === 'SUBMITTED' ? ['supervisor1@nmims.edu', 'supervisor2@nmims.edu'] : ['supervisor1@nmims.edu']);
  });

  test('from REOPENED', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'RESOLVED' });
    await (await as('student1')).post(`/api/complaints/${id}/reject`).send({ reason: 'not fixed' });
    expect(await statusOf(id)).toBe('REOPENED');
    await setDue(id, ago(now, 1));
    expect(where(await check(now), id)).toBe('escalated');
    expect((await historyOf(id)).at(-1)).toBe('REOPENED>ESCALATED');
  });

  test('not yet overdue: left alone, including a deadline that is exactly now (now > dueAt is strict)', async () => {
    const now = secondNow();
    const future = await newComplaint({ stage: 'ASSIGNED' });
    const exact = await newComplaint({ stage: 'ASSIGNED' });
    const justPast = await newComplaint({ stage: 'ASSIGNED' });
    await setDue(future, later(now, 2));
    await setDue(exact, now);
    await setDue(justPast, ago(now, 1 / 3600)); // one second late
    const result = await check(now);
    expect(where(result, future)).toBeNull();
    expect(where(result, exact)).toBeNull();
    expect(where(result, justPast)).toBe('escalated');
    expect(await statusOf(future)).toBe('ASSIGNED');
    expect(await statusOf(exact)).toBe('ASSIGNED');
  });

  test('RESOLVED, CLOSED and INVALID complaints are never escalated, however late', async () => {
    const now = secondNow();
    const resolved = await newComplaint({ stage: 'RESOLVED' });
    const closed = await newComplaint({ stage: 'RESOLVED' });
    await (await as('student1')).post(`/api/complaints/${closed}/confirm`).send({ rating: 5 });
    const invalid = await newComplaint({ stage: 'SUBMITTED' });
    await (await as('supervisor1')).post(`/api/complaints/${invalid}/invalid`).send({ reason: 'dup' });
    for (const id of [resolved, closed, invalid]) await setDue(id, ago(now, 100));
    const result = await check(now);
    for (const id of [resolved, closed, invalid]) expect([id, where(result, id)]).toEqual([id, null]);
    expect(await statusOf(resolved)).toBe('RESOLVED'); // < 48 h since resolution: not auto-closed either
    expect(await statusOf(invalid)).toBe('INVALID');
  });

  test('the escalated complaint is immediately visible to the supervisor as ESCALATED, and "overdue" is false for it', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'ASSIGNED' });
    await setDue(id, ago(now, 2));
    await check(now);
    const res = await (await as('supervisor1')).get(`/api/complaints/${id}`);
    expect(res.body.complaint).toMatchObject({ status: 'ESCALATED', escalationLevel: 1, overdue: false });
    expect(res.body.complaint.statusHistory.at(-1)).toMatchObject({ toStatus: 'ESCALATED', updatedBy: null });
  });

  describe('SERVICE complaints have no supervisor: the Administrator is told instead', () => {
    test('level 1 goes to the administrator only; level 2 tells the administrator once (not twice)', async () => {
      const now = secondNow();
      const id = await newComplaint({ category: 'Mess and Canteen', reporter: 'faculty1', stage: 'ASSIGNED' });
      const before = (await notificationsOf(id)).length;
      await setDue(id, ago(now, 1));
      await check(now);
      expect((await notesFor(id, before)).map((n) => n.email)).toEqual(['admin1@nmims.edu']);
      const before2 = (await notificationsOf(id)).length;
      await check(later(now, 25));
      expect(await level(id)).toBe(2);
      expect((await notesFor(id, before2)).map((n) => n.email)).toEqual(['admin1@nmims.edu']);
    });
  });
});

describe('row 11: RESOLVED with no response for 48 hours is auto-closed', () => {
  beforeAll(resetTestDatabase);

  test('exactly 48 h: closed. 47 h 59 min 59 s: not yet', async () => {
    const now = secondNow();
    const edge = await newComplaint({ stage: 'RESOLVED' });
    const early = await newComplaint({ stage: 'RESOLVED' });
    await setResolvedAt(edge, ago(now, 48));
    await setResolvedAt(early, new Date(ago(now, 48).getTime() + 1000));
    const result = await check(now);
    expect(where(result, edge)).toBe('autoClosed');
    expect(where(result, early)).toBeNull();
    expect(await statusOf(edge)).toBe('CLOSED');
    expect(await statusOf(early)).toBe('RESOLVED');
    const [row] = await rows('SELECT closed_at FROM complaints WHERE complaint_id = ?', [edge]);
    expect(row.closed_at.getTime()).toBe(now.getTime());
    // and it closes on a later run
    expect(where(await check(later(now, 1)), early)).toBe('autoClosed');
  });

  test('after auto-close the reporter can no longer confirm or reject (CLOSED is final)', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'RESOLVED' });
    await setResolvedAt(id, ago(now, 60));
    await check(now);
    const student = await as('student1');
    expect((await student.post(`/api/complaints/${id}/confirm`).send({ rating: 5 })).status).toBe(409);
    expect((await student.post(`/api/complaints/${id}/reject`).send({ reason: 'x' })).status).toBe(409);
    expect(await rows('SELECT 1 FROM feedback WHERE complaint_id = ?', [id])).toHaveLength(0);
  });

  test('a reporter who responded in time keeps the complaint out of the auto-close', async () => {
    const now = secondNow();
    const confirmed = await newComplaint({ stage: 'RESOLVED' });
    const rejected = await newComplaint({ stage: 'RESOLVED' });
    await (await as('student1')).post(`/api/complaints/${confirmed}/confirm`).send({ rating: 4 });
    await (await as('student1')).post(`/api/complaints/${rejected}/reject`).send({ reason: 'no' });
    const result = await check(later(now, 100));
    expect(where(result, confirmed)).toBeNull(); // already CLOSED with feedback: no second StatusUpdate
    expect(await historyOf(confirmed)).toHaveLength(5); // SUBMITTED, ASSIGNED, IN_PROGRESS, RESOLVED, CLOSED: no extra row
    expect(await statusOf(rejected)).not.toBe('CLOSED');
  });

  test('RESOLVED but overdue and under 48 h: neither escalated nor closed (RESOLVED is not an Open state)', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'RESOLVED' });
    await setDue(id, ago(now, 10));
    await setResolvedAt(id, ago(now, 20));
    expect(where(await check(now), id)).toBeNull();
    expect(await statusOf(id)).toBe('RESOLVED');
  });
});

describe('together with the M5 decisions (a fresh deadline after reopen / reassign / extend)', () => {
  beforeAll(resetTestDatabase);

  test('a rejected fix gets a new deadline and is NOT escalated at the next timer run', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    await rows('UPDATE complaints SET due_at = ? WHERE complaint_id = ?', [ago(new Date(), 5), id]); // long overdue
    await (await as('student1')).post(`/api/complaints/${id}/reject`).send({ reason: 'not fixed' });
    expect(where(await check(new Date()), id)).toBeNull();
    expect(await statusOf(id)).toBe('REOPENED');
  });

  test('after the supervisor extends the deadline the complaint is left alone, and escalates again (level 1) once the new deadline passes', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'IN_PROGRESS' });
    await setDue(id, ago(now, 1));
    await check(now);
    await check(later(now, 25)); // level 2
    expect(await level(id)).toBe(2);
    const newDue = later(now, 30);
    const res = await (await as('supervisor1')).post(`/api/complaints/${id}/resolve-escalation`).send({ action: 'extend', newDueAt: newDue.toISOString(), reason: 'parts ordered' });
    expect(res.status).toBe(200);
    expect(await level(id)).toBe(0);
    expect(where(await check(later(now, 29)), id)).toBeNull(); // before the new deadline
    expect(where(await check(later(now, 31)), id)).toBe('escalated'); // after it: back to level 1, supervisor only
    expect(await level(id)).toBe(1);
    expect((await escalationRows(id)).map((e) => e.level)).toEqual([1, 2, 1]);
  });

  test('a reassigned complaint is not re-escalated straight away', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'ASSIGNED' });
    await setDue(id, ago(now, 1));
    await check(now);
    const res = await (await as('supervisor1')).post(`/api/complaints/${id}/resolve-escalation`).send({ action: 'reassign', staffId: await userIdOf('hvac2') });
    expect(res.status).toBe(200);
    expect(where(await check(new Date()), id)).toBeNull();
    expect(await statusOf(id)).toBe('ASSIGNED');
  });
});

describe('robustness', () => {
  beforeAll(resetTestDatabase);

  test('one failing complaint does not stop the others, and its own changes are rolled back', async () => {
    const now = secondNow();
    const good = await newComplaint({ stage: 'ASSIGNED' });
    const bad = await newComplaint({ stage: 'ASSIGNED' });
    await setDue(good, ago(now, 2));
    await setDue(bad, ago(now, 3)); // processed first (older deadline)
    const flaky = new EscalationScheduler({
      notifications: {
        send: (recipient, message, complaintId, conn) => {
          if (complaintId === bad) throw new Error('notification store is down');
          return notificationService.send(recipient, message, complaintId, conn);
        },
      },
    });
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {}); // the failure is logged on purpose
    let result;
    try { result = await flaky.checkDeadlines(now); } finally { quiet.mockRestore(); }
    expect(result.failed).toEqual([{ complaintId: bad, error: 'notification store is down' }]);
    expect(where(result, good)).toBe('escalated');
    expect(await statusOf(bad)).toBe('ASSIGNED');
    expect(await escalationRows(bad)).toEqual([]);
    expect(await level(bad)).toBe(0);
    expect(await statusOf(good)).toBe('ESCALATED');
    // the next run (store is back) picks the failed one up
    expect(where(await check(now), bad)).toBe('escalated');
  });

  test('a complaint that changed after it was selected is skipped, not failed', async () => {
    const now = secondNow();
    const id = await newComplaint({ stage: 'IN_PROGRESS' });
    await setDue(id, ago(now, 1));
    const stale = await ComplaintList.findOverdue(now); // snapshot says: overdue, IN_PROGRESS
    expect(stale.map((c) => c.complaintId)).toContain(id);
    await (await as('hvac1')).post(`/api/complaints/${id}/resolve`).send({ remarks: 'just fixed' }); // resolved in the meantime
    const racing = new EscalationScheduler({ complaintList: { findOverdue: async () => stale, findAutoCloseable: async () => [] } });
    const result = await racing.checkDeadlines(now);
    expect(result.escalated).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ complaintId: id, reason: expect.stringMatching(/Cannot escalate a complaint that is RESOLVED/) })]);
    expect(await statusOf(id)).toBe('RESOLVED');
  });

  test('two schedulers running at the same moment escalate each complaint exactly once', async () => {
    const now = secondNow();
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await newComplaint({ stage: 'ASSIGNED' });
      await setDue(id, ago(now, 1 + i));
      ids.push(id);
    }
    const before = (await rows('SELECT COUNT(*) n FROM notifications'))[0].n;
    const [a, b] = await Promise.all([new EscalationScheduler().checkDeadlines(now), new EscalationScheduler().checkDeadlines(now)]);
    for (const id of ids) {
      expect([id, [a, b].filter((r) => where(r, id) === 'escalated').length]).toEqual([id, 1]);
      expect([id, (await escalationRows(id)).length]).toEqual([id, 1]);
      expect(await level(id)).toBe(1);
    }
    expect((await rows('SELECT COUNT(*) n FROM notifications'))[0].n - before).toBe(3); // one supervisor notification each
    expect(a.failed).toEqual([]);
    expect(b.failed).toEqual([]);
  });

  test('the same scheduler refuses to run twice at once (409)', async () => {
    const scheduler = new EscalationScheduler();
    const results = await Promise.allSettled([scheduler.checkDeadlines(new Date()), scheduler.checkDeadlines(new Date())]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected').reason;
    expect(rejected).toBeInstanceOf(DomainError);
    expect(rejected.httpStatus).toBe(409);
    await expect(scheduler.checkDeadlines(new Date())).resolves.toBeDefined(); // usable again afterwards
  });
});

describe('ComplaintList (the repository of sd Escalate Overdue Complaint)', () => {
  beforeAll(resetTestDatabase);

  test('findOverdue(now) returns Complaint entities, oldest deadline first, with category and rule loaded', async () => {
    const list = await ComplaintList.findOverdue(new Date());
    expect(list.length).toBe(2); // the two live seed complaints: overdue ASSIGNED and ESCALATED with a 25 h old escalation
    expect(list.every((c) => c instanceof Complaint)).toBe(true);
    expect(list.map((c) => c.title)).toEqual(['No water supply in Hostel Block B', 'No power in Classroom 204 sockets']);
    expect(list[0].category.name).toBe('Plumbing');
    expect(list[0].deadlineRule.escalationIntervalHours).toBe(24);
    expect(list[0].lastEscalatedAt).toBeInstanceOf(Date);
    expect(list[0].isOverdue(new Date())).toBe(false); // ESCALATED: handled by row 13, not "overdue" in the Open sense
    expect(list[1].isOverdue(new Date())).toBe(true);
  });

  test('findOverdue looks at the time it is given', async () => {
    expect(await ComplaintList.findOverdue(ago(new Date(), 100))).toEqual([]);
    expect((await ComplaintList.findOverdue(later(new Date(), 48))).length).toBeGreaterThanOrEqual(5); // everything open becomes overdue
  });

  test('findAutoCloseable(now) returns RESOLVED complaints from 48 h ago', async () => {
    const list = await ComplaintList.findAutoCloseable(new Date());
    expect(list.map((c) => c.title)).toEqual(['Study table drawer stuck']);
    expect(await ComplaintList.findAutoCloseable(ago(new Date(), 10))).toEqual([]);
  });
});

describe('POST /api/admin/run-deadline-check (demo button)', () => {
  beforeAll(resetTestDatabase);

  test('only the administrator may press it', async () => {
    for (const user of ['student1', 'faculty1', 'electrician1', 'supervisor1']) {
      expect([user, (await (await as(user)).post('/api/admin/run-deadline-check').send({})).status]).toEqual([user, 403]);
    }
    expect((await anonymous.post('/api/admin/run-deadline-check').send({})).status).toBe(401);
    expect(await statusOf(await complaintIdByTitle('No power in Classroom 204 sockets'))).toBe('ASSIGNED'); // nothing ran
  });

  test('admin1 runs it: the response lists what happened (demo step 5); a second press changes nothing', async () => {
    const admin = await as('admin1');
    const res = await admin.post('/api/admin/run-deadline-check').send({});
    expect(res.status).toBe(200);
    expect(res.body.escalated.map((c) => [c.title, c.level])).toEqual([['No power in Classroom 204 sockets', 1]]);
    expect(res.body.reescalated.map((c) => [c.title, c.level])).toEqual([['No water supply in Hostel Block B', 2]]);
    expect(res.body.autoClosed.map((c) => c.title)).toEqual(['Study table drawer stuck']);
    expect(res.body.failed).toEqual([]);
    const again = await admin.post('/api/admin/run-deadline-check').send({});
    expect(again.body).toMatchObject({ escalated: [], reescalated: [], autoClosed: [] });
  });
});

describe('the Timer (node-cron)', () => {
  test('cronExpression: every n minutes, or every n/60 hours', () => {
    expect(cronExpression(15)).toBe('*/15 * * * *');
    expect(cronExpression(1)).toBe('*/1 * * * *');
    expect(cronExpression(59)).toBe('*/59 * * * *');
    expect(cronExpression(60)).toBe('0 */1 * * *');
    expect(cronExpression(180)).toBe('0 */3 * * *');
    expect(cronExpression(24 * 60)).toBe('0 0 * * *');
  });

  test.each([-5, 1.5, NaN, 0])('cronExpression(%p) is rejected', (bad) => {
    expect(() => cronExpression(bad)).toThrow(/DEADLINE_CHECK_MINUTES/);
  });

  test('0 minutes means "timer off": start() schedules nothing', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const off = new EscalationScheduler({ minutes: 0 });
    expect(off.start()).toBe(false);
    expect(off.isScheduled).toBe(false);
  });

  test('start() schedules the timer once and stop() cancels it', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const timer = new EscalationScheduler({ minutes: 15 });
    expect(timer.start()).toBe(true);
    expect(timer.isScheduled).toBe(true);
    expect(timer.start()).toBe(true); // second call does not add a second timer
    timer.stop();
    expect(timer.isScheduled).toBe(false);
  });

  test('an invalid interval fails at start, not silently later', () => {
    expect(() => new EscalationScheduler({ minutes: -3 }).start()).toThrow(/DEADLINE_CHECK_MINUTES/);
    expect(() => new EscalationScheduler({ minutes: NaN }).start()).toThrow(/DEADLINE_CHECK_MINUTES/);
  });

  afterAll(() => jest.restoreAllMocks());

  test('the application module never starts a timer by itself (only server.js does)', async () => {
    const { app } = await import('../src/app.js');
    expect(app).toBeDefined();
    expect(escalationScheduler.isScheduled).toBe(false);
  });
});
