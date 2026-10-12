// M5 part 1: US-07, the assignee updates the status: start, hold (reason), resume, resolve (remarks).
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, anonymous, newComplaint, complaintIdByTitle, rows, statusOf, historyOf, notificationsOf, userIdOf, addUser,
} from './helpers/api.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

const act = async (user, id, action, body = {}) => (await as(user)).post(`/api/complaints/${id}/${action}`).send(body);

describe('US-07: the assignee works through the complaint (demo step 3)', () => {
  test('start -> hold with a reason -> resume -> resolve with remarks, each step recorded', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED' });
    let res = await act('hvac1', id, 'start');
    expect(res.status).toBe(200);
    expect(res.body.complaint.status).toBe('IN_PROGRESS');

    res = await act('hvac1', id, 'hold', { reason: 'waiting for capacitor' });
    expect(res.status).toBe(200);
    expect(res.body.complaint.status).toBe('ON_HOLD');
    expect(res.body.complaint.statusHistory.at(-1)).toMatchObject({ fromStatus: 'IN_PROGRESS', toStatus: 'ON_HOLD', remarks: 'waiting for capacitor' });

    res = await act('hvac1', id, 'resume');
    expect(res.body.complaint.status).toBe('IN_PROGRESS');

    res = await act('hvac1', id, 'resolve', { remarks: 'Replaced capacitor and tested' });
    expect(res.status).toBe(200);
    expect(res.body.complaint.status).toBe('RESOLVED');
    expect(res.body.complaint.resolvedAt).not.toBeNull();
    expect(res.body.complaint.closedAt).toBeNull();

    expect(await historyOf(id)).toEqual([
      'null>SUBMITTED', 'SUBMITTED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'IN_PROGRESS>ON_HOLD', 'ON_HOLD>IN_PROGRESS', 'IN_PROGRESS>RESOLVED',
    ]);
    // every step is attributed to the staff member and has a timestamp
    const last = res.body.complaint.statusHistory.slice(2);
    expect(last.every((h) => h.updatedBy.name === 'Imran Khan' && h.updatedAt)).toBe(true);
  });

  test('resolving asks the reporter to confirm; start, hold and resume send no notification', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED', reporter: 'student2' });
    const before = (await notificationsOf(id)).length;
    await act('hvac1', id, 'start');
    await act('hvac1', id, 'hold', { reason: 'parts' });
    await act('hvac1', id, 'resume');
    expect((await notificationsOf(id)).length).toBe(before);
    await act('hvac1', id, 'resolve', { remarks: 'Done' });
    const notes = await notificationsOf(id);
    expect(notes.length).toBe(before + 1);
    expect(notes.at(-1)).toMatchObject({ email: 'student2@nmims.edu' });
    expect(notes.at(-1).message).toMatch(/resolved\. Please confirm or reject/);
  });

  test('the reporter can follow every step (US-03)', async () => {
    const id = await newComplaint({ stage: 'IN_PROGRESS' });
    const res = await (await as('student1')).get(`/api/complaints/${id}`);
    expect(res.body.complaint.status).toBe('IN_PROGRESS');
    expect(res.body.complaint.statusHistory.map((h) => h.toStatus)).toEqual(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS']);
  });

  test.each([
    ['hold', {}], ['hold', { reason: '' }], ['hold', { reason: '   ' }], ['hold', { reason: 42 }], ['hold', { reason: 'x'.repeat(2001) }],
  ])('on hold needs a reason: %s %j -> 400, nothing changes', async (action, body) => {
    const id = await newComplaint({ stage: 'IN_PROGRESS' });
    const before = await historyOf(id);
    const res = await act('hvac1', id, action, body);
    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe('IN_PROGRESS');
    expect(await historyOf(id)).toEqual(before);
  });

  test.each([{}, { remarks: '' }, { remarks: '  ' }, { remarks: ['done'] }])('resolve needs remarks: %j -> 400, nothing changes', async (body) => {
    const id = await newComplaint({ stage: 'IN_PROGRESS' });
    const res = await act('hvac1', id, 'resolve', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/remarks is required/);
    expect(await statusOf(id)).toBe('IN_PROGRESS');
  });

  test('a complaint on hold can only be resumed (not resolved or started)', async () => {
    const id = await newComplaint({ stage: 'ON_HOLD' });
    expect((await act('hvac1', id, 'resolve', { remarks: 'x' })).status).toBe(409);
    expect((await act('hvac1', id, 'start')).status).toBe(409);
    expect((await act('hvac1', id, 'resume')).status).toBe(200);
  });
});

describe('illegal moves are rejected with 409 and a clear message', () => {
  test.each([
    ['start', 'IN_PROGRESS'], ['start', 'ON_HOLD'], ['start', 'RESOLVED'],
    ['hold', 'ASSIGNED'], ['hold', 'ON_HOLD'], ['hold', 'RESOLVED'],
    ['resume', 'ASSIGNED'], ['resume', 'IN_PROGRESS'], ['resume', 'RESOLVED'],
    ['resolve', 'ASSIGNED'], ['resolve', 'ON_HOLD'], ['resolve', 'RESOLVED'],
  ])('%s on a complaint that is %s', async (action, stage) => {
    const id = await newComplaint({ stage });
    const before = await historyOf(id);
    const res = await act('hvac1', id, action, { reason: 'x', remarks: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/^Cannot /);
    expect(await historyOf(id)).toEqual(before);
  });

  test('work cannot start before assignment (SUBMITTED): 409', async () => {
    const id = await newComplaint({ stage: 'SUBMITTED' });
    for (const action of ['start', 'hold', 'resume', 'resolve']) {
      expect([action, (await act('hvac1', id, action, { reason: 'x', remarks: 'x' })).status]).toEqual([action, 409]);
    }
  });

  test('a CLOSED complaint accepts no work (SUBMITTED -> RESOLVED style jumps never happen)', async () => {
    const id = await newComplaint({ stage: 'RESOLVED' });
    await (await as('student1')).post(`/api/complaints/${id}/confirm`).send({ rating: 5 });
    for (const action of ['start', 'hold', 'resume', 'resolve']) {
      expect([action, (await act('hvac1', id, action, { reason: 'x', remarks: 'x' })).status]).toEqual([action, 409]);
    }
  });

  test('an ESCALATED complaint cannot be worked on until the supervisor resolves the escalation', async () => {
    const id = await complaintIdByTitle('No water supply in Hostel Block B'); // seed: ESCALATED, assigned to plumber1
    for (const action of ['start', 'hold', 'resume', 'resolve']) {
      expect([action, (await act('plumber1', id, action, { reason: 'x', remarks: 'x' })).status]).toEqual([action, 409]);
    }
    expect(await statusOf(id)).toBe('ESCALATED');
  });

  test('two conflicting updates at once: exactly one wins (hold vs resolve)', async () => {
    const id = await newComplaint({ stage: 'IN_PROGRESS' });
    const hvac1 = await as('hvac1');
    const [a, b] = await Promise.all([
      hvac1.post(`/api/complaints/${id}/hold`).send({ reason: 'parts' }),
      hvac1.post(`/api/complaints/${id}/resolve`).send({ remarks: 'done' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const history = await historyOf(id);
    expect(history.filter((h) => h.startsWith('IN_PROGRESS>'))).toHaveLength(1);
  });
});

describe('only THE assignee may work on a complaint', () => {
  test('another staff member of the same trade gets 403 on every action', async () => {
    const stages = { start: 'ASSIGNED', hold: 'IN_PROGRESS', resume: 'ON_HOLD', resolve: 'IN_PROGRESS' };
    for (const [action, stage] of Object.entries(stages)) {
      const id = await newComplaint({ stage });
      const res = await act('hvac2', id, action, { reason: 'x', remarks: 'x' });
      expect([action, res.status]).toEqual([action, 403]);
      expect(res.body.error).toMatch(/assignee/);
      expect(await statusOf(id)).toBe(stage);
    }
  });

  test('staff of another trade, and an administrator on an INFRASTRUCTURE complaint, get 403', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED' });
    for (const user of ['electrician1', 'plumber1', 'admin1']) {
      expect([user, (await act(user, id, 'start')).status]).toEqual([user, 403]);
    }
  });

  test('students, faculty and supervisors cannot use the work endpoints (403); anonymous gets 401', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED' });
    for (const user of ['student1', 'faculty1', 'supervisor1']) {
      expect([user, (await act(user, id, 'start')).status]).toEqual([user, 403]);
    }
    expect((await anonymous.post(`/api/complaints/${id}/start`).send({})).status).toBe(401);
  });

  test('after the complaint is reassigned the previous assignee loses access', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED' });
    // reopen-style reassignment is covered in the resolution tests; here force a new assignee directly
    await rows('UPDATE complaints SET assignee_id = ? WHERE complaint_id = ?', [await userIdOf('hvac2'), id]);
    expect((await act('hvac1', id, 'start')).status).toBe(403);
    expect((await act('hvac2', id, 'start')).status).toBe(200);
  });

  test('unknown complaint: 404; malformed id: 400', async () => {
    expect((await act('hvac1', 99999, 'start')).status).toBe(404);
    expect((await act('hvac1', 'abc', 'start')).status).toBe(400);
  });
});

describe('SERVICE complaints: the Administrator is the assignee and does the work (US-11)', () => {
  test('admin1 takes a mess complaint, starts, holds, resumes and resolves it', async () => {
    const id = await newComplaint({ category: 'Mess and Canteen', reporter: 'faculty1', stage: 'ASSIGNED', title: 'Food quality in mess' });
    expect((await act('admin1', id, 'start')).status).toBe(200);
    expect((await act('admin1', id, 'hold', { reason: 'waiting for the vendor' })).status).toBe(200);
    expect((await act('admin1', id, 'resume')).status).toBe(200);
    const res = await act('admin1', id, 'resolve', { remarks: 'Vendor replaced the menu item' });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'RESOLVED', assignee: { name: 'Anita Deshmukh' }, supervisor: null });
    expect((await notificationsOf(id)).at(-1)).toMatchObject({ email: 'faculty1@nmims.edu' });
  });

  test('another administrator or any maintenance staff member cannot work on it', async () => {
    const id = await newComplaint({ category: 'Mess and Canteen', reporter: 'faculty1', stage: 'ASSIGNED' });
    await addUser('admin2', 'ADMIN');
    expect((await act('admin2', id, 'start')).status).toBe(403);
    expect((await act('hvac1', id, 'start')).status).toBe(403);
    expect((await act('housekeeper1', id, 'start')).status).toBe(403);
    expect(await statusOf(id)).toBe('ASSIGNED');
  });
});

describe('what the staff member sees', () => {
  test('GET /api/complaints lists only their assignments, with the new status after each step', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED' });
    const hvac1 = await as('hvac1');
    let mine = (await hvac1.get('/api/complaints')).body.complaints;
    expect(mine.find((c) => c.complaintId === id).status).toBe('ASSIGNED');
    await act('hvac1', id, 'start');
    mine = (await hvac1.get('/api/complaints')).body.complaints;
    expect(mine.find((c) => c.complaintId === id).status).toBe('IN_PROGRESS');
    expect(mine.every((c) => c.assignee.userId === hvac1.userId)).toBe(true);
  });
});
