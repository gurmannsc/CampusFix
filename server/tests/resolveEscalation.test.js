// M5 part 3: row 14, the supervisor resolves an ESCALATED complaint by reassigning or extending the deadline.
// (The Timer that creates escalations comes in M6; here escalated complaints come from the seed or are set up directly.)
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, anonymous, newComplaint, complaintIdByTitle, rows, statusOf, historyOf, notificationsOf, userIdOf, addUser, hoursBetween,
} from './helpers/api.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

const resolve = async (user, id, body) => (await as(user)).post(`/api/complaints/${id}/resolve-escalation`).send(body);
const inHours = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

// Puts a complaint into ESCALATED the way the Timer would (level 1, overdue, one Escalation row).
async function escalate(id) {
  const past = new Date(Date.now() - 6 * 3600 * 1000);
  await rows("UPDATE complaints SET status = 'ESCALATED', escalation_level = 1, due_at = ? WHERE complaint_id = ?", [past, id]);
  await rows('INSERT INTO escalations (complaint_id, level, reason, escalated_at) VALUES (?, 1, ?, ?)', [id, 'Complaint overdue', past]);
}

describe('reassign', () => {
  test('to another eligible staff member: ASSIGNED, new assignee notified, fresh deadline, level back to 0', async () => {
    const id = await complaintIdByTitle('No water supply in Hostel Block B'); // seed: ESCALATED level 1, plumber1
    const plumber2 = await addUser('plumber2', 'STAFF', { trade: 'Plumbing', is_available: true });
    const before = Date.now();
    const res = await resolve('supervisor1', id, { action: 'reassign', staffId: plumber2 });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'plumber2' }, escalationLevel: 0, overdue: false });
    expect(res.body.complaint.statusHistory.at(-1)).toMatchObject({ fromStatus: 'ESCALATED', toStatus: 'ASSIGNED', updatedBy: { name: 'Rajiv Malhotra' } });
    const dueIn = hoursBetween(before, res.body.complaint.dueAt); // HIGH = 24 h from now
    expect(dueIn).toBeGreaterThan(23.9);
    expect(dueIn).toBeLessThan(24.1);
    const note = (await notificationsOf(id)).at(-1);
    expect(note).toMatchObject({ email: 'plumber2@nmims.edu' });
    expect(note.message).toMatch(/reassigned to you/);
    // the escalation history is kept
    expect(res.body.complaint.escalations).toHaveLength(1);
    // the new assignee can work on it; the old one cannot
    expect((await (await as('plumber2')).post(`/api/complaints/${id}/start`).send({})).status).toBe(200);
    expect((await (await as('plumber1')).post(`/api/complaints/${id}/resolve`).send({ remarks: 'x' })).status).toBe(403);
  });

  test('the same guard as a normal assignment: wrong trade, unavailable, not staff (409)', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED', category: 'Plumbing', staff: 'plumber1' });
    await escalate(id);
    await addUser('plumber3', 'STAFF', { trade: 'Plumbing', is_available: false });
    for (const staff of ['electrician1', 'plumber3', 'student1', 'admin1']) {
      const res = await resolve('supervisor1', id, { action: 'reassign', staffId: await userIdOf(staff) });
      expect([staff, res.status]).toEqual([staff, 409]);
    }
    expect(await statusOf(id)).toBe('ESCALATED');
  });

  test('staffId is required (400) and must exist (404)', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED', category: 'Plumbing', staff: 'plumber1' });
    await escalate(id);
    expect((await resolve('supervisor1', id, { action: 'reassign' })).status).toBe(400);
    expect((await resolve('supervisor1', id, { action: 'reassign', staffId: 'x' })).status).toBe(400);
    expect((await resolve('supervisor1', id, { action: 'reassign', staffId: 99999 })).status).toBe(404);
  });

  test('an unassigned complaint that escalated straight from SUBMITTED can be reassigned', async () => {
    const id = await newComplaint({ stage: 'SUBMITTED' });
    await escalate(id);
    const res = await resolve('supervisor1', id, { action: 'reassign', staffId: await userIdOf('hvac1') });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'Imran Khan' }, supervisor: { name: 'Rajiv Malhotra' } });
  });
});

describe('extend the deadline', () => {
  test('keeps the assignee, sets dueAt to the new date, resets the level, notifies the assignee', async () => {
    const id = await newComplaint({ stage: 'IN_PROGRESS', category: 'Plumbing', staff: 'plumber1' });
    await escalate(id);
    const newDueAt = inHours(12);
    const res = await resolve('supervisor1', id, { action: 'extend', newDueAt, reason: 'Parts are on order' });
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'Suresh Patil' }, escalationLevel: 0 });
    // MySQL stores whole seconds (rounded), so allow one second of difference
    expect(Math.abs(new Date(res.body.complaint.dueAt).getTime() - new Date(newDueAt).getTime())).toBeLessThanOrEqual(1000);
    expect(res.body.complaint.statusHistory.at(-1).remarks).toBe('Deadline extended: Parts are on order');
    expect((await notificationsOf(id)).at(-1)).toMatchObject({ email: 'plumber1@nmims.edu' });
    // work restarts from ASSIGNED
    expect((await (await as('plumber1')).post(`/api/complaints/${id}/start`).send({})).status).toBe(200);
  });

  test.each([
    ['no reason', () => ({ newDueAt: inHours(5) })],
    ['blank reason', () => ({ newDueAt: inHours(5), reason: ' ' })],
    ['a date in the past', () => ({ newDueAt: inHours(-1), reason: 'x' })],
    ['now', () => ({ newDueAt: new Date().toISOString(), reason: 'x' })],
    ['not a date', () => ({ newDueAt: 'tomorrow-ish', reason: 'x' })],
    ['no date', () => ({ reason: 'x' })],
  ])('extend with %s: 400, still ESCALATED', async (_name, body) => {
    const id = await newComplaint({ stage: 'ASSIGNED', category: 'Plumbing', staff: 'plumber1' });
    await escalate(id);
    const res = await resolve('supervisor1', id, { action: 'extend', ...body() });
    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe('ESCALATED');
  });

  test('extend on an unassigned complaint is refused (409): it must be reassigned', async () => {
    const id = await newComplaint({ stage: 'SUBMITTED' });
    await escalate(id);
    const res = await resolve('supervisor1', id, { action: 'extend', newDueAt: inHours(5), reason: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/unassigned/);
    expect(await statusOf(id)).toBe('ESCALATED');
  });
});

describe('guards', () => {
  test('unknown or missing action: 400', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED', category: 'Plumbing', staff: 'plumber1' });
    await escalate(id);
    for (const body of [{}, { action: 'ignore' }, { action: 'REASSIGN', staffId: 1 }, { action: null }]) {
      expect([JSON.stringify(body), (await resolve('supervisor1', id, body)).status]).toEqual([JSON.stringify(body), 400]);
    }
  });

  test.each(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED'])('a %s complaint is not escalated: 409', async (stage) => {
    const id = await newComplaint({ stage });
    const res = await resolve('supervisor1', id, { action: 'reassign', staffId: await userIdOf('hvac2') });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Cannot resolveEscalation a complaint that is/);
    expect(await statusOf(id)).toBe(stage);
  });

  test('only the supervisor: students, staff and (for INFRASTRUCTURE) the administrator get 403', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED', category: 'Plumbing', staff: 'plumber1' });
    await escalate(id);
    const body = { action: 'extend', newDueAt: inHours(5), reason: 'x' };
    for (const user of ['student1', 'faculty1', 'plumber1', 'admin1']) {
      expect([user, (await resolve(user, id, body)).status]).toEqual([user, 403]);
    }
    expect((await anonymous.post(`/api/complaints/${id}/resolve-escalation`).send(body)).status).toBe(401);
    expect(await statusOf(id)).toBe('ESCALATED');
  });

  test('unknown complaint: 404', async () => {
    expect((await resolve('supervisor1', 99999, { action: 'extend', newDueAt: inHours(5), reason: 'x' })).status).toBe(404);
  });

  test('two supervisors resolving at the same time: one wins, one gets 409', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED', category: 'Plumbing', staff: 'plumber1' });
    await escalate(id);
    const sup = await as('supervisor1');
    const body = { action: 'extend', newDueAt: inHours(5), reason: 'x' };
    const [a, b] = await Promise.all([1, 2].map(() => sup.post(`/api/complaints/${id}/resolve-escalation`).send(body)));
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await historyOf(id)).filter((h) => h === 'ESCALATED>ASSIGNED')).toHaveLength(1);
  });
});

describe('SERVICE complaints: the Administrator resolves their escalations (no supervisor)', () => {
  test('admin1 extends; a supervisor gets 403', async () => {
    const id = await newComplaint({ category: 'Mess and Canteen', reporter: 'faculty1', stage: 'ASSIGNED' });
    await escalate(id);
    const body = { action: 'extend', newDueAt: inHours(10), reason: 'Vendor meeting on Monday' };
    expect((await resolve('supervisor1', id, body)).status).toBe(403);
    const res = await resolve('admin1', id, body);
    expect(res.status).toBe(200);
    expect(res.body.complaint).toMatchObject({ status: 'ASSIGNED', assignee: { name: 'Anita Deshmukh' }, supervisor: null });
  });

  test('reassign must go to an Administrator, never to staff; leaving staffId out means "me"', async () => {
    const id = await newComplaint({ category: 'Mess and Canteen', reporter: 'faculty1', stage: 'ASSIGNED' });
    await escalate(id);
    const toStaff = await resolve('admin1', id, { action: 'reassign', staffId: await userIdOf('housekeeper1') });
    expect(toStaff.status).toBe(409);
    expect(toStaff.body.error).toMatch(/only be assigned to an Administrator/);
    const admin2 = await addUser('admin3', 'ADMIN');
    const res = await resolve('admin1', id, { action: 'reassign', staffId: admin2 });
    expect(res.status).toBe(200);
    expect(res.body.complaint.assignee.name).toBe('admin3');
  });
});
