// M7: GET /api/notifications, POST /api/notifications/:id/read, and "notifications are created at every
// point listed in docs/04". The matrix test reads each notification from the RECIPIENT's side through the API.
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, anonymous, newComplaint, rows, userIdOf, addUser, complaintIdByTitle,
} from './helpers/api.js';
import { escalationScheduler } from '../src/scheduler/EscalationScheduler.js';
import { notificationService } from '../src/services/NotificationService.js';
import { notificationRepository } from '../src/repositories/notificationRepository.js';
import { Notification } from '../src/domain/index.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

const inbox = async (user, query = '') => (await (await as(user)).get(`/api/notifications${query}`));

describe('GET /api/notifications', () => {
  test('a user sees their own notifications, newest first, with the fields the bell needs', async () => {
    const res = await inbox('supervisor1');
    expect(res.status).toBe(200);
    const list = res.body.notifications;
    expect(list.length).toBeGreaterThanOrEqual(3); // seed: two "New complaint" and one "overdue"
    expect(list[0]).toEqual({
      notificationId: expect.any(Number), complaintId: expect.any(Number), message: expect.any(String), isRead: false, sentAt: expect.any(String),
    });
    const times = list.map((n) => new Date(n.sentAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.body.unreadCount).toBe(list.length);
  });

  test('people only see their own: the seed gives each person different notifications', async () => {
    const [{ n: adminCount }] = await rows("SELECT COUNT(*) n FROM notifications WHERE user_id = ?", [await userIdOf('admin1')]);
    const admin = await inbox('admin1');
    expect(admin.body.notifications).toHaveLength(adminCount);
    expect(admin.body.notifications.map((n) => n.message).join()).toMatch(/Stale food/);
    const student2 = await inbox('student2');
    expect(student2.body.notifications.map((n) => n.message).join()).toMatch(/Please confirm or reject/);
    expect(student2.body.notifications.map((n) => n.message).join()).not.toMatch(/Stale food/);
    // a staff member with nothing yet: empty list and a zero badge
    expect((await inbox('hvac3')).body).toEqual({ notifications: [], unreadCount: 0 });
  });

  test('every role can read their own inbox; anonymous gets 401', async () => {
    for (const user of ['student1', 'faculty1', 'electrician1', 'supervisor1', 'admin1']) {
      expect([user, (await inbox(user)).status]).toEqual([user, 200]);
    }
    expect((await anonymous.get('/api/notifications')).status).toBe(401);
  });

  test('unread=true leaves out the ones already read; unreadCount follows', async () => {
    const supervisor = await as('supervisor1');
    const all = (await inbox('supervisor1')).body;
    const first = all.notifications[0];
    await supervisor.post(`/api/notifications/${first.notificationId}/read`).send({});
    const unread = (await inbox('supervisor1', '?unread=true')).body;
    expect(unread.notifications.map((n) => n.notificationId)).not.toContain(first.notificationId);
    expect(unread.notifications).toHaveLength(all.notifications.length - 1);
    expect(unread.unreadCount).toBe(all.unreadCount - 1);
    const readToo = (await inbox('supervisor1', '?unread=false')).body.notifications.find((n) => n.notificationId === first.notificationId);
    expect(readToo.isRead).toBe(true);
  });

  test('limit shortens the list but unreadCount stays the total', async () => {
    const full = (await inbox('supervisor1')).body;
    const one = (await inbox('supervisor1', '?limit=1')).body;
    expect(one.notifications).toHaveLength(1);
    expect(one.notifications[0].notificationId).toBe(full.notifications[0].notificationId); // the newest
    expect(one.unreadCount).toBe(full.unreadCount);
  });

  test.each([['limit=0'], ['limit=201'], ['limit=abc'], ['limit=1.5'], ['unread=maybe'], ['limit=0&unread=maybe']])('%s: 400', async (query) => {
    const res = await inbox('supervisor1', `?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  test('the list is produced by User.viewNotifications() from the class diagram', async () => {
    const { userRepository } = await import('../src/repositories/userRepository.js');
    const user = await userRepository.findById(await userIdOf('supervisor1'));
    const viaDomain = await user.viewNotifications({ limit: 2 });
    expect(viaDomain).toHaveLength(2);
    expect(viaDomain[0]).toBeInstanceOf(Notification);
    expect(viaDomain[0].userId).toBe(user.userId);
  });
});

describe('POST /api/notifications/:id/read', () => {
  test('marks the notification read, saves it, and returns the new unread count', async () => {
    const supervisor = await as('supervisor1');
    const before = (await inbox('supervisor1')).body;
    const target = before.notifications.find((n) => !n.isRead);
    const res = await supervisor.post(`/api/notifications/${target.notificationId}/read`).send({});
    expect(res.status).toBe(200);
    expect(res.body.notification).toMatchObject({ notificationId: target.notificationId, isRead: true });
    expect(res.body.unreadCount).toBe(before.unreadCount - 1);
    expect((await rows('SELECT is_read FROM notifications WHERE notification_id = ?', [target.notificationId]))[0].is_read).toBe(1);
  });

  test('marking it again is fine (idempotent) and does not change the count', async () => {
    const supervisor = await as('supervisor1');
    const target = (await inbox('supervisor1', '?unread=true')).body.notifications[0];
    const first = await supervisor.post(`/api/notifications/${target.notificationId}/read`).send({});
    const second = await supervisor.post(`/api/notifications/${target.notificationId}/read`).send({});
    expect(second.status).toBe(200);
    expect(second.body.unreadCount).toBe(first.body.unreadCount);
  });

  test('someone else\'s notification is a 404, exactly like a missing one, and stays unread', async () => {
    const adminNote = (await inbox('admin1')).body.notifications[0];
    const intruder = await as('student1');
    const res = await intruder.post(`/api/notifications/${adminNote.notificationId}/read`).send({});
    expect(res.status).toBe(404);
    expect((await intruder.post('/api/notifications/999999/read').send({})).status).toBe(404);
    expect((await rows('SELECT is_read FROM notifications WHERE notification_id = ?', [adminNote.notificationId]))[0].is_read).toBe(0);
  });

  test('a malformed id is 400; anonymous is 401', async () => {
    const student = await as('student1');
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect([bad, (await student.post(`/api/notifications/${bad}/read`).send({})).status]).toEqual([bad, 400]);
    }
    expect((await anonymous.post('/api/notifications/1/read').send({})).status).toBe(401);
  });

  test('a group notification is one row per person: reading yours does not read theirs', async () => {
    await addUser('supervisor2', 'SUPERVISOR');
    const id = await newComplaint({ stage: 'SUBMITTED' }); // "New complaint" goes to both supervisors
    const mine = (await inbox('supervisor1')).body.notifications.find((n) => n.complaintId === id);
    const theirs = (await inbox('supervisor2')).body.notifications.find((n) => n.complaintId === id);
    expect(mine.notificationId).not.toBe(theirs.notificationId);
    await (await as('supervisor1')).post(`/api/notifications/${mine.notificationId}/read`).send({});
    expect((await inbox('supervisor2')).body.notifications.find((n) => n.complaintId === id).isRead).toBe(false);
  });
});

describe('Notification entity and NotificationService', () => {
  test('repository returns Notification entities; markRead() then save() persists', async () => {
    const [{ notification_id }] = await rows('SELECT notification_id FROM notifications WHERE is_read = FALSE LIMIT 1');
    const n = await notificationRepository.findById(notification_id);
    expect(n).toBeInstanceOf(Notification);
    expect(n.isRead).toBe(false);
    n.markRead();
    await notificationRepository.save(n);
    expect((await notificationRepository.findById(notification_id)).isRead).toBe(true);
    expect(await notificationRepository.findById(999999)).toBeNull();
  });

  test('send() accepts a user id, a USER or a group descriptor, and rejects unknown recipients', async () => {
    const id = await userIdOf('student1');
    const before = (await rows('SELECT COUNT(*) n FROM notifications'))[0].n;
    expect(await notificationService.send(id, 'plain id')).toBe(1);
    expect(await notificationService.send({ kind: 'USER', userId: id }, 'descriptor')).toBe(1);
    expect(await notificationService.send({ kind: 'ALL_ADMINISTRATORS' }, 'group')).toBeGreaterThanOrEqual(1);
    await expect(notificationService.send({ kind: 'EVERYONE' }, 'x')).rejects.toThrow(/Unknown notification recipient/);
    await expect(notificationService.send('student1', 'x')).rejects.toThrow(/Unknown notification recipient/);
    expect((await rows('SELECT COUNT(*) n FROM notifications'))[0].n).toBeGreaterThan(before);
  });

  test('messages longer than the column (255) are shortened, not rejected', async () => {
    const id = await userIdOf('student1');
    await notificationService.send(id, 'x'.repeat(400));
    const latest = (await rows('SELECT message FROM notifications WHERE user_id = ? ORDER BY notification_id DESC LIMIT 1', [id]))[0].message;
    expect(latest).toHaveLength(255);
    expect(latest.endsWith('…')).toBe(true);
  });
});

describe('docs/04: a notification at every point listed (read by each recipient through the API)', () => {
  const PEOPLE = ['student1', 'faculty1', 'supervisor1', 'supervisor2', 'admin1', 'hvac1', 'hvac2'];

  beforeAll(async () => {
    await resetTestDatabase();
    await addUser('supervisor2', 'SUPERVISOR');
  });

  // What each person has been told about complaint `id`, newest first, as read through GET /api/notifications.
  async function snapshot(id) {
    const out = {};
    for (const person of PEOPLE) {
      out[person] = (await inbox(person, '?limit=200')).body.notifications.filter((n) => n.complaintId === id).map((n) => n.message);
    }
    return out;
  }

  // Runs `action`, then checks that exactly the people in `expected` got new notifications matching the
  // given patterns, and that nobody else was told anything.
  async function step(id, label, action, expected = {}) {
    const before = await snapshot(id);
    await action();
    const after = await snapshot(id);
    for (const person of PEOPLE) {
      const added = after[person].slice(0, after[person].length - before[person].length);
      const wanted = expected[person] ?? [];
      expect([label, person, added.length]).toEqual([label, person, wanted.length]);
      wanted.forEach((pattern, i) => expect([label, person, added[added.length - 1 - i]]).toEqual([label, person, expect.stringMatching(pattern)]));
    }
  }

  const call = (user, id, action, body = {}) => async () => {
    const res = await (await as(user)).post(`/api/complaints/${id}/${action}`).send(body);
    if (res.status !== 200) throw new Error(`${user} ${action}: ${res.status} ${JSON.stringify(res.body)}`);
  };
  const secondNow = () => new Date(Math.ceil(Date.now() / 1000) * 1000);
  const HOUR = 3600 * 1000;

  test('rows 1, 3, 5-9 and 4, 10: the repair flow', async () => {
    const student = await as('student1');
    const hvac = (await rows("SELECT category_id FROM categories WHERE name = 'HVAC'"))[0].category_id;
    const location = (await rows("SELECT location_id FROM locations WHERE room = '204' AND block = 'Hostel Block A'"))[0].location_id;
    // Row 1: raiseComplaint -> notify supervisors (every supervisor, nobody else)
    const raised = await student.post('/api/complaints').send({ categoryId: hvac, locationId: location, title: 'Ceiling fan not working', description: 'x' });
    const id = raised.body.complaintId;
    const afterRaise = await snapshot(id);
    expect(afterRaise.supervisor1).toEqual([expect.stringMatching(/^New complaint: "Ceiling fan not working"$/)]);
    expect(afterRaise.supervisor2).toEqual([expect.stringMatching(/^New complaint: /)]);
    for (const nobody of ['student1', 'faculty1', 'admin1', 'hvac1', 'hvac2']) expect([nobody, afterRaise[nobody]]).toEqual([nobody, []]);

    // Row 3: assign -> notify assignee and reporter
    await step(id, 'row 3 assign', call('supervisor1', id, 'assign', { staffId: await userIdOf('hvac1') }), {
      hvac1: [/has been assigned to you/], student1: [/has been assigned$/],
    });
    // Rows 5, 6, 7: start, hold, resume -> no notification
    await step(id, 'row 5 startWork', call('hvac1', id, 'start'));
    await step(id, 'row 6 partsNeeded', call('hvac1', id, 'hold', { reason: 'waiting for capacitor' }));
    await step(id, 'row 7 partsReceived', call('hvac1', id, 'resume'));
    // Row 8: markResolved -> notify the reporter to confirm
    await step(id, 'row 8 markResolved', call('hvac1', id, 'resolve', { remarks: 'Replaced capacitor' }), {
      student1: [/was resolved\. Please confirm or reject the fix/],
    });
    // Row 10: rejectFix -> notify the supervisor (the complaint's own supervisor only)
    await step(id, 'row 10 rejectFix', call('student1', id, 'reject', { reason: 'Still wobbles' }), {
      supervisor1: [/was reopened by the reporter/],
    });
    // Row 4: assign from REOPENED -> notify the assignee only
    await step(id, 'row 4 assign (reopened)', call('supervisor1', id, 'assign', { staffId: await userIdOf('hvac2') }), {
      hvac2: [/Reopened complaint .* has been assigned to you/],
    });
    await step(id, 'start again', call('hvac2', id, 'start'));
    await step(id, 'resolve again', call('hvac2', id, 'resolve', { remarks: 'Rebalanced' }), { student1: [/Please confirm or reject/] });
    // Row 9: confirm -> no notification
    await step(id, 'row 9 confirm', call('student1', id, 'confirm', { rating: 4 }));
  });

  test('row 2: markInvalid -> notify the reporter', async () => {
    const id = await newComplaint({ stage: 'SUBMITTED', title: 'Duplicate report' });
    await step(id, 'row 2 markInvalid', call('supervisor1', id, 'invalid', { reason: 'Duplicate of #5' }), {
      student1: [/was marked invalid: Duplicate of #5/],
    });
  });

  test('rows 12, 13, 14: escalation, level 2 (supervisor AND administrator), reassign and extend', async () => {
    const id = await newComplaint({ stage: 'IN_PROGRESS', title: 'Slow repair' });
    const now = secondNow();
    await rows('UPDATE complaints SET due_at = ? WHERE complaint_id = ?', [new Date(now.getTime() - HOUR), id]);

    // Row 12: when(now > dueAt) -> notify the supervisor
    await step(id, 'row 12 escalate', () => escalationScheduler.checkDeadlines(now), { supervisor1: [/is overdue/] });
    // Row 13: 24 h later -> notify supervisor AND administrator
    await step(id, 'row 13 reescalate (level 2)', () => escalationScheduler.checkDeadlines(new Date(now.getTime() + 24 * HOUR)), {
      supervisor1: [/still overdue \(escalation level 2\)/], admin1: [/still overdue \(escalation level 2\)/],
    });
    // Row 14: resolveEscalation(reassign) -> notify the (new) assignee
    await step(id, 'row 14 reassign', call('supervisor1', id, 'resolve-escalation', { action: 'reassign', staffId: await userIdOf('hvac2') }), {
      hvac2: [/Escalated complaint .* has been reassigned to you/],
    });
    // ... and (extend) -> notify the assignee
    await call('hvac2', id, 'start')();
    await rows('UPDATE complaints SET due_at = ? WHERE complaint_id = ?', [new Date(now.getTime() + 24 * HOUR), id]);
    await escalationScheduler.checkDeadlines(new Date(now.getTime() + 26 * HOUR));
    await step(id, 'row 14 extend', call('supervisor1', id, 'resolve-escalation', {
      action: 'extend', newDueAt: new Date(Date.now() + 10 * HOUR).toISOString(), reason: 'Parts delayed',
    }), { hvac2: [/Deadline of complaint .* was extended/] });
  });

  test('row 11: auto-close -> nobody is notified', async () => {
    const id = await newComplaint({ stage: 'RESOLVED', title: 'Nobody answered' });
    await rows('UPDATE complaints SET resolved_at = ? WHERE complaint_id = ?', [new Date(Date.now() - 49 * HOUR), id]);
    await step(id, 'row 11 autoClose', () => escalationScheduler.checkDeadlines(new Date()));
    expect((await rows('SELECT status FROM complaints WHERE complaint_id = ?', [id]))[0].status).toBe('CLOSED');
  });

  test('SERVICE complaints: administrators instead of supervisors (rows 1, 3, 10, 12)', async () => {
    const mess = (await rows("SELECT category_id FROM categories WHERE name = 'Mess and Canteen'"))[0].category_id;
    const hall = (await rows("SELECT location_id FROM locations WHERE room = 'Dining Hall'"))[0].location_id;
    const raised = await (await as('faculty1')).post('/api/complaints').send({ categoryId: mess, locationId: hall, title: 'Cold food', description: 'x' });
    const id = raised.body.complaintId;
    const first = await snapshot(id);
    expect(first.admin1).toEqual([expect.stringMatching(/^New complaint: "Cold food"$/)]); // row 1 -> Administrators
    expect(first.supervisor1).toEqual([]);
    expect(first.supervisor2).toEqual([]);

    await step(id, 'row 3 assign (admin takes it)', call('admin1', id, 'assign'), {
      admin1: [/has been assigned to you/], faculty1: [/has been assigned$/],
    });
    await call('admin1', id, 'start')();
    await call('admin1', id, 'resolve', { remarks: 'Vendor informed' })();
    await step(id, 'row 10 rejectFix', call('faculty1', id, 'reject', { reason: 'No change' }), { admin1: [/was reopened by the reporter/] });

    const now = secondNow();
    await rows('UPDATE complaints SET due_at = ?, status = "ASSIGNED" WHERE complaint_id = ?', [new Date(now.getTime() - HOUR), id]);
    await step(id, 'row 12 escalate', () => escalationScheduler.checkDeadlines(now), { admin1: [/is overdue/] });
  });
});
