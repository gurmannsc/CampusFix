// Administrator management (docs/06 "CRUD /api/admin/..."): categories, locations, users, deadline rules.
import request from 'supertest';
import { app } from '../src/app.js';
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, anonymous, newComplaint, rows, userIdOf, categoryId, locationId, hoursBetween,
} from './helpers/api.js';
import { escalationScheduler } from '../src/scheduler/EscalationScheduler.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

let admin;
beforeAll(async () => { admin = await as('admin1'); });
const get = (url) => admin.get(`/api/admin/${url}`);
const post = (url, body) => admin.post(`/api/admin/${url}`).send(body);
const patch = (url, body) => admin.patch(`/api/admin/${url}`).send(body);
const del = (url) => request(app).delete(`/api/admin/${url}`).set('Authorization', `Bearer ${admin.token}`);
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

describe('access: administrators only', () => {
  const calls = [
    ['get', 'categories'], ['post', 'categories', { name: 'X', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' }], ['patch', 'categories/1', {}], ['delete', 'categories/1'],
    ['get', 'locations'], ['post', 'locations', {}], ['patch', 'locations/1', {}], ['delete', 'locations/1'],
    ['get', 'users'], ['post', 'users', {}], ['patch', 'users/1', {}], ['delete', 'users/1'],
    ['get', 'deadline-rules'], ['patch', 'deadline-rules/HIGH', { resolutionHours: 5 }],
  ];
  // every row gets a third element (null = no body); otherwise Jest passes its `done` callback in that place
  test.each(calls.map(([m, u, b = null]) => [m, u, b]))('%s /api/admin/%s', async (method, url, body) => {
    for (const user of ['student1', 'faculty1', 'electrician1', 'supervisor1']) {
      const a = await as(user);
      const res = await request(app)[method](`/api/admin/${url}`).set('Authorization', `Bearer ${a.token}`).send(body ?? undefined);
      expect([user, res.status]).toEqual([user, 403]);
    }
    const anon = await request(app)[method](`/api/admin/${url}`).send(body ?? undefined);
    expect(anon.status).toBe(401);
  });
});

describe('categories', () => {
  test('list: all 8 with how many complaints and staff use each', async () => {
    const res = await get('categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toHaveLength(8);
    expect(res.body.categories.find((c) => c.name === 'HVAC')).toMatchObject({ type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM', staffCount: 3 });
    expect(res.body.categories.find((c) => c.name === 'Mess and Canteen')).toMatchObject({ type: 'SERVICE', staffCount: 0 });
    const [{ n }] = await rows("SELECT COUNT(*) n FROM complaints c JOIN categories g USING (category_id) WHERE g.name = 'Civil'");
    expect(res.body.categories.find((c) => c.name === 'Civil').complaintCount).toBe(Number(n));
  });

  test('create: appears in the form list and works for new complaints with its default priority and deadline', async () => {
    const res = await post('categories', { name: 'Landscaping', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' });
    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({ name: 'Landscaping', type: 'INFRASTRUCTURE', defaultPriority: 'LOW', complaintCount: 0, staffCount: 0 });
    const form = await (await as('student1')).get('/api/categories');
    expect(form.body.categories.map((c) => c.name)).toContain('Landscaping');
    const raised = await (await as('student1')).post('/api/complaints').send({ categoryId: res.body.category.categoryId, locationId: await locationId('Library', 'Entrance Lobby'), description: 'Dead lawn' });
    expect(raised.status).toBe(201);
    expect(raised.body.complaint.priority).toBe('LOW');
    expect(hoursBetween(raised.body.complaint.createdAt, raised.body.complaint.dueAt)).toBe(120);
  });

  test('a new SERVICE category routes complaints to the Administrator', async () => {
    const res = await post('categories', { name: 'Laundry', type: 'SERVICE', defaultPriority: 'MEDIUM' });
    const raised = await (await as('faculty1')).post('/api/complaints').send({ categoryId: res.body.category.categoryId, locationId: await locationId('Hostel Mess', 'Dining Hall'), description: 'Lost clothes' });
    const who = await rows('SELECT u.role FROM notifications n JOIN users u USING (user_id) WHERE n.complaint_id = ?', [raised.body.complaintId]);
    expect(who.map((w) => w.role)).toEqual(['ADMIN']);
  });

  test.each([
    ['no name', { type: 'SERVICE', defaultPriority: 'LOW' }, 'name'],
    ['blank name', { name: '  ', type: 'SERVICE', defaultPriority: 'LOW' }, 'name'],
    ['name over 50 characters', { name: 'x'.repeat(51), type: 'SERVICE', defaultPriority: 'LOW' }, 'name'],
    ['name that is not text', { name: 5, type: 'SERVICE', defaultPriority: 'LOW' }, 'name'],
    ['no type', { name: 'Q', defaultPriority: 'LOW' }, 'type'],
    ['unknown type', { name: 'Q', type: 'OTHER', defaultPriority: 'LOW' }, 'type'],
    ['unknown priority', { name: 'Q', type: 'SERVICE', defaultPriority: 'URGENT' }, 'defaultPriority'],
    ['nothing at all', {}, 'name'],
  ])('create with %s: 400 naming the field', async (_n, body, field) => {
    const res = await post('categories', body);
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty(field);
  });

  test('a duplicate name is a 409, whatever the capitalisation', async () => {
    expect((await post('categories', { name: 'hvac', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' })).status).toBe(409);
    expect((await post('categories', { name: 'Landscaping', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' })).status).toBe(409);
  });

  test('update the default priority: new complaints use it', async () => {
    const id = await categoryId('Furniture');
    const res = await patch(`categories/${id}`, { defaultPriority: 'HIGH' });
    expect(res.status).toBe(200);
    expect(res.body.category.defaultPriority).toBe('HIGH');
    const raised = await (await as('student1')).post('/api/complaints').send({ categoryId: id, locationId: await locationId('Hostel Block A', '204'), description: 'Broken bed' });
    expect(raised.body.complaint.priority).toBe('HIGH');
    await patch(`categories/${id}`, { defaultPriority: 'MEDIUM' });
  });

  test('renaming a category keeps its staff matched: their trade is renamed with it', async () => {
    const id = await categoryId('HVAC');
    const complaint = await newComplaint({ stage: 'SUBMITTED', category: 'HVAC' });
    const res = await patch(`categories/${id}`, { name: 'Heating and Cooling' });
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ name: 'Heating and Cooling', staffCount: 3 });
    expect((await rows("SELECT DISTINCT trade FROM users WHERE email LIKE 'hvac%'")).map((r) => r.trade)).toEqual(['Heating and Cooling']);
    // the existing complaint still offers the same staff, and assignment still works
    const eligible = await (await as('supervisor1')).get(`/api/complaints/${complaint}/eligible-staff`);
    expect(eligible.body.staff.map((s) => s.name).sort()).toEqual(['Deepak Chouhan', 'Imran Khan']);
    expect((await (await as('supervisor1')).post(`/api/complaints/${complaint}/assign`).send({ staffId: await userIdOf('hvac1') })).status).toBe(200);
    await patch(`categories/${id}`, { name: 'HVAC' });
    expect((await rows("SELECT DISTINCT trade FROM users WHERE email LIKE 'hvac%'")).map((r) => r.trade)).toEqual(['HVAC']);
  });

  test('renaming to a name that exists is a 409 and changes nothing (no half-renamed staff)', async () => {
    const res = await patch(`categories/${await categoryId('HVAC')}`, { name: 'Plumbing' });
    expect(res.status).toBe(409);
    expect((await rows("SELECT DISTINCT trade FROM users WHERE email LIKE 'hvac%'")).map((r) => r.trade)).toEqual(['HVAC']);
    expect((await get('categories')).body.categories.map((c) => c.name)).toContain('HVAC');
  });

  test('the type cannot change while complaints or staff use the category (409); an unused one can change', async () => {
    expect((await patch(`categories/${await categoryId('HVAC')}`, { type: 'SERVICE' })).status).toBe(409); // staff and complaints
    expect((await patch(`categories/${await categoryId('Mess and Canteen')}`, { type: 'INFRASTRUCTURE' })).status).toBe(409); // complaints
    const fresh = await post('categories', { name: 'Gardening', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' });
    const changed = await patch(`categories/${fresh.body.category.categoryId}`, { type: 'SERVICE' });
    expect(changed.status).toBe(200);
    expect(changed.body.category.type).toBe('SERVICE');
  });

  test('invalid updates: 400; unknown id: 404; bad id: 400; an empty update changes nothing', async () => {
    const id = await categoryId('Civil');
    expect((await patch(`categories/${id}`, { defaultPriority: 'NOPE' })).status).toBe(400);
    expect((await patch(`categories/${id}`, { name: '' })).status).toBe(200); // empty text is "not given"
    expect((await patch('categories/99999', { name: 'Z' })).status).toBe(404);
    expect((await patch('categories/abc', { name: 'Z' })).status).toBe(400);
    expect((await patch(`categories/${id}`, {})).body.category.name).toBe('Civil');
  });

  test('delete: only when no complaint and no staff use it', async () => {
    const unused = await post('categories', { name: 'Temporary', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' });
    expect((await del(`categories/${unused.body.category.categoryId}`)).status).toBe(204);
    expect((await get('categories')).body.categories.map((c) => c.name)).not.toContain('Temporary');
    const used = await del(`categories/${await categoryId('Civil')}`);
    expect(used.status).toBe(409);
    expect(used.body.error).toMatch(/complaint\(s\) use this category/);
    const withStaff = await post('categories', { name: 'Welding', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' });
    await post('users', { role: 'STAFF', name: 'Welder', email: 'welder@nmims.edu', password: 'welder-pass', trade: 'Welding' });
    expect((await del(`categories/${withStaff.body.category.categoryId}`)).body.error).toMatch(/staff member\(s\) have this trade/);
    expect((await del('categories/99999')).status).toBe(404);
    expect((await del('categories/abc')).status).toBe(400);
  });

  test('Administrator.manageCategory from the class diagram is what the endpoints use (create without id, update with id)', async () => {
    const created = await post('categories', { name: 'Signage', type: 'INFRASTRUCTURE', defaultPriority: 'LOW' });
    expect((await patch(`categories/${created.body.category.categoryId}`, { name: 'Signs' })).body.category.name).toBe('Signs');
  });
});

describe('locations', () => {
  test('list: all 13 with their complaint counts', async () => {
    const res = await get('locations');
    expect(res.body.locations).toHaveLength(13);
    expect(res.body.locations.find((l) => l.room === '204' && l.block === 'Hostel Block A')).toMatchObject({ floor: 2, areaType: 'HOSTEL' });
  });

  test('create: appears in the form list and can be used for a complaint', async () => {
    const res = await post('locations', { block: 'Sports Complex', floor: 0, room: 'Gym', areaType: 'COMMON_AREA' });
    expect(res.status).toBe(201);
    expect(res.body.location).toMatchObject({ block: 'Sports Complex', floor: 0, room: 'Gym', areaType: 'COMMON_AREA', complaintCount: 0 });
    expect((await (await as('student1')).get('/api/locations')).body.locations.map((l) => l.room)).toContain('Gym');
    const raised = await (await as('student1')).post('/api/complaints').send({ categoryId: await categoryId('Electrical'), locationId: res.body.location.locationId, description: 'No lights in the gym' });
    expect(raised.body.complaint.location).toMatchObject({ block: 'Sports Complex', room: 'Gym' });
  });

  test.each([
    ['no block', { floor: 1, room: 'R', areaType: 'LAB' }, 'block'],
    ['no room', { block: 'B', floor: 1, areaType: 'LAB' }, 'room'],
    ['floor that is not a whole number', { block: 'B', floor: 1.5, room: 'R', areaType: 'LAB' }, 'floor'],
    ['floor as text', { block: 'B', floor: '2', room: 'R', areaType: 'LAB' }, 'floor'],
    ['floor 101', { block: 'B', floor: 101, room: 'R', areaType: 'LAB' }, 'floor'],
    ['unknown area type', { block: 'B', floor: 1, room: 'R', areaType: 'GARDEN' }, 'areaType'],
    ['block over 50 characters', { block: 'B'.repeat(51), floor: 1, room: 'R', areaType: 'LAB' }, 'block'],
  ])('create with %s: 400 naming the field', async (_n, body, field) => {
    const res = await post('locations', body);
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty(field);
  });

  test('the same block, floor and room twice is a 409 (on create and on update)', async () => {
    expect((await post('locations', { block: 'Sports Complex', floor: 0, room: 'Gym', areaType: 'COMMON_AREA' })).status).toBe(409);
    const other = await post('locations', { block: 'Sports Complex', floor: 0, room: 'Pool', areaType: 'COMMON_AREA' });
    expect((await patch(`locations/${other.body.location.locationId}`, { room: 'Gym' })).status).toBe(409);
    expect((await patch(`locations/${other.body.location.locationId}`, { room: 'Pool' })).status).toBe(200); // itself is not a duplicate
  });

  test('update: change room and area type; unknown id 404; invalid value 400', async () => {
    const created = await post('locations', { block: 'Annexe', floor: 1, room: 'A1', areaType: 'LAB' });
    const id = created.body.location.locationId;
    const res = await patch(`locations/${id}`, { room: 'A2', areaType: 'CLASSROOM' });
    expect(res.body.location).toMatchObject({ room: 'A2', areaType: 'CLASSROOM', block: 'Annexe' });
    expect((await patch(`locations/${id}`, { areaType: 'NOPE' })).status).toBe(400);
    expect((await patch('locations/99999', { room: 'x' })).status).toBe(404);
  });

  test('delete: only when no complaint was reported there', async () => {
    const created = await post('locations', { block: 'Annexe', floor: 2, room: 'Temp', areaType: 'LAB' });
    expect((await del(`locations/${created.body.location.locationId}`)).status).toBe(204);
    const used = await del(`locations/${await locationId('Hostel Block A', '204')}`);
    expect(used.status).toBe(409);
    expect(used.body.error).toMatch(/complaint\(s\) were reported at this location/);
    expect((await del('locations/99999')).status).toBe(404);
  });
});

describe('users', () => {
  test('list: every account, never a password or hash; filter by role', async () => {
    const res = await get('users');
    expect(res.body.users).toHaveLength(Number((await rows('SELECT COUNT(*) n FROM users'))[0].n)); // the 16 demo accounts plus any created above
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|\$2[aby]\$/i);
    expect(res.body.users[0].role).toBe('ADMIN'); // admins first
    expect(res.body.users.find((u) => u.email === 'hvac1@nmims.edu')).toMatchObject({ role: 'STAFF', trade: 'HVAC', isAvailable: true });
    expect(res.body.users.find((u) => u.email === 'student1@nmims.edu')).toMatchObject({ sapId: '70012300101', hostelRoom: 'A-204', trade: null, isAvailable: null });
    expect((await get('users?role=STAFF')).body.users).toHaveLength(Number((await rows("SELECT COUNT(*) n FROM users WHERE role = 'STAFF'"))[0].n));
    expect((await get('users?role=JANITOR')).status).toBe(400);
  });

  test('create a student: they can log in with the password just set', async () => {
    const res = await post('users', { role: 'STUDENT', name: 'New Student', email: 'New.Student@NMIMS.edu', password: 'secret-pass-1', phone: '9000000000', sapId: '70099', program: 'MBA Tech CE', hostelRoom: 'C-12' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'STUDENT', name: 'New Student', email: 'new.student@nmims.edu', sapId: '70099', hostelRoom: 'C-12', complaintCount: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    const logged = await login('new.student@nmims.edu', 'secret-pass-1');
    expect(logged.status).toBe(200);
    expect(logged.body.user.role).toBe('STUDENT');
    expect((await login('new.student@nmims.edu', 'demo123')).status).toBe(401);
    // and can use the system as a campus user
    const raised = await request(app).post('/api/complaints').set('Authorization', `Bearer ${logged.body.token}`)
      .send({ categoryId: await categoryId('Electrical'), locationId: await locationId('Hostel Block A', '204'), description: 'x' });
    expect(raised.status).toBe(201);
  });

  test('the password is stored hashed (bcrypt), never as typed', async () => {
    await post('users', { role: 'FACULTY', name: 'Prof Hash', email: 'hash@nmims.edu', password: 'plain-text-pw', employeeId: 'E9', department: 'Law' });
    const [row] = await rows("SELECT password_hash FROM users WHERE email = 'hash@nmims.edu'");
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row.password_hash).not.toContain('plain-text-pw');
  });

  test('create staff: the trade must be an infrastructure category; they are offered for matching complaints, available by default', async () => {
    const res = await post('users', { role: 'STAFF', name: 'Kiran Rao', email: 'kiran@nmims.edu', password: 'kiran-pass-1', trade: 'Plumbing' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'STAFF', trade: 'Plumbing', isAvailable: true });
    const complaint = await newComplaint({ category: 'Plumbing', stage: 'SUBMITTED' });
    const eligible = await (await as('supervisor1')).get(`/api/complaints/${complaint}/eligible-staff`);
    expect(eligible.body.staff.map((s) => s.name)).toContain('Kiran Rao');
  });

  test.each([
    ['no trade', { role: 'STAFF', name: 'S', email: 's1@x.com', password: 'longenough' }, 'trade'],
    ['an unknown trade', { role: 'STAFF', name: 'S', email: 's2@x.com', password: 'longenough', trade: 'Magic' }, 'trade'],
    ['a SERVICE category as trade (staff never get service complaints)', { role: 'STAFF', name: 'S', email: 's3@x.com', password: 'longenough', trade: 'Mess and Canteen' }, 'trade'],
    ['isAvailable as text', { role: 'STAFF', name: 'S', email: 's4@x.com', password: 'longenough', trade: 'HVAC', isAvailable: 'yes' }, 'isAvailable'],
    ['no name', { role: 'STUDENT', email: 'n@x.com', password: 'longenough' }, 'name'],
    ['no email', { role: 'STUDENT', name: 'N', password: 'longenough' }, 'email'],
    ['an invalid email', { role: 'STUDENT', name: 'N', email: 'not-an-email', password: 'longenough' }, 'email'],
    ['a password under 8 characters', { role: 'STUDENT', name: 'N', email: 'n2@x.com', password: 'short' }, 'password'],
    ['a password over 72 characters', { role: 'STUDENT', name: 'N', email: 'n3@x.com', password: 'p'.repeat(73) }, 'password'],
    ['no password', { role: 'STUDENT', name: 'N', email: 'n4@x.com' }, 'password'],
    ['no role', { name: 'N', email: 'n5@x.com', password: 'longenough' }, 'role'],
    ['an unknown role', { role: 'JANITOR', name: 'N', email: 'n6@x.com', password: 'longenough' }, 'role'],
    ['a sapId over 20 characters', { role: 'STUDENT', name: 'N', email: 'n7@x.com', password: 'longenough', sapId: '1'.repeat(21) }, 'sapId'],
  ])('create with %s: 400 naming the field, nothing created', async (_n, body, field) => {
    const before = (await rows('SELECT COUNT(*) n FROM users'))[0].n;
    const res = await post('users', body);
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty(field);
    expect((await rows('SELECT COUNT(*) n FROM users'))[0].n).toBe(before);
  });

  test('fields that do not belong to the role are ignored (a student with a trade stays a student)', async () => {
    const res = await post('users', { role: 'STUDENT', name: 'Ignored', email: 'ignored@nmims.edu', password: 'longenough', trade: 'HVAC', isAvailable: true, employeeId: 'E1' });
    expect(res.body.user).toMatchObject({ trade: null, isAvailable: null, employeeId: null });
  });

  test('a duplicate email is a 409 (case-insensitive)', async () => {
    expect((await post('users', { role: 'STUDENT', name: 'D', email: 'STUDENT1@nmims.edu', password: 'longenough' })).status).toBe(409);
  });

  test('a new supervisor is told about new complaints, and a new administrator can open the dashboard', async () => {
    await post('users', { role: 'SUPERVISOR', name: 'Second Supervisor', email: 'sup2@nmims.edu', password: 'sup2-password' });
    await post('users', { role: 'ADMIN', name: 'Second Admin', email: 'adm2@nmims.edu', password: 'adm2-password' });
    const id = await newComplaint({ stage: 'SUBMITTED' });
    const told = await rows('SELECT u.email FROM notifications n JOIN users u USING (user_id) WHERE n.complaint_id = ? ORDER BY u.email', [id]);
    expect(told.map((t) => t.email)).toEqual(['sup2@nmims.edu', 'supervisor1@nmims.edu']);
    const token = (await login('adm2@nmims.edu', 'adm2-password')).body.token;
    expect((await request(app).get('/api/dashboard').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  test('update: name, phone (null clears it), email; the new email logs in', async () => {
    const created = await post('users', { role: 'STUDENT', name: 'Old Name', email: 'old@nmims.edu', password: 'old-password', phone: '111' });
    const id = created.body.user.userId;
    const res = await patch(`users/${id}`, { name: 'New Name', phone: null, email: 'renamed@nmims.edu', hostelRoom: 'D-4' });
    expect(res.body.user).toMatchObject({ name: 'New Name', phone: null, email: 'renamed@nmims.edu', hostelRoom: 'D-4' });
    expect((await login('renamed@nmims.edu', 'old-password')).status).toBe(200);
    expect((await login('old@nmims.edu', 'old-password')).status).toBe(401);
  });

  test('reset a password: the old one stops working, the new one works', async () => {
    const created = await post('users', { role: 'FACULTY', name: 'Reset Me', email: 'reset@nmims.edu', password: 'first-password' });
    expect((await patch(`users/${created.body.user.userId}`, { password: 'second-password' })).status).toBe(200);
    expect((await login('reset@nmims.edu', 'first-password')).status).toBe(401);
    expect((await login('reset@nmims.edu', 'second-password')).status).toBe(200);
    expect((await patch(`users/${created.body.user.userId}`, { password: 'short' })).status).toBe(400);
  });

  test('marking staff unavailable removes them from the offered list; available again brings them back', async () => {
    const complaint = await newComplaint({ category: 'Electrical', stage: 'SUBMITTED' });
    const supervisor = await as('supervisor1');
    const offered = async () => (await supervisor.get(`/api/complaints/${complaint}/eligible-staff`)).body.staff.map((s) => s.name);
    expect(await offered()).toContain('Ramesh Yadav');
    const id = await userIdOf('electrician1');
    expect((await patch(`users/${id}`, { isAvailable: false })).body.user.isAvailable).toBe(false);
    expect(await offered()).not.toContain('Ramesh Yadav');
    expect((await supervisor.post(`/api/complaints/${complaint}/assign`).send({ staffId: id })).status).toBe(409);
    await patch(`users/${id}`, { isAvailable: true });
    expect(await offered()).toContain('Ramesh Yadav');
  });

  test('a staff member\'s trade can change, but only to an infrastructure category', async () => {
    const id = await userIdOf('carpenter1');
    expect((await patch(`users/${id}`, { trade: 'Civil' })).body.user.trade).toBe('Civil');
    expect((await patch(`users/${id}`, { trade: 'Mess and Canteen' })).status).toBe(400);
    await patch(`users/${id}`, { trade: 'Furniture' });
  });

  test('the role cannot be changed (400); repeating the same role is fine', async () => {
    const id = await userIdOf('student1');
    const res = await patch(`users/${id}`, { role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.details.role).toMatch(/cannot be changed/);
    expect((await patch(`users/${id}`, { role: 'STUDENT', name: 'Aarav Mehta' })).status).toBe(200);
    expect((await rows('SELECT role FROM users WHERE user_id = ?', [id]))[0].role).toBe('STUDENT');
  });

  test('update errors: duplicate email 409, bad email 400, unknown id 404, bad id 400', async () => {
    const id = await userIdOf('student2');
    expect((await patch(`users/${id}`, { email: 'student1@nmims.edu' })).status).toBe(409);
    expect((await patch(`users/${id}`, { email: 'nope' })).status).toBe(400);
    expect((await patch('users/99999', { name: 'x' })).status).toBe(404);
    expect((await patch('users/abc', { name: 'x' })).status).toBe(400);
  });

  test('delete: a new account with no history goes, together with its notifications; its old token stops working', async () => {
    const created = await post('users', { role: 'SUPERVISOR', name: 'Temp Sup', email: 'tempsup@nmims.edu', password: 'temp-password' });
    const id = created.body.user.userId;
    const token = (await login('tempsup@nmims.edu', 'temp-password')).body.token;
    await newComplaint({ stage: 'SUBMITTED' }); // Temp Sup is told about it
    expect((await rows('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', [id]))[0].n).toBeGreaterThan(0);
    expect((await del(`users/${id}`)).status).toBe(204);
    expect((await rows('SELECT COUNT(*) n FROM users WHERE user_id = ?', [id]))[0].n).toBe(0);
    expect((await rows('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', [id]))[0].n).toBe(0);
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await login('tempsup@nmims.edu', 'temp-password')).status).toBe(401);
  });

  test('delete is refused (409) for anyone who appears in complaints or their history', async () => {
    for (const who of ['student1', 'hvac1', 'supervisor1']) {
      const res = await del(`users/${await userIdOf(who)}`);
      expect([who, res.status]).toEqual([who, 409]);
      expect(res.body.error).toMatch(/appears in complaints/);
    }
  });

  test('you cannot delete yourself; unknown id 404; bad id 400', async () => {
    const res = await del(`users/${admin.userId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/your own account/);
    expect((await del('users/99999')).status).toBe(404);
    expect((await del('users/abc')).status).toBe(400);
  });
});

describe('deadline rules', () => {
  afterEach(async () => {
    await rows("UPDATE deadline_rules SET resolution_hours = 4, escalation_interval_hours = 24 WHERE priority = 'CRITICAL'");
    await rows("UPDATE deadline_rules SET resolution_hours = 24, escalation_interval_hours = 24 WHERE priority = 'HIGH'");
    await rows("UPDATE deadline_rules SET resolution_hours = 48, escalation_interval_hours = 24 WHERE priority = 'MEDIUM'");
  });

  test('list: the four rules in priority order with the seed values', async () => {
    const res = await get('deadline-rules');
    expect(res.body.rules).toEqual([
      { priority: 'CRITICAL', resolutionHours: 4, escalationIntervalHours: 24 },
      { priority: 'HIGH', resolutionHours: 24, escalationIntervalHours: 24 },
      { priority: 'MEDIUM', resolutionHours: 48, escalationIntervalHours: 24 },
      { priority: 'LOW', resolutionHours: 120, escalationIntervalHours: 24 },
    ]);
  });

  test('a new resolutionHours applies to new complaints and to priority changes, not to existing ones', async () => {
    const existing = await newComplaint({ category: 'Electrical', stage: 'SUBMITTED' }); // HIGH, due in 24 h
    const dueBefore = (await rows('SELECT due_at FROM complaints WHERE complaint_id = ?', [existing]))[0].due_at;
    const res = await patch('deadline-rules/HIGH', { resolutionHours: 10 });
    expect(res.status).toBe(200);
    expect(res.body.rule).toEqual({ priority: 'HIGH', resolutionHours: 10, escalationIntervalHours: 24 });
    // existing complaint untouched
    expect((await rows('SELECT due_at FROM complaints WHERE complaint_id = ?', [existing]))[0].due_at).toEqual(dueBefore);
    // a new complaint uses it
    const raised = await (await as('student1')).post('/api/complaints').send({ categoryId: await categoryId('Electrical'), locationId: await locationId('Hostel Block A', '204'), description: 'x' });
    expect(hoursBetween(raised.body.complaint.createdAt, raised.body.complaint.dueAt)).toBe(10);
    // and so does a priority change by the supervisor (MEDIUM complaint -> HIGH)
    const hvac = await newComplaint({ category: 'HVAC', stage: 'SUBMITTED' });
    const changed = await (await as('supervisor1')).patch(`/api/complaints/${hvac}/priority`).send({ priority: 'HIGH' });
    expect(hoursBetween(changed.body.complaint.createdAt, changed.body.complaint.dueAt)).toBe(10);
  });

  test('the escalation interval is read live by the timer', async () => {
    const id = await newComplaint({ stage: 'ASSIGNED' }); // MEDIUM
    const now = new Date(Math.ceil(Date.now() / 1000) * 1000);
    await rows('UPDATE complaints SET due_at = ? WHERE complaint_id = ?', [new Date(now - 3600000), id]);
    await escalationScheduler.checkDeadlines(now); // level 1
    const later = new Date(now.getTime() + 7 * 3600000);
    expect((await escalationScheduler.checkDeadlines(later)).reescalated.map((c) => c.complaintId)).not.toContain(id); // 24 h interval
    await patch('deadline-rules/MEDIUM', { escalationIntervalHours: 6 });
    expect((await escalationScheduler.checkDeadlines(later)).reescalated.map((c) => c.complaintId)).toContain(id); // 6 h interval
  });

  test('both fields can be changed in one call; one field leaves the other alone', async () => {
    expect((await patch('deadline-rules/CRITICAL', { resolutionHours: 2, escalationIntervalHours: 12 })).body.rule).toEqual({ priority: 'CRITICAL', resolutionHours: 2, escalationIntervalHours: 12 });
    expect((await patch('deadline-rules/CRITICAL', { escalationIntervalHours: 8 })).body.rule).toEqual({ priority: 'CRITICAL', resolutionHours: 2, escalationIntervalHours: 8 });
  });

  test.each([
    [{ resolutionHours: 0 }], [{ resolutionHours: -4 }], [{ resolutionHours: 1.5 }], [{ resolutionHours: '48' }], [{ resolutionHours: null }],
    [{ resolutionHours: 8761 }], [{ escalationIntervalHours: 0 }], [{ escalationIntervalHours: 'x' }], [{}],
  ])('%j is a 400 and changes nothing', async (body) => {
    const before = (await get('deadline-rules')).body.rules;
    expect((await patch('deadline-rules/MEDIUM', body)).status).toBe(400);
    expect((await get('deadline-rules')).body.rules).toEqual(before);
  });

  test('an unknown priority is a 404', async () => {
    expect((await patch('deadline-rules/URGENT', { resolutionHours: 5 })).status).toBe(404);
    expect((await patch('deadline-rules/high', { resolutionHours: 5 })).status).toBe(404);
  });
});

describe('anonymous access is refused everywhere', () => {
  test('no token: 401', async () => {
    expect((await anonymous.get('/api/admin/users')).status).toBe(401);
  });
});
