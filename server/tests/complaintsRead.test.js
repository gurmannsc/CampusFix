// M4 part 2: reading complaints. US-03 (status and history), US-04 / US-05 (sorted list, filters).
import { resetTestDatabase, closeDb } from './helpers/db.js';
import { as, anonymous, complaintIdByTitle, rows } from './helpers/api.js';

beforeAll(resetTestDatabase);
afterAll(closeDb);

const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

describe('GET /api/complaints is role-filtered', () => {
  test('a student sees only their own complaints', async () => {
    const student = await as('student1');
    const res = await student.get('/api/complaints');
    expect(res.status).toBe(200);
    const [{ n }] = await rows('SELECT COUNT(*) n FROM complaints WHERE reporter_id = ?', [student.userId]);
    expect(n).toBeGreaterThan(0);
    expect(res.body.complaints).toHaveLength(n);
    expect(res.body.complaints.every((c) => c.reporter.userId === student.userId)).toBe(true);
  });

  test('faculty see only their own', async () => {
    const faculty = await as('faculty1');
    const res = await faculty.get('/api/complaints');
    expect(res.body.complaints.length).toBeGreaterThan(0);
    expect(res.body.complaints.every((c) => c.reporter.userId === faculty.userId)).toBe(true);
  });

  test('staff see only complaints assigned to them', async () => {
    const plumber = await as('plumber1');
    const res = await plumber.get('/api/complaints');
    expect(res.body.complaints.length).toBeGreaterThan(0);
    expect(res.body.complaints.every((c) => c.assignee?.userId === plumber.userId)).toBe(true);
    // a staff member with nothing assigned (hvac3 is unavailable, so the seed never assigns to them) sees an empty list
    expect((await (await as('hvac3')).get('/api/complaints')).body.complaints).toEqual([]);
  });

  test('supervisor and administrator see all 40', async () => {
    for (const user of ['supervisor1', 'admin1']) {
      expect([user, (await (await as(user)).get('/api/complaints')).body.complaints.length]).toEqual([user, 40]);
    }
  });

  test('anonymous: 401', async () => {
    expect((await anonymous.get('/api/complaints')).status).toBe(401);
  });

  test('list rows carry what the UI needs (names, location, overdue flag)', async () => {
    const res = await (await as('supervisor1')).get('/api/complaints');
    const overdue = res.body.complaints.find((c) => c.title === 'No power in Classroom 204 sockets');
    expect(overdue).toMatchObject({
      status: 'ASSIGNED', priority: 'HIGH', overdue: true, escalationLevel: 0,
      category: { name: 'Electrical' }, location: { block: 'Academic Block', room: 'Classroom 204' },
      assignee: { name: 'Ramesh Yadav' }, reporter: { name: 'Prof. Sanjay Rao' },
    });
    const fresh = res.body.complaints.find((c) => c.title === 'Broken chair in Classroom 101');
    expect(fresh.overdue).toBe(false);
    // closed complaints are never "overdue", even though their dueAt is in the past
    expect(res.body.complaints.filter((c) => c.status === 'CLOSED').every((c) => c.overdue === false)).toBe(true);
  });
});

describe('US-04 / US-05: sorted by priority, then due date', () => {
  test('active complaints come first: CRITICAL at the top, then by priority, and by earliest dueAt within a priority', async () => {
    const { body } = await (await as('supervisor1')).get('/api/complaints');
    const list = body.complaints;
    expect(list[0]).toMatchObject({ priority: 'CRITICAL', title: 'Sparking switchboard near Computer Lab 2' });
    const finished = (c) => c.status === 'CLOSED' || c.status === 'INVALID';
    const firstFinished = list.findIndex(finished);
    expect(firstFinished).toBe(8); // the 8 live seeded complaints, then the 32 finished ones
    expect(list.slice(firstFinished).every(finished)).toBe(true);
    for (const group of [list.slice(0, firstFinished), list.slice(firstFinished)]) {
      for (let i = 1; i < group.length; i += 1) {
        const [a, b] = [group[i - 1], group[i]];
        const rankDiff = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
        expect(rankDiff).toBeGreaterThanOrEqual(0);
        if (rankDiff === 0) expect(new Date(b.dueAt) >= new Date(a.dueAt)).toBe(true);
      }
    }
  });

  test('the sparking switchboard has a 4-hour due date', async () => {
    const id = await complaintIdByTitle('Sparking switchboard near Computer Lab 2');
    const { body } = await (await as('supervisor1')).get(`/api/complaints/${id}`);
    expect((new Date(body.complaint.dueAt) - new Date(body.complaint.createdAt)) / 3600000).toBe(4);
  });
});

describe('filters: status, priority, category, block, from, to', () => {
  const list = async (query) => (await (await as('supervisor1')).get(`/api/complaints?${query}`));

  test('status (single and comma-separated)', async () => {
    const res = await list('status=SUBMITTED');
    expect(res.body.complaints).toHaveLength(3);
    expect(res.body.complaints.every((c) => c.status === 'SUBMITTED')).toBe(true);
    expect((await list('status=SUBMITTED,INVALID')).body.complaints).toHaveLength(5);
  });

  test('priority', async () => {
    const res = await list('priority=CRITICAL');
    expect(res.body.complaints.every((c) => c.priority === 'CRITICAL')).toBe(true);
    const [{ n }] = await rows("SELECT COUNT(*) n FROM complaints WHERE priority = 'CRITICAL'");
    expect(res.body.complaints).toHaveLength(n);
  });

  test('category by name and by id', async () => {
    const byName = await list('category=Mess%20and%20Canteen');
    const [{ category_id, n }] = await rows("SELECT c.category_id, (SELECT COUNT(*) FROM complaints x WHERE x.category_id = c.category_id) n FROM categories c WHERE c.name = 'Mess and Canteen'");
    expect(byName.body.complaints).toHaveLength(n);
    expect(byName.body.complaints.every((c) => c.category.type === 'SERVICE')).toBe(true);
    expect((await list(`category=${category_id}`)).body.complaints).toHaveLength(n);
  });

  test('block', async () => {
    const res = await list('block=Hostel%20Block%20B');
    expect(res.body.complaints.length).toBeGreaterThan(0);
    expect(res.body.complaints.every((c) => c.location.block === 'Hostel Block B')).toBe(true);
  });

  test('date range on createdAt: a plain "to" date includes that whole day', async () => {
    const [{ day, n }] = await rows(
      'SELECT DATE_FORMAT(created_at, "%Y-%m-%d") AS day, COUNT(*) n FROM complaints GROUP BY day ORDER BY n DESC, day LIMIT 1');
    const sameDay = await list(`from=${day}&to=${day}`);
    expect(sameDay.body.complaints).toHaveLength(n);
    expect((await list('from=2099-01-01')).body.complaints).toEqual([]);
    expect((await list('to=2000-01-01')).body.complaints).toEqual([]);
    expect((await list('from=2000-01-01&to=2099-01-01')).body.complaints).toHaveLength(40);
  });

  test('filters combine (AND) and still respect the role', async () => {
    const student = await as('student1');
    const res = await student.get('/api/complaints?status=CLOSED&priority=MEDIUM');
    const [{ n }] = await rows("SELECT COUNT(*) n FROM complaints WHERE reporter_id = ? AND status = 'CLOSED' AND priority = 'MEDIUM'", [student.userId]);
    expect(res.body.complaints).toHaveLength(n);
    expect(res.body.complaints.every((c) => c.status === 'CLOSED' && c.priority === 'MEDIUM' && c.reporter.userId === student.userId)).toBe(true);
  });

  test.each([
    ['status=DONE', 'status'],
    ['priority=URGENT', 'priority'],
    ['from=yesterday', 'from'],
    ['to=31-12-2026x', 'to'],
    ['status=NOPE&priority=NOPE', 'status'],
  ])('%s is a 400 naming the bad filter', async (query, field) => {
    const res = await list(query);
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty(field);
  });

  test('a filter value that looks like SQL is just an unknown value', async () => {
    expect((await list("category=x'%20OR%20'1'='1")).body.complaints).toEqual([]);
    expect((await list("block=x';DROP TABLE complaints;--")).body.complaints).toEqual([]);
    expect((await rows('SELECT COUNT(*) n FROM complaints'))[0].n).toBe(40);
  });
});

describe('US-03: see a complaint and its full status history', () => {
  test('the reporter sees the timeline with timestamps, remarks and who did it', async () => {
    const id = await complaintIdByTitle('Study table drawer stuck'); // reporter student2, RESOLVED 49 h ago
    const res = await (await as('student2')).get(`/api/complaints/${id}`);
    expect(res.status).toBe(200);
    const c = res.body.complaint;
    expect(c).toMatchObject({ status: 'RESOLVED', title: 'Study table drawer stuck', assignee: { name: 'Mohan Lal' }, supervisor: { name: 'Rajiv Malhotra' } });
    expect(c.statusHistory.map((h) => `${h.fromStatus}>${h.toStatus}`)).toEqual([
      'null>SUBMITTED', 'SUBMITTED>ASSIGNED', 'ASSIGNED>IN_PROGRESS', 'IN_PROGRESS>RESOLVED',
    ]);
    expect(c.statusHistory.every((h) => !Number.isNaN(new Date(h.updatedAt).getTime()))).toBe(true);
    expect(c.statusHistory[3]).toMatchObject({ remarks: 'Replaced the drawer rails.', updatedBy: { name: 'Mohan Lal' } });
    const times = c.statusHistory.map((h) => new Date(h.updatedAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test('details include escalations (and the Timer shows as updatedBy: null)', async () => {
    const id = await complaintIdByTitle('No water supply in Hostel Block B');
    const res = await (await as('supervisor1')).get(`/api/complaints/${id}`);
    expect(res.body.complaint).toMatchObject({ status: 'ESCALATED', escalationLevel: 1, overdue: false });
    expect(res.body.complaint.escalations).toHaveLength(1);
    expect(res.body.complaint.escalations[0]).toMatchObject({ level: 1, reason: 'Complaint overdue' });
    const last = res.body.complaint.statusHistory.at(-1);
    expect(last).toMatchObject({ toStatus: 'ESCALATED', updatedBy: null });
  });

  test('details include feedback (rating, comment) for closed complaints', async () => {
    const [{ complaint_id }] = await rows('SELECT f.complaint_id FROM feedback f WHERE f.is_fixed = TRUE LIMIT 1');
    const res = await (await as('admin1')).get(`/api/complaints/${complaint_id}`);
    expect(res.body.complaint.status).toBe('CLOSED');
    expect(res.body.complaint.feedback.at(-1)).toMatchObject({ isFixed: true, comment: 'Fixed, thanks.' });
    expect(res.body.complaint.feedback.at(-1).rating).toBeGreaterThanOrEqual(1);
  });

  test('who may open a complaint: reporter, its assignee, supervisor, administrator', async () => {
    const id = await complaintIdByTitle('No water supply in Hostel Block B'); // reporter student3, assignee plumber1
    for (const user of ['student3', 'plumber1', 'supervisor1', 'admin1']) {
      expect([user, (await (await as(user)).get(`/api/complaints/${id}`)).status]).toEqual([user, 200]);
    }
    for (const user of ['student1', 'faculty1', 'electrician1', 'hvac1']) {
      const res = await (await as(user)).get(`/api/complaints/${id}`);
      expect([user, res.status]).toEqual([user, 403]);
    }
    expect((await anonymous.get(`/api/complaints/${id}`)).status).toBe(401);
  });

  test('unknown id is 404; a malformed id is 400', async () => {
    const supervisor = await as('supervisor1');
    expect((await supervisor.get('/api/complaints/99999')).status).toBe(404);
    for (const bad of ['abc', '0', '-3', '1.5']) {
      expect([bad, (await supervisor.get(`/api/complaints/${bad}`)).status]).toEqual([bad, 400]);
    }
  });

  test('no password hashes or e-mail addresses leak through complaint JSON', async () => {
    const id = await complaintIdByTitle('Study table drawer stuck');
    const text = JSON.stringify((await (await as('student2')).get(`/api/complaints/${id}`)).body);
    expect(text).not.toMatch(/password|@nmims\.edu|photoPath|photo_path/i);
  });
});
