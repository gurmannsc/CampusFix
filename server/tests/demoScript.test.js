// The demo script (docs/07-demo-script.md) as one test, step by step, on the freshly seeded database.
// If this passes, the live demo works through the API; the browser steps only show the same calls.
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, raiseMultipart, PNG, categoryId, locationId, userIdOf, rows, notificationsOf, historyOf, hoursBetween,
} from './helpers/api.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

// state carried from step to step
const demo = {};
const asUser = (name) => as(name);

describe('docs/07 demo script', () => {
  test('seed check: the accounts and scenarios the script relies on exist', async () => {
    for (const name of ['student1', 'faculty1', 'electrician1', 'plumber1', 'carpenter1', 'supervisor1', 'admin1']) {
      expect([name, (await asUser(name)).userId]).toEqual([name, expect.any(Number)]); // logs in with demo123
    }
    const live = await rows("SELECT title, status FROM complaints WHERE complaint_id > 32 ORDER BY complaint_id");
    expect(live.map((c) => c.status)).toEqual(['ASSIGNED', 'ESCALATED', 'RESOLVED', 'SUBMITTED', 'SUBMITTED', 'SUBMITTED', 'IN_PROGRESS', 'ON_HOLD']);
    expect((await rows("SELECT COUNT(*) n FROM complaints WHERE status IN ('CLOSED','INVALID')"))[0].n).toBeGreaterThanOrEqual(30); // "about 30 closed historical complaints"
  });

  test('1. student1 raises "Ceiling fan not working" (HVAC, Hostel Block A, floor 2, room 204, with a photo): ID, SUBMITTED, MEDIUM, 48 h', async () => {
    const student = await asUser('student1');
    const res = await raiseMultipart(student, {
      categoryId: await categoryId('HVAC'), locationId: await locationId('Hostel Block A', '204'),
      title: 'Ceiling fan not working', description: 'Fan does not start at any speed.',
    }, PNG);
    expect(res.status).toBe(201);
    demo.id = res.body.complaintId;
    expect(res.body.complaint).toMatchObject({
      status: 'SUBMITTED', priority: 'MEDIUM', title: 'Ceiling fan not working',
      location: { block: 'Hostel Block A', floor: 2, room: '204' }, photoUrl: `/api/complaints/${demo.id}/photo`,
    });
    expect(hoursBetween(res.body.complaint.createdAt, res.body.complaint.dueAt)).toBe(48);
  });

  test('2. supervisor1 sees the list sorted by priority and due date, raises it to HIGH (due date updates), sees only available HVAC staff, assigns', async () => {
    const supervisor = await asUser('supervisor1');
    const list = (await supervisor.get('/api/complaints')).body.complaints;
    expect(list[0]).toMatchObject({ priority: 'CRITICAL' });
    expect(list.map((c) => c.complaintId)).toContain(demo.id);
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const active = list.filter((c) => !['CLOSED', 'INVALID'].includes(c.status));
    expect(active.map((c) => rank[c.priority])).toEqual([...active.map((c) => rank[c.priority])].sort((a, b) => a - b));

    const raised = await supervisor.patch(`/api/complaints/${demo.id}/priority`).send({ priority: 'HIGH' });
    expect(hoursBetween(raised.body.complaint.createdAt, raised.body.complaint.dueAt)).toBe(24); // the due date changed from 48 h to 24 h

    const eligible = (await supervisor.get(`/api/complaints/${demo.id}/eligible-staff`)).body.staff;
    expect(eligible.map((s) => s.name).sort()).toEqual(['Deepak Chouhan', 'Imran Khan']); // HVAC only, available only (hvac3 is not offered)

    const assigned = await supervisor.post(`/api/complaints/${demo.id}/assign`).send({ staffId: await userIdOf('hvac1') });
    expect(assigned.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'Imran Khan' } });
  });

  test('3. staff: Start work, Put on hold "waiting for capacitor", Resume, Mark resolved with remarks', async () => {
    const staff = await asUser('hvac1');
    const step = async (action, body = {}) => (await staff.post(`/api/complaints/${demo.id}/${action}`).send(body)).body.complaint.status;
    expect(await step('start')).toBe('IN_PROGRESS');
    expect(await step('hold', { reason: 'waiting for capacitor' })).toBe('ON_HOLD');
    expect(await step('resume')).toBe('IN_PROGRESS');
    expect(await step('resolve', { remarks: 'Replaced the capacitor and tested all speeds' })).toBe('RESOLVED');
  });

  test('4. student1 rejects the fix with a reason: REOPENED, supervisor notified; reassign, resolve again, confirm with rating 4: CLOSED', async () => {
    const student = await asUser('student1');
    const supervisor = await asUser('supervisor1');
    const rejected = await student.post(`/api/complaints/${demo.id}/reject`).send({ reason: 'Fan still wobbles' });
    expect(rejected.body.complaint.status).toBe('REOPENED');
    expect((await notificationsOf(demo.id)).at(-1)).toMatchObject({ email: 'supervisor1@nmims.edu' }); // "supervisor gets a notification"

    const reassigned = await supervisor.post(`/api/complaints/${demo.id}/assign`).send({ staffId: await userIdOf('hvac2') });
    expect(reassigned.body.complaint.status).toBe('ASSIGNED');
    const staff = await asUser('hvac2');
    await staff.post(`/api/complaints/${demo.id}/start`).send({});
    expect((await staff.post(`/api/complaints/${demo.id}/resolve`).send({ remarks: 'Rebalanced the blades' })).body.complaint.status).toBe('RESOLVED');

    const closed = await student.post(`/api/complaints/${demo.id}/confirm`).send({ rating: 4, comment: 'Good now' });
    expect(closed.body.complaint).toMatchObject({ status: 'CLOSED', reopenCount: 1 });
    expect(closed.body.complaint.feedback.map((f) => [f.isFixed, f.rating])).toEqual([[false, null], [true, 4]]);
    expect(await historyOf(demo.id)).toHaveLength(11); // every change is one StatusUpdate row
  });

  test('5. admin1 "Run deadline check": the overdue complaint is ESCALATED (supervisor notified), the 25-hour one goes to level 2 (admin notified), the 49-hour resolved one auto-closes', async () => {
    const overdue = (await rows("SELECT complaint_id id FROM complaints WHERE title = 'No power in Classroom 204 sockets'"))[0].id;
    const escalated = (await rows("SELECT complaint_id id FROM complaints WHERE title = 'No water supply in Hostel Block B'"))[0].id;
    const resolved = (await rows("SELECT complaint_id id FROM complaints WHERE title = 'Study table drawer stuck'"))[0].id;
    const supervisorBefore = (await notificationsOf(overdue)).length;
    const adminBefore = (await notificationsOf(escalated)).filter((n) => n.email === 'admin1@nmims.edu').length;

    const res = await (await asUser('admin1')).post('/api/admin/run-deadline-check').send({});
    expect(res.status).toBe(200);
    expect(res.body.escalated.map((c) => c.complaintId)).toEqual([overdue]);
    expect(res.body.reescalated.map((c) => [c.complaintId, c.level])).toEqual([[escalated, 2]]);
    expect(res.body.autoClosed.map((c) => c.complaintId)).toEqual([resolved]);

    const status = async (id) => (await rows('SELECT status, escalation_level l FROM complaints WHERE complaint_id = ?', [id]))[0];
    expect(await status(overdue)).toEqual({ status: 'ESCALATED', l: 1 });
    expect(await status(escalated)).toEqual({ status: 'ESCALATED', l: 2 });
    expect((await status(resolved)).status).toBe('CLOSED');
    expect((await notificationsOf(overdue)).slice(supervisorBefore).map((n) => n.email)).toEqual(['supervisor1@nmims.edu']);
    expect((await notificationsOf(escalated)).filter((n) => n.email === 'admin1@nmims.edu').length).toBe(adminBefore + 1);
  });

  test('6. faculty1 reports "Food quality in mess" (SERVICE): it goes to admin1, not to staff', async () => {
    const res = await raiseMultipart(await asUser('faculty1'), {
      categoryId: await categoryId('Mess and Canteen'), locationId: await locationId('Hostel Mess', 'Dining Hall'),
      title: 'Food quality in mess', description: 'Dinner was undercooked and cold.',
    });
    expect(res.status).toBe(201);
    demo.service = res.body.complaintId;
    expect((await notificationsOf(demo.service)).map((n) => n.email)).toEqual(['admin1@nmims.edu']); // not the supervisor
    const admin = await asUser('admin1');
    expect((await admin.get(`/api/complaints/${demo.service}/eligible-staff`)).body.staff.map((s) => s.name)).toEqual(['Anita Deshmukh']);
    const toStaff = await admin.post(`/api/complaints/${demo.service}/assign`).send({ staffId: await userIdOf('housekeeper1') });
    expect(toStaff.status).toBe(409); // never assigned to maintenance staff
    expect((await admin.post(`/api/complaints/${demo.service}/assign`).send({})).body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'Anita Deshmukh' } });
  });

  test('7. admin dashboard with filters: resolution time, workload, breaches, ratings', async () => {
    const admin = await asUser('admin1');
    const all = (await admin.get('/api/dashboard')).body;
    expect(all.summary.total).toBe(42); // 40 seeded + the two raised in this script
    expect(all.summary).toMatchObject({ avgResolutionHours: expect.any(Number), breachPercent: expect.any(Number), avgRating: expect.any(Number) });
    expect(all.workload.length).toBeGreaterThanOrEqual(9);
    expect(all.ratings.distribution[4]).toBeGreaterThanOrEqual(1); // the rating 4 given in step 4
    expect(all.summary.breached).toBeGreaterThanOrEqual(6); // the escalations of step 5 count as breaches

    const hvac = (await admin.get('/api/dashboard?category=HVAC')).body;
    expect(hvac.byCategory.map((c) => c.name)).toEqual(['HVAC']);
    expect(hvac.summary.total).toBeLessThan(all.summary.total);
    expect(hvac.workload.find((w) => w.name === 'Deepak Chouhan').completed).toBeGreaterThanOrEqual(1); // hvac2 finished the repair of step 4
    const block = (await admin.get('/api/dashboard?block=Hostel%20Mess')).body;
    expect(block.byCategory.map((c) => c.name)).toEqual(['Mess and Canteen']);
    const range = (await admin.get(`/api/dashboard?from=${new Date().toISOString().slice(0, 10)}`)).body;
    expect(range.summary.total).toBeGreaterThanOrEqual(2); // the complaints created today, in this script
  });

  test('8. a rejected illegal transition (the state machine next to the state diagram)', async () => {
    const student = await asUser('student1');
    // CLOSED -> REOPENED is not in the diagram
    const reopen = await student.post(`/api/complaints/${demo.id}/reject`).send({ reason: 'let me try again' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error).toBe('Cannot rejectFix a complaint that is CLOSED (allowed from: RESOLVED)');
    // SUBMITTED -> RESOLVED is not either
    const fresh = await raiseMultipart(student, { categoryId: await categoryId('HVAC'), locationId: await locationId('Hostel Block A', '204'), description: 'x' });
    const skip = await (await asUser('hvac1')).post(`/api/complaints/${fresh.body.complaintId}/resolve`).send({ remarks: 'done' });
    expect(skip.status).toBe(409);
    expect(skip.body.error).toMatch(/Cannot markResolved a complaint that is SUBMITTED/);
  });
});
