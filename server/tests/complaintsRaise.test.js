// M4 part 1: raising complaints. US-01 (category + exact location), US-02 (photo), US-11 (SERVICE routing).
import fs from 'node:fs';
import path from 'node:path';
import { resetTestDatabase, closeDb } from './helpers/db.js';
import { notificationService } from '../src/services/NotificationService.js';
import {
  as, anonymous, raiseMultipart, PNG, JPEG, categoryId, locationId, rows, hoursBetween, useTempUploads,
} from './helpers/api.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);
const uploads = useTempUploads();

const countComplaints = async () => (await rows('SELECT COUNT(*) n FROM complaints'))[0].n;
let hvac;
let a204;

beforeAll(async () => {
  hvac = await categoryId('HVAC');
  a204 = await locationId('Hostel Block A', '204');
});

describe('US-01: report a fault with category and exact location', () => {
  test('student1 raises "Ceiling fan not working" (the demo step 1): id returned, SUBMITTED, MEDIUM, due in 48 h', async () => {
    const student = await as('student1');
    const res = await raiseMultipart(student, {
      categoryId: hvac, locationId: a204, title: 'Ceiling fan not working', description: 'Fan does not start at any speed',
    });
    expect(res.status).toBe(201);
    const { complaintId, complaint } = res.body;
    expect(Number.isInteger(complaintId)).toBe(true);
    expect(complaint).toMatchObject({
      complaintId, title: 'Ceiling fan not working', status: 'SUBMITTED', priority: 'MEDIUM',
      escalationLevel: 0, reopenCount: 0, assignee: null, photoUrl: null,
      category: { name: 'HVAC', type: 'INFRASTRUCTURE' },
      location: { block: 'Hostel Block A', floor: 2, room: '204', areaType: 'HOSTEL' },
      reporter: { userId: student.userId, name: 'Aarav Mehta' },
    });
    expect(hoursBetween(complaint.createdAt, complaint.dueAt)).toBe(48);
  });

  test('the first StatusUpdate (nothing -> SUBMITTED) is written and visible in the history', async () => {
    const student = await as('student1');
    const { body } = await raiseMultipart(student, { categoryId: hvac, locationId: a204, description: 'Fan makes a loud noise' });
    const [su] = await rows('SELECT from_status, to_status, updated_by FROM status_updates WHERE complaint_id = ?', [body.complaintId]);
    expect(su).toEqual({ from_status: null, to_status: 'SUBMITTED', updated_by: student.userId });
    expect(body.complaint.statusHistory).toHaveLength(1);
    expect(body.complaint.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: 'SUBMITTED' });
  });

  test('JSON bodies work as well as multipart; the title defaults to the start of the description', async () => {
    const faculty = await as('faculty1');
    const res = await faculty.post('/api/complaints').send({ categoryId: hvac, locationId: a204, description: 'AC is not cooling the room' });
    expect(res.status).toBe(201);
    expect(res.body.complaint.title).toBe('AC is not cooling the room');
    expect(res.body.complaint.reporter.userId).toBe(faculty.userId);
  });

  test('priority and due date follow the category default and the DeadlineRule (Electrical = HIGH = 24 h)', async () => {
    const student = await as('student2');
    const res = await student.post('/api/complaints').send({
      categoryId: await categoryId('Electrical'), locationId: a204, description: 'Socket is dead',
    });
    expect(res.body.complaint.priority).toBe('HIGH');
    expect(hoursBetween(res.body.complaint.createdAt, res.body.complaint.dueAt)).toBe(24);
  });

  test.each([
    ['no category', (f) => { delete f.categoryId; }, ['categoryId']],
    ['no location', (f) => { delete f.locationId; }, ['locationId']],
    ['neither category nor location', (f) => { delete f.categoryId; delete f.locationId; }, ['categoryId', 'locationId']],
    ['blank description', (f) => { f.description = '   '; }, ['description']],
    ['description over 2000 characters', (f) => { f.description = 'x'.repeat(2001); }, ['description']],
    ['title over 150 characters', (f) => { f.title = 'x'.repeat(151); }, ['title']],
    ['unknown category', (f) => { f.categoryId = 9999; }, ['categoryId']],
    ['unknown location', (f) => { f.locationId = 9999; }, ['locationId']],
    ['text instead of an id', (f) => { f.categoryId = 'HVAC'; }, ['categoryId']],
  ])('fails with %s (400, a message per field, nothing saved)', async (_name, break_, fields) => {
    const before = await countComplaints();
    const body = { categoryId: hvac, locationId: a204, description: 'Fan broken' };
    break_(body);
    const res = await (await as('student1')).post('/api/complaints').send(body);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details).sort()).toEqual(fields.sort());
    expect(await countComplaints()).toBe(before);
  });

  test('"New complaint" goes to the supervisor, not to the administrator (INFRASTRUCTURE)', async () => {
    const student = await as('student1');
    const { body } = await student.post('/api/complaints').send({ categoryId: hvac, locationId: a204, description: 'Fan broken' });
    const notes = await rows(
      'SELECT u.email, n.message, n.is_read FROM notifications n JOIN users u ON u.user_id = n.user_id WHERE n.complaint_id = ?', [body.complaintId]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ email: 'supervisor1@nmims.edu', is_read: 0 });
    expect(notes[0].message).toMatch(/New complaint/);
  });

  test('only students and faculty may raise complaints', async () => {
    const body = { categoryId: hvac, locationId: a204, description: 'Fan broken' };
    for (const user of ['electrician1', 'supervisor1', 'admin1']) {
      expect([user, (await (await as(user)).post('/api/complaints').send(body)).status]).toEqual([user, 403]);
    }
    expect((await anonymous.post('/api/complaints').send(body)).status).toBe(401);
  });

  test('a rejected request creates no complaint, no StatusUpdate and no notification', async () => {
    const [before] = await rows('SELECT (SELECT COUNT(*) FROM complaints) c, (SELECT COUNT(*) FROM notifications) n, (SELECT COUNT(*) FROM status_updates) s');
    const res = await (await as('student1')).post('/api/complaints').send({ categoryId: hvac, locationId: 9999, description: 'x' });
    expect(res.status).toBe(400);
    const [after] = await rows('SELECT (SELECT COUNT(*) FROM complaints) c, (SELECT COUNT(*) FROM notifications) n, (SELECT COUNT(*) FROM status_updates) s');
    expect(after).toEqual(before);
  });
});

describe('US-02: attach a photo (JPG or PNG up to 5 MB)', () => {
  const base = () => ({ categoryId: hvac, locationId: a204, title: 'Fan with photo', description: 'See the photo' });

  test('a PNG is accepted, stored under a random name, and linked to the complaint', async () => {
    const student = await as('student1');
    const res = await raiseMultipart(student, base(), PNG);
    expect(res.status).toBe(201);
    expect(res.body.complaint.photoUrl).toBe(`/api/complaints/${res.body.complaintId}/photo`);
    const [{ photo_path }] = await rows('SELECT photo_path FROM complaints WHERE complaint_id = ?', [res.body.complaintId]);
    expect(photo_path).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(photo_path).not.toContain('fan'); // the client's file name is never used
    expect(fs.readFileSync(path.join(uploads.dir(), photo_path)).equals(PNG.buffer)).toBe(true);
  });

  test('a JPEG is accepted', async () => {
    const res = await raiseMultipart(await as('student1'), base(), JPEG);
    expect(res.status).toBe(201);
    const [{ photo_path }] = await rows('SELECT photo_path FROM complaints WHERE complaint_id = ?', [res.body.complaintId]);
    expect(photo_path).toMatch(/\.jpg$/);
  });

  test('exactly 5 MB is accepted; one byte more is rejected', async () => {
    const png = (size) => ({ ...PNG, buffer: Buffer.concat([PNG.buffer, Buffer.alloc(size - PNG.buffer.length)]) });
    const student = await as('student1');
    expect((await raiseMultipart(student, base(), png(5 * 1024 * 1024))).status).toBe(201);
    const files = uploads.files().length;
    const before = await countComplaints();
    const res = await raiseMultipart(student, base(), png(5 * 1024 * 1024 + 1));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5 MB/);
    expect(await countComplaints()).toBe(before);
    expect(uploads.files().length).toBe(files);
  });

  test.each([
    ['a GIF', { name: 'a.gif', type: 'image/gif', buffer: Buffer.from('GIF89a......') }],
    ['an SVG', { name: 'a.svg', type: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }],
    ['a PDF', { name: 'a.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ...') }],
    ['a text file', { name: 'a.txt', type: 'text/plain', buffer: Buffer.from('hello') }],
    ['a script pretending to be a PNG (right type, wrong content)', { name: 'evil.png', type: 'image/png', buffer: Buffer.from('<script>alert(1)</script>') }],
    ['an empty file called .png', { name: 'empty.png', type: 'image/png', buffer: Buffer.alloc(0) }],
  ])('%s is rejected (400) and nothing is saved', async (_name, file) => {
    const before = await countComplaints();
    const files = uploads.files().length;
    const res = await raiseMultipart(await as('student1'), base(), file);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JPG or PNG/);
    expect(await countComplaints()).toBe(before);
    expect(uploads.files().length).toBe(files);
  });

  test('invalid details plus a good photo: 400 and the photo is not kept', async () => {
    const files = uploads.files().length;
    const res = await raiseMultipart(await as('student1'), { description: 'no category or location' }, PNG);
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty('categoryId');
    expect(uploads.files().length).toBe(files);
  });

  test('only one file, in the field "photo"', async () => {
    const student = await as('student1');
    const wrongField = await student.post('/api/complaints').field('categoryId', hvac).field('locationId', a204).field('description', 'x')
      .attach('picture', PNG.buffer, { filename: 'a.png', contentType: 'image/png' });
    expect(wrongField.status).toBe(400);
    const two = await student.post('/api/complaints').field('categoryId', hvac).field('locationId', a204).field('description', 'x')
      .attach('photo', PNG.buffer, { filename: 'a.png', contentType: 'image/png' })
      .attach('photo', PNG.buffer, { filename: 'b.png', contentType: 'image/png' });
    expect(two.status).toBe(400);
  });

  test('if saving the complaint fails after the photo was written, the photo file is deleted and nothing is saved', async () => {
    const before = await countComplaints();
    const files = uploads.files().length;
    const original = notificationService.dispatch;
    notificationService.dispatch = async () => { throw new Error('notification store is down'); }; // last step of the transaction
    let res;
    try { res = await raiseMultipart(await as('student1'), base(), PNG); } finally { notificationService.dispatch = original; }
    expect(res.status).toBe(500);
    expect(await countComplaints()).toBe(before);
    expect(uploads.files().length).toBe(files);
  });

  test('anonymous uploads are refused before the file is read', async () => {
    const res = await raiseMultipart(anonymous, base(), PNG);
    expect(res.status).toBe(401);
  });

  describe('who can see the photo (supervisor, assignee, reporter; nobody else)', () => {
    let id;
    beforeAll(async () => {
      const res = await raiseMultipart(await as('student1'), base(), PNG);
      id = res.body.complaintId;
      const supervisor = await as('supervisor1');
      const hvac1 = (await rows("SELECT user_id FROM users WHERE email = 'hvac1@nmims.edu'"))[0].user_id;
      expect((await supervisor.post(`/api/complaints/${id}/assign`).send({ staffId: hvac1 })).status).toBe(200);
    });

    test.each(['student1', 'supervisor1', 'admin1', 'hvac1'])('%s can see it', async (user) => {
      const res = await (await as(user)).get(`/api/complaints/${id}/photo`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(res.body, PNG.buffer)).toBe(0);
    });

    test.each(['student2', 'faculty1', 'hvac2', 'electrician1'])('%s cannot (403)', async (user) => {
      expect((await (await as(user)).get(`/api/complaints/${id}/photo`)).status).toBe(403);
    });

    test('anonymous: 401; complaint without a photo: 404; unknown complaint: 404', async () => {
      expect((await anonymous.get(`/api/complaints/${id}/photo`)).status).toBe(401);
      const noPhoto = await (await as('student1')).post('/api/complaints').send({ categoryId: hvac, locationId: a204, description: 'x' });
      expect((await (await as('student1')).get(`/api/complaints/${noPhoto.body.complaintId}/photo`)).status).toBe(404);
      expect((await (await as('supervisor1')).get('/api/complaints/99999/photo')).status).toBe(404);
    });

    test('a missing file on disk is a 404, not a crash', async () => {
      const [{ photo_path }] = await rows('SELECT photo_path FROM complaints WHERE complaint_id = ?', [id]);
      fs.rmSync(path.join(uploads.dir(), photo_path));
      expect((await (await as('supervisor1')).get(`/api/complaints/${id}/photo`)).status).toBe(404);
    });
  });
});

describe('US-11: SERVICE complaints (Mess and Canteen) are routed to the Administrator', () => {
  let mess;
  let hall;
  beforeAll(async () => {
    mess = await categoryId('Mess and Canteen');
    hall = await locationId('Hostel Mess', 'Dining Hall');
  });

  test('raising one notifies the administrators and NOT the supervisors (demo step 6)', async () => {
    const faculty = await as('faculty1');
    const res = await faculty.post('/api/complaints').send({ categoryId: mess, locationId: hall, title: 'Food quality in mess', description: 'Dinner was cold' });
    expect(res.status).toBe(201);
    expect(res.body.complaint).toMatchObject({ status: 'SUBMITTED', category: { name: 'Mess and Canteen', type: 'SERVICE' }, assignee: null });
    const notes = await rows(
      'SELECT u.role FROM notifications n JOIN users u ON u.user_id = n.user_id WHERE n.complaint_id = ?', [res.body.complaintId]);
    expect(notes.map((n) => n.role)).toEqual(['ADMIN']);
  });

  test('no maintenance staff are offered for it, only administrators', async () => {
    const faculty = await as('faculty1');
    const { body } = await faculty.post('/api/complaints').send({ categoryId: mess, locationId: hall, description: 'Stale rice' });
    const staff = await (await as('admin1')).get(`/api/complaints/${body.complaintId}/eligible-staff`);
    expect(staff.status).toBe(200);
    expect(staff.body.staff.map((s) => s.name)).toEqual(['Anita Deshmukh']);
  });
});

describe('reference data for the form', () => {
  test('categories and locations are readable by any logged-in user', async () => {
    const student = await as('student1');
    const cats = await student.get('/api/categories');
    expect(cats.status).toBe(200);
    expect(cats.body.categories).toHaveLength(8);
    expect(cats.body.categories.find((c) => c.name === 'Mess and Canteen')).toMatchObject({ type: 'SERVICE', defaultPriority: 'MEDIUM' });
    const locs = await student.get('/api/locations');
    expect(locs.body.locations).toHaveLength(13);
    expect(locs.body.locations.find((l) => l.block === 'Hostel Block A' && l.room === '204')).toMatchObject({ floor: 2, areaType: 'HOSTEL' });
    expect((await anonymous.get('/api/categories')).status).toBe(401);
    expect((await anonymous.get('/api/locations')).status).toBe(401);
  });
});

describe('group notifications reach every member of the group', () => {
  test('with two supervisors and two administrators, all four are told about the right complaints', async () => {
    const hash = (await rows("SELECT password_hash h FROM users WHERE email = 'admin1@nmims.edu'"))[0].h;
    await rows("INSERT INTO users (role, name, email, password_hash) VALUES ('SUPERVISOR', 'Second Supervisor', 'supervisor2@nmims.edu', ?), ('ADMIN', 'Second Admin', 'admin2@nmims.edu', ?)", [hash, hash]);
    const faculty = await as('faculty1');
    const infra = await faculty.post('/api/complaints').send({ categoryId: hvac, locationId: a204, description: 'Fan broken' });
    const service = await faculty.post('/api/complaints').send({ categoryId: await categoryId('Mess and Canteen'), locationId: await locationId('Hostel Mess', 'Dining Hall'), description: 'Cold food' });
    const who = async (id) => (await rows('SELECT u.email FROM notifications n JOIN users u ON u.user_id = n.user_id WHERE n.complaint_id = ? ORDER BY u.email', [id])).map((r) => r.email);
    expect(await who(infra.body.complaintId)).toEqual(['supervisor1@nmims.edu', 'supervisor2@nmims.edu']);
    expect(await who(service.body.complaintId)).toEqual(['admin1@nmims.edu', 'admin2@nmims.edu']);
  });
});
