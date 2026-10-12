// M4 part 3: what the supervisor does. US-05 (priority), US-06 (eligible staff, assign),
// US-11 (SERVICE assigned to an Administrator, never to staff), and mark invalid.
import { resetTestDatabase, closeDb } from './helpers/db.js';
import { as, anonymous, categoryId, locationId, complaintIdByTitle, rows, hoursBetween } from './helpers/api.js';
import { updateComplaint } from '../src/services/complaintWorkflow.js';
import { notificationService } from '../src/services/NotificationService.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

// A finished INFRASTRUCTURE complaint (supervisors handle those; SERVICE ones belong to the administrator).
const INFRA_WITH_STATUS = `SELECT c.complaint_id FROM complaints c JOIN categories g USING (category_id)
                           WHERE c.status = ? AND g.type = 'INFRASTRUCTURE' LIMIT 1`;
let hvac;
let electrical;
let mess;
let a204;
let hall;
const userId = async (username) => (await rows('SELECT user_id FROM users WHERE email = ?', [`${username}@nmims.edu`]))[0].user_id;

beforeAll(async () => {
  hvac = await categoryId('HVAC');
  electrical = await categoryId('Electrical');
  mess = await categoryId('Mess and Canteen');
  a204 = await locationId('Hostel Block A', '204');
  hall = await locationId('Hostel Mess', 'Dining Hall');
});

// Raises a new complaint as `who` and returns its id.
async function raise(who, categoryIdValue, title = 'Test complaint') {
  const location = categoryIdValue === mess ? hall : a204;
  const res = await (await as(who)).post('/api/complaints').send({ categoryId: categoryIdValue, locationId: location, title, description: `${title} (test)` });
  expect(res.status).toBe(201);
  return res.body.complaintId;
}

describe('US-05: supervisor changes the priority and dueAt is recalculated', () => {
  test('MEDIUM -> HIGH: due date moves from createdAt + 48 h to createdAt + 24 h (demo step 2)', async () => {
    const id = await raise('student1', hvac, 'Ceiling fan not working');
    const supervisor = await as('supervisor1');
    const res = await supervisor.patch(`/api/complaints/${id}/priority`).send({ priority: 'HIGH' });
    expect(res.status).toBe(200);
    expect(res.body.complaint.priority).toBe('HIGH');
    expect(hoursBetween(res.body.complaint.createdAt, res.body.complaint.dueAt)).toBe(24);
    const [row] = await rows('SELECT priority, due_at, created_at FROM complaints WHERE complaint_id = ?', [id]);
    expect(row.priority).toBe('HIGH');
    expect(hoursBetween(row.created_at, row.due_at)).toBe(24);
  });

  test('US-04: CRITICAL gives a 4-hour deadline and the complaint sorts to the top', async () => {
    const id = await raise('faculty1', electrical, 'Smoke from socket');
    const supervisor = await as('supervisor1');
    const res = await supervisor.patch(`/api/complaints/${id}/priority`).send({ priority: 'CRITICAL' });
    expect(hoursBetween(res.body.complaint.createdAt, res.body.complaint.dueAt)).toBe(4);
    const list = (await supervisor.get('/api/complaints')).body.complaints;
    // the seed has one CRITICAL complaint; with this one there are two, and both come before everything else
    expect(list.slice(0, 2).map((c) => c.complaintId)).toContain(id);
    expect(list.slice(0, 2).every((c) => c.priority === 'CRITICAL')).toBe(true);
  });

  test('lowering the priority extends the deadline (HIGH -> LOW = createdAt + 120 h)', async () => {
    const id = await raise('student1', electrical, 'Dim light');
    const res = await (await as('supervisor1')).patch(`/api/complaints/${id}/priority`).send({ priority: 'LOW' });
    expect(hoursBetween(res.body.complaint.createdAt, res.body.complaint.dueAt)).toBe(120);
  });

  test('priority can still be changed while the complaint is assigned or in progress', async () => {
    const id = await complaintIdByTitle('Washroom not cleaned in Hostel Block B'); // IN_PROGRESS
    const res = await (await as('supervisor1')).patch(`/api/complaints/${id}/priority`).send({ priority: 'HIGH' });
    expect(res.status).toBe(200);
    expect(res.body.complaint.status).toBe('IN_PROGRESS');
  });

  test.each([
    ['URGENT'], [''], [null], [3], [undefined],
  ])('invalid priority %p: 400', async (priority) => {
    const id = await raise('student1', hvac);
    const res = await (await as('supervisor1')).patch(`/api/complaints/${id}/priority`).send({ priority });
    expect(res.status).toBe(400);
  });

  test('refused (409) for CLOSED and INVALID complaints, and for RESOLVED ones', async () => {
    const [{ complaint_id: closed }] = await rows(INFRA_WITH_STATUS, ['CLOSED']);
    const [{ complaint_id: invalid }] = await rows(INFRA_WITH_STATUS, ['INVALID']);
    const resolved = await complaintIdByTitle('Study table drawer stuck');
    const supervisor = await as('supervisor1');
    for (const id of [closed, invalid, resolved]) {
      expect([id, (await supervisor.patch(`/api/complaints/${id}/priority`).send({ priority: 'LOW' })).status]).toEqual([id, 409]);
    }
  });

  test('only supervisors (administrators for SERVICE) may change priority', async () => {
    const id = await raise('student1', hvac);
    for (const user of ['student1', 'faculty1', 'electrician1']) {
      expect([user, (await (await as(user)).patch(`/api/complaints/${id}/priority`).send({ priority: 'HIGH' })).status]).toEqual([user, 403]);
    }
    // an administrator is not the handler of an INFRASTRUCTURE complaint
    expect((await (await as('admin1')).patch(`/api/complaints/${id}/priority`).send({ priority: 'HIGH' })).status).toBe(403);
    const service = await raise('faculty1', mess, 'Food quality');
    expect((await (await as('admin1')).patch(`/api/complaints/${service}/priority`).send({ priority: 'HIGH' })).status).toBe(200);
    expect((await (await as('supervisor1')).patch(`/api/complaints/${service}/priority`).send({ priority: 'LOW' })).status).toBe(403);
  });

  test('unknown complaint: 404', async () => {
    expect((await (await as('supervisor1')).patch('/api/complaints/99999/priority').send({ priority: 'HIGH' })).status).toBe(404);
  });
});

describe('US-06: only available staff with the right trade are offered; assignee and reporter are notified', () => {
  test('eligible staff for an HVAC complaint: hvac1 and hvac2 (not unavailable hvac3, not other trades, not admins)', async () => {
    const id = await raise('student1', hvac, 'Ceiling fan not working');
    const res = await (await as('supervisor1')).get(`/api/complaints/${id}/eligible-staff`);
    expect(res.status).toBe(200);
    expect(res.body.staff.map((s) => s.name).sort()).toEqual(['Deepak Chouhan', 'Imran Khan']);
    expect(res.body.staff.every((s) => s.trade === 'HVAC' && s.isAvailable === true)).toBe(true);
    expect(res.body.staff[0]).toHaveProperty('openAssignments', 0);
  });

  test('eligible staff change with the category (Electrical -> the electrician only) and availability', async () => {
    const id = await raise('student1', electrical);
    const supervisor = await as('supervisor1');
    expect((await supervisor.get(`/api/complaints/${id}/eligible-staff`)).body.staff.map((s) => s.name)).toEqual(['Ramesh Yadav']);
    await rows("UPDATE users SET is_available = FALSE WHERE email = 'electrician1@nmims.edu'");
    expect((await supervisor.get(`/api/complaints/${id}/eligible-staff`)).body.staff).toEqual([]);
    await rows("UPDATE users SET is_available = TRUE WHERE email = 'electrician1@nmims.edu'");
  });

  test('openAssignments counts the staff member\'s active complaints and orders the list by it', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    const first = await raise('student2', hvac);
    await supervisor.post(`/api/complaints/${first}/assign`).send({ staffId: await userId('hvac1') });
    const staff = (await supervisor.get(`/api/complaints/${id}/eligible-staff`)).body.staff;
    expect(staff.map((s) => [s.name, s.openAssignments])).toEqual([['Deepak Chouhan', 0], ['Imran Khan', 1]]);
  });

  test('assign: ASSIGNED, assignee and supervisor recorded, StatusUpdate written, assignee AND reporter notified (demo step 2)', async () => {
    const student = await as('student1');
    const id = await raise('student1', hvac, 'Ceiling fan not working');
    const supervisor = await as('supervisor1');
    const hvac1 = await userId('hvac1');
    const res = await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { userId: hvac1, name: 'Imran Khan' }, supervisor: { userId: supervisor.userId } });
    const history = res.body.complaint.statusHistory;
    expect(history.at(-1)).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'ASSIGNED', updatedBy: { userId: supervisor.userId } });
    const notes = await rows('SELECT user_id, message FROM notifications WHERE complaint_id = ? ORDER BY notification_id', [id]);
    const recipients = notes.map((n) => n.user_id);
    expect(recipients).toContain(hvac1); // assignee
    expect(recipients).toContain(student.userId); // reporter
    expect(notes.find((n) => n.user_id === hvac1).message).toMatch(/assigned to you/);
    // the assigned complaint now shows up in the staff member's list, and the reporter can follow it (US-03)
    expect((await (await as('hvac1')).get('/api/complaints')).body.complaints.map((c) => c.complaintId)).toContain(id);
    expect((await student.get(`/api/complaints/${id}`)).body.complaint.status).toBe('ASSIGNED');
  });

  test('wrong trade (409), unavailable staff (409), not staff at all (409)', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    const attempt = async (staffId) => supervisor.post(`/api/complaints/${id}/assign`).send({ staffId });
    const plumber = await attempt(await userId('plumber1'));
    expect(plumber.status).toBe(409);
    expect(plumber.body.error).toMatch(/trade "HVAC"/);
    const unavailable = await attempt(await userId('hvac3'));
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.error).toMatch(/not available/);
    expect((await attempt(await userId('student2'))).status).toBe(409);
    expect((await attempt(await userId('admin1'))).status).toBe(409);
    const [{ status, assignee_id }] = await rows('SELECT status, assignee_id FROM complaints WHERE complaint_id = ?', [id]);
    expect([status, assignee_id]).toEqual(['SUBMITTED', null]); // nothing changed
    expect(await rows('SELECT 1 FROM status_updates WHERE complaint_id = ? AND to_status = "ASSIGNED"', [id])).toHaveLength(0);
  });

  test('missing or bad staffId: 400; unknown user: 404', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    for (const body of [{}, { staffId: 'abc' }, { staffId: 0 }, { staffId: -1 }, { staffId: null }]) {
      expect([JSON.stringify(body), (await supervisor.post(`/api/complaints/${id}/assign`).send(body)).status]).toEqual([JSON.stringify(body), 400]);
    }
    expect((await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: 99999 })).status).toBe(404);
  });

  test('assigning twice is a 409 (already ASSIGNED)', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    expect((await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: await userId('hvac1') })).status).toBe(200);
    const again = await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: await userId('hvac2') });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/Cannot assign a complaint that is ASSIGNED/);
    expect((await rows('SELECT assignee_id FROM complaints WHERE complaint_id = ?', [id]))[0].assignee_id).toBe(await userId('hvac1'));
  });

  test('assigning a CLOSED or INVALID complaint is a 409', async () => {
    const [{ complaint_id: closed }] = await rows(INFRA_WITH_STATUS, ['CLOSED']);
    expect((await (await as('supervisor1')).post(`/api/complaints/${closed}/assign`).send({ staffId: await userId('hvac1') })).status).toBe(409);
  });

  test('two simultaneous assignments: exactly one wins, the other gets a 409 (row lock)', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    const [a, b] = await Promise.all([
      supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: await userId('hvac1') }),
      supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: await userId('hvac2') }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await rows('SELECT 1 FROM status_updates WHERE complaint_id = ? AND to_status = "ASSIGNED"', [id])).toHaveLength(1);
    expect(await rows('SELECT 1 FROM notifications WHERE complaint_id = ? AND message LIKE "%assigned to you%"', [id])).toHaveLength(1);
  });

  test('only a supervisor assigns INFRASTRUCTURE complaints', async () => {
    const id = await raise('student1', hvac);
    const hvac1 = await userId('hvac1');
    for (const user of ['student1', 'faculty1', 'electrician1', 'hvac1']) {
      expect([user, (await (await as(user)).post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 })).status]).toEqual([user, 403]);
      expect([user, (await (await as(user)).get(`/api/complaints/${id}/eligible-staff`)).status]).toEqual([user, 403]);
    }
    expect((await (await as('admin1')).post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 })).status).toBe(403);
    expect((await (await as('admin1')).get(`/api/complaints/${id}/eligible-staff`)).status).toBe(403);
    expect((await anonymous.post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 })).status).toBe(401);
  });

  test('a REOPENED complaint can be assigned again (row 4) and only the assignee is notified', async () => {
    const id = await raise('student1', hvac);
    // set REOPENED directly: the reject flow that normally gets it there arrives in M5
    await rows("UPDATE complaints SET status = 'REOPENED', supervisor_id = ?, assignee_id = ? WHERE complaint_id = ?", [await userId('supervisor1'), await userId('hvac1'), id]);
    const before = (await rows('SELECT COUNT(*) n FROM notifications WHERE complaint_id = ?', [id]))[0].n;
    const res = await (await as('supervisor1')).post(`/api/complaints/${id}/assign`).send({ staffId: await userId('hvac2') });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'Deepak Chouhan' } });
    const notes = await rows('SELECT user_id FROM notifications WHERE complaint_id = ? ORDER BY notification_id', [id]);
    expect(notes.length - before).toBe(1);
    expect(notes.at(-1).user_id).toBe(await userId('hvac2'));
  });
});

describe('US-11: SERVICE complaints go to an Administrator, never to maintenance staff', () => {
  test('the administrator takes a SERVICE complaint (no staffId needed): ASSIGNED to the admin, no supervisor involved', async () => {
    const id = await raise('faculty1', mess, 'Food quality in mess');
    const admin = await as('admin1');
    const res = await admin.post(`/api/complaints/${id}/assign`).send({});
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { userId: admin.userId }, supervisor: null });
  });

  test('assigning it to maintenance staff is refused (409), whoever tries', async () => {
    const id = await raise('faculty1', mess, 'Stale food');
    for (const staff of ['hvac1', 'housekeeper1', 'plumber1']) {
      const res = await (await as('admin1')).post(`/api/complaints/${id}/assign`).send({ staffId: await userId(staff) });
      expect([staff, res.status]).toEqual([staff, 409]);
      expect(res.body.error).toMatch(/only be assigned to an Administrator/);
    }
    expect((await rows('SELECT assignee_id FROM complaints WHERE complaint_id = ?', [id]))[0].assignee_id).toBeNull();
  });

  test('a supervisor cannot assign, prioritise or list assignees for a SERVICE complaint (403)', async () => {
    const id = await raise('faculty1', mess, 'Long queue');
    const supervisor = await as('supervisor1');
    expect((await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: await userId('admin1') })).status).toBe(403);
    expect((await supervisor.get(`/api/complaints/${id}/eligible-staff`)).status).toBe(403);
    expect((await supervisor.patch(`/api/complaints/${id}/priority`).send({ priority: 'HIGH' })).status).toBe(403);
    expect((await supervisor.post(`/api/complaints/${id}/invalid`).send({ reason: 'x' })).status).toBe(403);
  });

  test('the seeded SERVICE complaints already satisfy the rule: no maintenance staff assignee', async () => {
    const bad = await rows(`SELECT c.complaint_id FROM complaints c JOIN categories g USING (category_id)
                            JOIN users u ON u.user_id = c.assignee_id WHERE g.type = 'SERVICE' AND u.role <> 'ADMIN'`);
    expect(bad).toEqual([]);
  });
});

describe('mark invalid (row 2)', () => {
  test('supervisor marks a SUBMITTED complaint invalid with a reason: INVALID, reporter notified', async () => {
    const id = await raise('student1', hvac, 'Duplicate report');
    const res = await (await as('supervisor1')).post(`/api/complaints/${id}/invalid`).send({ reason: 'Duplicate of an existing complaint' });
    expect(res.status).toBe(200);
    expect(res.body.complaint.status).toBe('INVALID');
    expect(res.body.complaint.statusHistory.at(-1)).toMatchObject({ toStatus: 'INVALID', remarks: 'Duplicate of an existing complaint' });
    const notes = await rows('SELECT user_id, message FROM notifications WHERE complaint_id = ? ORDER BY notification_id DESC LIMIT 1', [id]);
    expect(notes[0].user_id).toBe((await as('student1')).userId);
    expect(notes[0].message).toMatch(/marked invalid/);
  });

  test('a reason is required (400) and is limited to 2000 characters', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 5 }, { reason: 'x'.repeat(2001) }]) {
      expect([JSON.stringify(body).slice(0, 30), (await supervisor.post(`/api/complaints/${id}/invalid`).send(body)).status])
        .toEqual([JSON.stringify(body).slice(0, 30), 400]);
    }
    expect((await rows('SELECT status FROM complaints WHERE complaint_id = ?', [id]))[0].status).toBe('SUBMITTED');
  });

  test('long reasons are accepted and the notification text is shortened to fit', async () => {
    const id = await raise('student1', hvac);
    const res = await (await as('supervisor1')).post(`/api/complaints/${id}/invalid`).send({ reason: 'r'.repeat(1500) });
    expect(res.status).toBe(200);
    const [note] = await rows('SELECT message FROM notifications WHERE complaint_id = ? ORDER BY notification_id DESC LIMIT 1', [id]);
    expect(note.message.length).toBeLessThanOrEqual(255);
  });

  test('only a SUBMITTED complaint can be marked invalid (409 once assigned)', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: await userId('hvac1') });
    const res = await supervisor.post(`/api/complaints/${id}/invalid`).send({ reason: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Cannot markInvalid a complaint that is ASSIGNED/);
  });

  test('INVALID is final: it cannot be assigned or marked invalid again', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    await supervisor.post(`/api/complaints/${id}/invalid`).send({ reason: 'dup' });
    expect((await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: await userId('hvac1') })).status).toBe(409);
    expect((await supervisor.post(`/api/complaints/${id}/invalid`).send({ reason: 'again' })).status).toBe(409);
  });

  test('students and staff cannot mark complaints invalid', async () => {
    const id = await raise('student1', hvac);
    for (const user of ['student1', 'hvac1']) {
      expect([user, (await (await as(user)).post(`/api/complaints/${id}/invalid`).send({ reason: 'x' })).status]).toEqual([user, 403]);
    }
  });
});

describe('the transaction wrapper', () => {
  // Make the LAST step (saving notifications) fail, after the complaint and StatusUpdate rows were already written.
  async function withFailingNotifications(fn) {
    const original = notificationService.dispatch;
    notificationService.dispatch = async () => { throw new Error('notification store is down'); };
    try { return await fn(); } finally { notificationService.dispatch = original; }
  }

  test('if saving notifications fails, the status change and StatusUpdate are rolled back too', async () => {
    const id = await raise('student1', hvac);
    const supervisor = await as('supervisor1');
    const hvac1 = await userId('hvac1');
    const [before] = await rows('SELECT (SELECT COUNT(*) FROM status_updates) s, (SELECT COUNT(*) FROM notifications) n');
    const res = await withFailingNotifications(() => supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error'); // internals are not leaked
    const [after] = await rows('SELECT (SELECT COUNT(*) FROM status_updates) s, (SELECT COUNT(*) FROM notifications) n');
    expect(after).toEqual(before);
    expect((await rows('SELECT status, assignee_id, supervisor_id FROM complaints WHERE complaint_id = ?', [id]))[0])
      .toEqual({ status: 'SUBMITTED', assignee_id: null, supervisor_id: null });
    // and the complaint is still assignable afterwards (the lock was released)
    expect((await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 })).status).toBe(200);
  });

  test('an error inside the domain operation also leaves nothing behind', async () => {
    const id = await raise('student1', hvac);
    const supervisorId = await userId('supervisor1');
    const staff = { userId: await userId('hvac1'), role: 'STAFF', trade: 'HVAC', isAvailable: true, name: 'Imran Khan' };
    await expect(updateComplaint(id, (complaint) => {
      complaint.assignTo(staff, { actor: { userId: supervisorId, role: 'SUPERVISOR' }, now: new Date() });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect((await rows('SELECT status FROM complaints WHERE complaint_id = ?', [id]))[0].status).toBe('SUBMITTED');
  });

  test('updating a complaint that does not exist is a 404', async () => {
    await expect(updateComplaint(999999, () => {})).rejects.toMatchObject({ httpStatus: 404 });
  });
});
