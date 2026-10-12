// M5 part 2: US-08, the reporter confirms (rating 1..5) or rejects (reason) a fix. Includes the full demo step 4.
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, anonymous, newComplaint, rows, statusOf, historyOf, notificationsOf, userIdOf, hoursBetween,
} from './helpers/api.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

const post = async (user, id, action, body = {}) => (await as(user)).post(`/api/complaints/${id}/${action}`).send(body);
const feedbackOf = (id) => rows('SELECT is_fixed, rating, comment FROM feedback WHERE complaint_id = ? ORDER BY feedback_id', [id]);

describe('confirm: rating 1 to 5 closes the complaint', () => {
  test('rating 4 with a comment: CLOSED, Feedback saved, closedAt set, StatusUpdate by the reporter', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    const res = await post('student1', id, 'confirm', { rating: 4, comment: 'Works well now' });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'CLOSED' });
    expect(res.body.complaint.closedAt).not.toBeNull();
    expect(res.body.complaint.feedback).toEqual([expect.objectContaining({ isFixed: true, rating: 4, comment: 'Works well now' })]);
    expect(res.body.complaint.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'RESOLVED', toStatus: 'CLOSED', updatedBy: { name: 'Aarav Mehta' },
    });
    expect(await feedbackOf(id)).toEqual([{ is_fixed: 1, rating: 4, comment: 'Works well now' }]);
  });

  test('the comment is optional; ratings 1 and 5 are the limits', async () => {
    for (const rating of [1, 5]) {
      const id = await newComplaint({ stage: 'RESOLVED' });
      expect([rating, (await post('student1', id, 'confirm', { rating })).status]).toEqual([rating, 200]);
      expect((await feedbackOf(id))[0]).toMatchObject({ rating, comment: null });
    }
  });

  test.each([
    [0], [6], [-1], [3.5], ['4'], [null], [undefined], [true], [[4]],
  ])('rating %p is refused (400): the complaint stays RESOLVED and no Feedback is saved', async (rating) => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    const res = await post('student1', id, 'confirm', { rating });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rating must be a whole number from 1 to 5/);
    expect(await statusOf(id)).toBe('RESOLVED');
    expect(await feedbackOf(id)).toEqual([]);
  });

  test('a comment over 2000 characters is a 400', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    expect((await post('student1', id, 'confirm', { rating: 5, comment: 'x'.repeat(2001) })).status).toBe(400);
    expect(await statusOf(id)).toBe('RESOLVED');
  });

  test('faculty confirm their own complaints too', async () => {
    const id = await newComplaint({ stage: 'RESOLVED', reporter: 'faculty1' });
    expect((await post('faculty1', id, 'confirm', { rating: 5 })).body.complaint.status).toBe('CLOSED');
  });
});

describe('reject: a reason is required and the complaint is reopened', () => {
  test('REOPENED, Feedback(isFixed = false) with the reason, reopenCount + 1, supervisor notified (demo step 4)', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    const supervisorId = await userIdOf('supervisor1');
    const res = await post('student1', id, 'reject', { reason: 'Fan still wobbles' });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'REOPENED', reopenCount: 1 });
    expect(res.body.complaint.feedback).toEqual([expect.objectContaining({ isFixed: false, rating: null, comment: 'Fan still wobbles' })]);
    expect(res.body.complaint.statusHistory.at(-1)).toMatchObject({ fromStatus: 'RESOLVED', toStatus: 'REOPENED', remarks: 'Fan still wobbles' });
    const note = (await notificationsOf(id)).at(-1);
    expect(note).toMatchObject({ email: 'supervisor1@nmims.edu' });
    expect(note.message).toMatch(/was reopened by the reporter/);
    expect((await rows('SELECT supervisor_id FROM complaints WHERE complaint_id = ?', [id]))[0].supervisor_id).toBe(supervisorId);
  });

  test('the deadline restarts from now and the escalation level is reset', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' }); // MEDIUM = 48 h
    await rows('UPDATE complaints SET escalation_level = 2, due_at = ? WHERE complaint_id = ?', [new Date(Date.now() - 5 * 3600 * 1000), id]); // long overdue
    const before = Date.now();
    const res = await post('student1', id, 'reject', { reason: 'Not fixed' });
    const dueIn = hoursBetween(before, res.body.complaint.dueAt);
    expect(dueIn).toBeGreaterThan(47.9);
    expect(dueIn).toBeLessThan(48.1);
    expect(res.body.complaint.escalationLevel).toBe(0);
    expect(res.body.complaint.overdue).toBe(false);
  });

  test('the second rejection makes reopenCount 2', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    await post('student1', id, 'reject', { reason: 'first' });
    await post('supervisor1', id, 'assign', { staffId: await userIdOf('hvac1') });
    await post('hvac1', id, 'start');
    await post('hvac1', id, 'resolve', { remarks: 'again' });
    const res = await post('student1', id, 'reject', { reason: 'second' });
    expect(res.body.complaint.reopenCount).toBe(2);
    expect(await feedbackOf(id)).toHaveLength(2);
  });

  test.each([{}, { reason: '' }, { reason: '   ' }, { reason: 7 }, { reason: 'x'.repeat(2001) }])('reason %j is refused (400): still RESOLVED', async (body) => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    const res = await post('student1', id, 'reject', body);
    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe('RESOLVED');
    expect(await feedbackOf(id)).toEqual([]);
    expect((await rows('SELECT reopen_count FROM complaints WHERE complaint_id = ?', [id]))[0].reopen_count).toBe(0);
  });

  test('a SERVICE complaint notifies the Administrator (it has no supervisor)', async () => {
    const id = await newComplaint({ category: 'Mess and Canteen', reporter: 'faculty1', stage: 'RESOLVED' });
    await post('faculty1', id, 'reject', { reason: 'Menu is still the same' });
    expect((await notificationsOf(id)).at(-1)).toMatchObject({ email: 'admin1@nmims.edu' });
  });
});

describe('only the reporter responds', () => {
  test('another student, faculty, staff, supervisor and administrator are all refused (403)', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    for (const user of ['student2', 'faculty1', 'hvac1', 'supervisor1', 'admin1']) {
      for (const [action, body] of [['confirm', { rating: 5 }], ['reject', { reason: 'x' }]]) {
        const res = await post(user, id, action, body);
        expect([user, action, res.status]).toEqual([user, action, 403]);
      }
    }
    expect((await post('student1', id, 'confirm', { rating: 5 })).status).toBe(200); // the reporter still can
    expect((await anonymous.post(`/api/complaints/${id}/confirm`).send({ rating: 5 })).status).toBe(401);
  });

  test('another student gets 403 even though they are a campus user (not the reporter)', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    const res = await post('student2', id, 'confirm', { rating: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/reporter/);
    expect(await statusOf(id)).toBe('RESOLVED');
    expect(await feedbackOf(id)).toEqual([]);
  });
});

describe('illegal moves: only a RESOLVED complaint can be confirmed or rejected', () => {
  test.each(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'])('confirm and reject on a %s complaint: 409', async (stage) => {
    const id = await newComplaint({ stage });
    for (const [action, body] of [['confirm', { rating: 5 }], ['reject', { reason: 'x' }]]) {
      const res = await post('student1', id, action, body);
      expect([action, res.status]).toEqual([action, 409]);
      expect(res.body.error).toMatch(/Cannot (confirm|rejectFix) a complaint that is/);
    }
    expect(await feedbackOf(id)).toEqual([]);
  });

  test('CLOSED -> REOPENED is impossible, and a closed complaint cannot be confirmed twice', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    await post('student1', id, 'confirm', { rating: 5 });
    const reject = await post('student1', id, 'reject', { reason: 'changed my mind' });
    expect(reject.status).toBe(409);
    expect(reject.body.error).toBe('Cannot rejectFix a complaint that is CLOSED (allowed from: RESOLVED)');
    expect((await post('student1', id, 'confirm', { rating: 1 })).status).toBe(409);
    expect(await statusOf(id)).toBe('CLOSED');
    expect(await feedbackOf(id)).toHaveLength(1);
  });

  test('a REOPENED complaint cannot be confirmed', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    await post('student1', id, 'reject', { reason: 'no' });
    expect((await post('student1', id, 'confirm', { rating: 5 })).status).toBe(409);
  });

  test('an INVALID complaint cannot be confirmed or rejected', async () => {
    const id = await newComplaint({ stage: 'SUBMITTED' });
    await post('supervisor1', id, 'invalid', { reason: 'duplicate' });
    expect((await post('student1', id, 'confirm', { rating: 5 })).status).toBe(409);
    expect((await post('student1', id, 'reject', { reason: 'x' })).status).toBe(409);
  });

  test('confirm and reject at the same moment: exactly one is applied', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    const student = await as('student1');
    const [a, b] = await Promise.all([
      student.post(`/api/complaints/${id}/confirm`).send({ rating: 5 }),
      student.post(`/api/complaints/${id}/reject`).send({ reason: 'not fixed' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await feedbackOf(id)).toHaveLength(1);
    expect(['CLOSED', 'REOPENED']).toContain(await statusOf(id));
  });

  test('two confirmations at the same moment save one Feedback', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    const student = await as('student1');
    const results = await Promise.all([1, 2, 3].map((n) => student.post(`/api/complaints/${id}/confirm`).send({ rating: n })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await feedbackOf(id)).toHaveLength(1);
  });

  test('unknown complaint: 404', async () => {
    expect((await post('student1', 99999, 'confirm', { rating: 5 })).status).toBe(404);
  });
});

describe('demo step 4: reject, reassign, resolve again, confirm with rating 4', () => {
  test('the whole flow, status by status', async () => {
    const student = await as('student1');
    const supervisor = await as('supervisor1');
    const hvac1 = await userIdOf('hvac1');
    const hvac2 = await userIdOf('hvac2');

    const id = await newComplaint({ title: 'Ceiling fan not working', stage: 'SUBMITTED' });
    expect((await supervisor.patch(`/api/complaints/${id}/priority`).send({ priority: 'HIGH' })).status).toBe(200);
    expect((await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 })).body.complaint.status).toBe('ASSIGNED');
    await post('hvac1', id, 'start');
    await post('hvac1', id, 'hold', { reason: 'waiting for capacitor' });
    await post('hvac1', id, 'resume');
    expect((await post('hvac1', id, 'resolve', { remarks: 'Replaced capacitor' })).body.complaint.status).toBe('RESOLVED');

    const rejected = await post('student1', id, 'reject', { reason: 'Fan still wobbles' });
    expect(rejected.body.complaint.status).toBe('REOPENED');
    // the supervisor got the notification and reassigns to someone else (row 4: only the new assignee is notified)
    const notesBefore = (await notificationsOf(id)).length;
    const reassigned = await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: hvac2 });
    expect(reassigned.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'Deepak Chouhan' } });
    const added = (await notificationsOf(id)).slice(notesBefore);
    expect(added.map((n) => n.email)).toEqual(['hvac2@nmims.edu']);

    // the previous assignee can no longer act
    expect((await post('hvac1', id, 'start')).status).toBe(403);

    await post('hvac2', id, 'start');
    await post('hvac2', id, 'resolve', { remarks: 'Rebalanced the blades' });
    const closed = await post('student1', id, 'confirm', { rating: 4, comment: 'Good now' });
    expect(closed.body.complaint.status).toBe('CLOSED');

    expect(await historyOf(id)).toEqual([
      'null>SUBMITTED', 'SUBMITTED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'IN_PROGRESS>ON_HOLD', 'ON_HOLD>IN_PROGRESS',
      'IN_PROGRESS>RESOLVED', 'RESOLVED>REOPENED', 'REOPENED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'IN_PROGRESS>RESOLVED', 'RESOLVED>CLOSED',
    ]);
    const details = (await student.get(`/api/complaints/${id}`)).body.complaint;
    expect(details).toMatchObject({ status: 'CLOSED', reopenCount: 1, priority: 'HIGH' });
    expect(details.feedback.map((f) => [f.isFixed, f.rating])).toEqual([[false, null], [true, 4]]);
    // every change is one StatusUpdate row (docs/04): 11 transitions, 11 rows
    expect(details.statusHistory).toHaveLength(11);
  });

  test('SERVICE flow: faculty raises, the administrator handles, faculty confirms', async () => {
    const id = await newComplaint({ category: 'Mess and Canteen', reporter: 'faculty1', stage: 'RESOLVED', title: 'Food quality in mess' });
    const res = await post('faculty1', id, 'confirm', { rating: 5, comment: 'Much better' });
    expect(res.body.complaint).toMatchObject({ status: 'CLOSED', assignee: { name: 'Anita Deshmukh' }, supervisor: null });
    // no maintenance staff and no supervisor was ever involved
    const involved = await rows(
      `SELECT DISTINCT u.role FROM status_updates s JOIN users u ON u.user_id = s.updated_by WHERE s.complaint_id = ?`, [id]);
    expect(involved.map((r) => r.role).sort()).toEqual(['ADMIN', 'FACULTY']);
  });
});
