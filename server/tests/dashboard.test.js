// M9: GET /api/dashboard (US-10): resolution time, open vs closed, workload, deadline breaches, ratings,
// with filters category, block and date range. The exact numbers come from a small scenario computed by hand.
import { resetTestDatabase, closeDb } from './helpers/db.js';
import {
  as, anonymous, newComplaint, rows, userIdOf, categoryId, locationId,
} from './helpers/api.js';
import { computeDashboard } from '../src/services/ReportService.js';
import { userRepository } from '../src/repositories/userRepository.js';
import { Administrator } from '../src/domain/index.js';

afterAll(closeDb);

const HOUR = 3600 * 1000;
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
const ago = (h) => new Date(NOW.getTime() - h * HOUR);
const dash = async (query = '', user = 'admin1') => (await as(user)).get(`/api/dashboard${query}`);

// ---- the pure calculation, with hand-made rows ---------------------------------------------

describe('computeDashboard: the definitions', () => {
  const base = { assigneeId: 1, categoryId: 1, categoryName: 'HVAC', categoryType: 'INFRASTRUCTURE', escalated: false };
  // created at t0, due 24 h later
  const t0 = new Date('2026-03-01T00:00:00Z');
  const at = (h) => new Date(t0.getTime() + h * HOUR);
  const c = (id, status, over = {}) => ({ complaintId: id, status, createdAt: t0, dueAt: at(24), resolvedAt: null, ...base, ...over });
  const run = (complaints, ratings = [], now = at(100)) => computeDashboard({ complaints, ratings, staff: [], now });

  test('an empty scope gives zeros and nulls, not NaN', () => {
    const d = run([]);
    expect(d.summary).toMatchObject({ total: 0, open: 0, closed: 0, avgResolutionHours: null, breachPercent: null, avgRating: null });
    expect(d.byCategory).toEqual([]);
    expect(d.ratings).toEqual({ average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  });

  test('resolution time = resolvedAt - createdAt, only for RESOLVED and CLOSED', () => {
    const d = run([
      c(1, 'CLOSED', { resolvedAt: at(10) }), c(2, 'RESOLVED', { resolvedAt: at(20) }),
      c(3, 'REOPENED', { resolvedAt: at(5) }), // resolved once, rejected: not a finished resolution
      c(4, 'ASSIGNED'), c(5, 'INVALID'),
    ]);
    expect(d.summary.resolvedCount).toBe(2);
    expect(d.summary.avgResolutionHours).toBe(15);
  });

  test('open / closed / invalid: RESOLVED still counts as open', () => {
    const d = run([c(1, 'CLOSED'), c(2, 'RESOLVED'), c(3, 'SUBMITTED'), c(4, 'ESCALATED'), c(5, 'INVALID')]);
    expect(d.summary).toMatchObject({ total: 5, open: 3, closed: 1, invalid: 1 });
    expect(d.byStatus).toMatchObject({ CLOSED: 1, RESOLVED: 1, SUBMITTED: 1, ESCALATED: 1, INVALID: 1, ASSIGNED: 0 });
  });

  describe('deadline breach: ever escalated, resolved late, or open and late right now', () => {
    test('resolved on time is not a breach; resolved after dueAt is (even if never escalated)', () => {
      const d = run([c(1, 'CLOSED', { resolvedAt: at(24) }), c(2, 'CLOSED', { resolvedAt: at(24.001) })]);
      expect(d.summary).toMatchObject({ breachEligible: 2, breached: 1, breachPercent: 50 });
    });
    test('an Escalation row makes it a breach even when it was fixed in time afterwards (dueAt gets reset)', () => {
      const d = run([c(1, 'CLOSED', { resolvedAt: at(30), dueAt: at(48), escalated: true })]);
      expect(d.summary.breached).toBe(1);
    });
    test('open and past due counts now, before the timer has escalated it; open inside the deadline does not count at all', () => {
      const d = run([c(1, 'ASSIGNED'), c(2, 'IN_PROGRESS', { dueAt: at(500) })], [], at(30));
      expect(d.summary).toMatchObject({ breachEligible: 1, breached: 1, breachPercent: 100 });
    });
    test('a RESOLVED complaint is judged by when it was resolved, not by the clock', () => {
      const d = run([c(1, 'RESOLVED', { resolvedAt: at(2) })], [], at(1000));
      expect(d.summary).toMatchObject({ breached: 0, breachEligible: 1, breachPercent: 0 });
    });
    test('INVALID complaints never count; breachPercent is rounded to one decimal', () => {
      const d = run([c(1, 'INVALID', { escalated: true }), c(2, 'CLOSED', { resolvedAt: at(25) }), c(3, 'CLOSED', { resolvedAt: at(1) }), c(4, 'CLOSED', { resolvedAt: at(1) })]);
      expect(d.summary).toMatchObject({ breachEligible: 3, breached: 1, breachPercent: 33.3 });
    });
  });

  test('ratings: average rounded to one decimal, distribution by star', () => {
    const d = run([c(1, 'CLOSED')], [{ rating: 5 }, { rating: 4 }, { rating: 4 }].map((r) => ({ ...r, categoryId: 1, assigneeId: 1 })));
    expect(d.ratings).toEqual({ average: 4.3, count: 3, distribution: { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 } });
  });

  test('workload: working statuses only; staff are listed even with nothing; an Administrator only with SERVICE complaints', () => {
    const staff = [
      { userId: 1, name: 'Busy', trade: 'HVAC', role: 'STAFF' }, { userId: 2, name: 'Idle', trade: 'HVAC', role: 'STAFF' },
      { userId: 3, name: 'Boss', trade: null, role: 'ADMIN' }, { userId: 4, name: 'Other Boss', trade: null, role: 'ADMIN' },
    ];
    const d = computeDashboard({
      complaints: [
        c(1, 'ASSIGNED'), c(2, 'IN_PROGRESS'), c(3, 'ON_HOLD'), c(4, 'ESCALATED'), c(5, 'REOPENED'), c(6, 'RESOLVED', { resolvedAt: at(5) }),
        c(7, 'ASSIGNED', { assigneeId: 3, categoryId: 2, categoryName: 'Mess', categoryType: 'SERVICE' }),
      ],
      ratings: [], staff, now: at(1),
    });
    expect(d.workload.map((w) => [w.name, w.openAssignments, w.completed, w.totalAssigned])).toEqual([
      ['Busy', 4, 1, 6], ['Boss', 1, 0, 1], ['Idle', 0, 0, 0],
    ]);
  });

  test('categories are sorted infrastructure first, then by name', () => {
    const d = run([
      c(1, 'CLOSED', { categoryId: 3, categoryName: 'Mess', categoryType: 'SERVICE' }),
      c(2, 'CLOSED', { categoryId: 2, categoryName: 'Plumbing' }), c(3, 'CLOSED', { categoryId: 1, categoryName: 'HVAC' }),
    ]);
    expect(d.byCategory.map((x) => x.name)).toEqual(['HVAC', 'Plumbing', 'Mess']);
  });
});

// ---- the API, on a scenario computed by hand ------------------------------------------------

describe('GET /api/dashboard on a hand-made scenario', () => {
  /*
   * 9 complaints (age = hours since created, due = created + 24/48):
   *  #  category    block          status     age  due  resolved after  other
   *  1  HVAC        Hostel Block A CLOSED     100  48   30 h (in time)  rating 5, hvac1
   *  2  HVAC        Hostel Block A CLOSED     200  48   60 h (late)     rating 3, hvac1
   *  3  HVAC        Hostel Block A ASSIGNED    10  48   -              hvac2, inside its deadline
   *  4  HVAC        Hostel Block A ASSIGNED    80  48   -              hvac2, 32 h overdue
   *  5  HVAC        Hostel Block A INVALID     20  48   -              left out of everything
   *  6  Electrical  Academic Block CLOSED     300  24   10 h            escalated once, no rating (auto-closed), electrician1
   *  7  Electrical  Academic Block RESOLVED    50  24   20 h            electrician1
   *  8  Electrical  Academic Block REOPENED    30  24 (+48 from reopen)  resolved once, then rejected
   *  9  Electrical  Academic Block ESCALATED   60  24   -              escalated, electrician1
   * Expected: total 9, open 5 (3,4,7,8,9), closed 3, invalid 1.
   * Resolution: #1 30, #2 60, #6 10, #7 20 -> 30 h average.
   * Eligible for breach %: finished 1,2,6,7 + breached 4,9 = 6; breached: 2 (late), 4 (overdue), 6 (escalated), 9 = 4 -> 66.7 %.
   * Ratings 5 and 3 -> 4.0.
   */
  let ids;

  beforeAll(async () => {
    await resetTestDatabase();
    await rows('DELETE FROM complaints'); // the seed's own complaints are removed; users and reference data stay
    const A204 = await locationId('Hostel Block A', '204');
    const CR101 = await locationId('Academic Block', 'Classroom 101');
    const hvac = await categoryId('HVAC');
    const electrical = await categoryId('Electrical');
    const student = await userIdOf('student1');
    const supervisor = await userIdOf('supervisor1');
    const insert = async (n, { category, location, status, age, dueAfter, resolvedAfter = null, assignee = null }) => {
      const created = ago(age);
      const res = await rows(
        `INSERT INTO complaints (title, description, priority, status, created_at, due_at, resolved_at, closed_at, reporter_id,
           category_id, location_id, supervisor_id, assignee_id) VALUES (?)`,
        [[`Scenario ${n}`, 'x', 'MEDIUM', status, created, new Date(created.getTime() + dueAfter * HOUR),
          resolvedAfter == null ? null : new Date(created.getTime() + resolvedAfter * HOUR),
          status === 'CLOSED' ? new Date(created.getTime() + (resolvedAfter + 1) * HOUR) : null,
          student, category, location, assignee ? supervisor : null, assignee ? await userIdOf(assignee) : null]],
      );
      return res.insertId;
    };
    ids = {};
    ids[1] = await insert(1, { category: hvac, location: A204, status: 'CLOSED', age: 100, dueAfter: 48, resolvedAfter: 30, assignee: 'hvac1' });
    ids[2] = await insert(2, { category: hvac, location: A204, status: 'CLOSED', age: 200, dueAfter: 48, resolvedAfter: 60, assignee: 'hvac1' });
    ids[3] = await insert(3, { category: hvac, location: A204, status: 'ASSIGNED', age: 10, dueAfter: 48, assignee: 'hvac2' });
    ids[4] = await insert(4, { category: hvac, location: A204, status: 'ASSIGNED', age: 80, dueAfter: 48, assignee: 'hvac2' });
    ids[5] = await insert(5, { category: hvac, location: A204, status: 'INVALID', age: 20, dueAfter: 48 });
    ids[6] = await insert(6, { category: electrical, location: CR101, status: 'CLOSED', age: 300, dueAfter: 24, resolvedAfter: 10, assignee: 'electrician1' });
    ids[7] = await insert(7, { category: electrical, location: CR101, status: 'RESOLVED', age: 50, dueAfter: 24, resolvedAfter: 20, assignee: 'electrician1' });
    ids[8] = await insert(8, { category: electrical, location: CR101, status: 'REOPENED', age: 30, dueAfter: 72, resolvedAfter: 10, assignee: 'electrician1' });
    ids[9] = await insert(9, { category: electrical, location: CR101, status: 'ESCALATED', age: 60, dueAfter: 24, assignee: 'electrician1' });
    await rows('INSERT INTO escalations (complaint_id, level, reason, escalated_at) VALUES (?, 1, ?, ?), (?, 1, ?, ?)',
      [ids[6], 'Complaint overdue', ago(290), ids[9], 'Complaint overdue', ago(35)]);
    await rows('INSERT INTO feedback (complaint_id, is_fixed, rating, comment, given_at) VALUES (?, TRUE, 5, NULL, ?), (?, TRUE, 3, NULL, ?)',
      [ids[1], ago(69), ids[2], ago(139)]);
  });

  test('summary: open vs closed, resolution time, deadline breach %, rating', async () => {
    const { status, body } = await dash();
    expect(status).toBe(200);
    expect(body.summary).toEqual({
      total: 9, open: 5, closed: 3, invalid: 1,
      resolvedCount: 4, avgResolutionHours: 30,
      breached: 4, breachEligible: 6, breachPercent: 66.7,
      avgRating: 4, ratingCount: 2,
    });
    expect(body.byStatus).toEqual({ SUBMITTED: 0, INVALID: 1, ASSIGNED: 2, IN_PROGRESS: 0, ON_HOLD: 0, RESOLVED: 1, REOPENED: 1, ESCALATED: 1, CLOSED: 3 });
    expect(body.ratings).toEqual({ average: 4, count: 2, distribution: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 } });
    expect(new Date(body.generatedAt).getTime()).toBeGreaterThan(NOW.getTime() - 1000);
  });

  test('by category: HVAC and Electrical', async () => {
    const { body } = await dash();
    expect(body.byCategory).toHaveLength(2);
    expect(body.byCategory.find((c) => c.name === 'HVAC')).toMatchObject({
      type: 'INFRASTRUCTURE', total: 5, open: 2, closed: 2, invalid: 1, resolvedCount: 2, avgResolutionHours: 45,
      breached: 2, breachEligible: 3, breachPercent: 66.7, avgRating: 4, ratingCount: 2,
    });
    expect(body.byCategory.find((c) => c.name === 'Electrical')).toMatchObject({
      total: 4, open: 3, closed: 1, invalid: 0, resolvedCount: 2, avgResolutionHours: 15,
      breached: 2, breachEligible: 3, breachPercent: 66.7, avgRating: null, ratingCount: 0,
    });
  });

  test('workload per staff member: open assignments, completed, rating; idle staff are listed', async () => {
    const { body } = await dash();
    const top = body.workload.slice(0, 3).map((w) => [w.name, w.openAssignments, w.completed, w.totalAssigned, w.avgRating]);
    expect(top).toEqual([
      ['Deepak Chouhan', 2, 0, 2, null], // hvac2: two ASSIGNED
      ['Ramesh Yadav', 1, 2, 4, null], // electrician1: one ESCALATED (REOPENED and RESOLVED are not "working"), 6 and 7 completed
      ['Imran Khan', 0, 2, 2, 4], // hvac1: both closed, ratings 5 and 3
    ]);
    expect(body.workload.map((w) => w.name)).toContain('Vikram Solanki'); // hvac3 has nothing but is a staff member
    expect(body.workload.map((w) => w.name)).not.toContain('Anita Deshmukh'); // administrator without service complaints
    expect(body.workload.every((w) => w.role === 'STAFF')).toBe(true);
  });

  describe('filters', () => {
    test('category by name or by id', async () => {
      expect((await dash('?category=HVAC')).body.summary).toMatchObject({ total: 5, closed: 2, breached: 2, breachEligible: 3 });
      expect((await dash(`?category=${await categoryId('Electrical')}`)).body.summary).toMatchObject({ total: 4, closed: 1 });
      const hvac = (await dash('?category=HVAC')).body;
      expect(hvac.byCategory.map((c) => c.name)).toEqual(['HVAC']);
      expect(hvac.workload.find((w) => w.name === 'Ramesh Yadav').totalAssigned).toBe(0); // his complaints are outside this scope
    });

    test('block', async () => {
      expect((await dash('?block=Academic%20Block')).body.summary).toMatchObject({ total: 4, avgResolutionHours: 15 });
      expect((await dash('?block=Hostel%20Block%20A')).body.summary).toMatchObject({ total: 5 });
      expect((await dash('?block=Library')).body.summary).toMatchObject({ total: 0, avgResolutionHours: null, breachPercent: null, avgRating: null });
    });

    test('date range on the day the complaint was reported (from inclusive, to exclusive for timestamps)', async () => {
      const q = (from, to) => dash(`?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
      expect((await dash(`?from=${encodeURIComponent(ago(120).toISOString())}`)).body.summary.total).toBe(7); // ages 100,10,80,20,50,30,60
      expect((await dash(`?to=${encodeURIComponent(ago(70).toISOString())}`)).body.summary.total).toBe(4); // ages 100,200,80,300
      expect((await q(ago(250), ago(90))).body.summary.total).toBe(2); // ages 100 and 200
      expect((await q(ago(250), ago(90))).body.summary).toMatchObject({ closed: 2, avgResolutionHours: 45, breached: 1, breachEligible: 2 });
    });

    test('filters combine', async () => {
      const res = await dash(`?category=HVAC&block=Hostel%20Block%20A&from=${encodeURIComponent(ago(120).toISOString())}`);
      expect(res.body.summary).toMatchObject({ total: 4, closed: 1, invalid: 1 }); // HVAC complaints aged 100, 10, 80, 20
    });

    test('the applied filters are echoed back for the UI', async () => {
      expect((await dash('?category=HVAC&block=X&from=2026-01-01&to=2026-02-01')).body.appliedFilters)
        .toEqual({ category: 'HVAC', block: 'X', from: '2026-01-01', to: '2026-02-01' });
      expect((await dash()).body.appliedFilters).toEqual({ category: null, block: null, from: null, to: null });
    });

    test.each([['from=yesterday', 'from'], ['to=31-12-2026x', 'to']])('%s is a 400 naming the filter', async (query, field) => {
      const res = await dash(`?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.details).toHaveProperty(field);
    });

    test('unrelated parameters (status, priority) are ignored, not errors', async () => {
      expect((await dash('?status=NOPE&priority=NOPE')).body.summary.total).toBe(9);
    });

    test('a filter that looks like SQL is just a category that does not exist', async () => {
      expect((await dash("?category=x'%20OR%20'1'='1")).body.summary.total).toBe(0);
    });
  });

  test('only administrators may open the dashboard', async () => {
    for (const user of ['student1', 'faculty1', 'electrician1', 'supervisor1']) {
      expect([user, (await dash('', user)).status]).toEqual([user, 403]);
    }
    expect((await anonymous.get('/api/dashboard')).status).toBe(401);
  });

  test('Administrator.viewDashboard() from the class diagram returns the same numbers', async () => {
    const admin = await userRepository.findById(await userIdOf('admin1'));
    expect(admin).toBeInstanceOf(Administrator);
    const viaDomain = await admin.viewDashboard({});
    expect(viaDomain.summary).toMatchObject({ total: 9, breached: 4, avgResolutionHours: 30 });
  });
});

// ---- the API on the demo seed, checked against independent SQL ------------------------------

describe('GET /api/dashboard on the demo seed', () => {
  beforeAll(resetTestDatabase);
  const OPEN = "('SUBMITTED','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED')";

  test('totals match the database', async () => {
    const { body } = await dash();
    const [t] = await rows("SELECT COUNT(*) total, SUM(status = 'CLOSED') closed, SUM(status = 'INVALID') invalid FROM complaints");
    expect(body.summary).toMatchObject({ total: Number(t.total), closed: Number(t.closed), invalid: Number(t.invalid) });
    expect(body.summary.open).toBe(Number(t.total) - Number(t.closed) - Number(t.invalid));
    expect(body.byCategory.reduce((sum, c) => sum + c.total, 0)).toBe(body.summary.total);
    expect(Object.values(body.byStatus).reduce((a, b) => a + b, 0)).toBe(body.summary.total);
  });

  test('average resolution time per category matches SQL', async () => {
    const { body } = await dash();
    const sql = await rows(
      `SELECT g.name, ROUND(AVG(TIMESTAMPDIFF(SECOND, c.created_at, c.resolved_at)) / 3600, 1) AS h, COUNT(*) n
       FROM complaints c JOIN categories g USING (category_id)
       WHERE c.status IN ('CLOSED','RESOLVED') AND c.resolved_at IS NOT NULL GROUP BY g.name`);
    expect(sql.length).toBeGreaterThan(5);
    for (const row of sql) {
      const api = body.byCategory.find((c) => c.name === row.name);
      expect([row.name, api.resolvedCount, api.avgResolutionHours]).toEqual([row.name, Number(row.n), Number(row.h)]);
    }
  });

  test('breach counts match an independent SQL formulation of the definition', async () => {
    const { body } = await dash();
    const now = new Date();
    const breached = `c.status <> 'INVALID' AND (EXISTS (SELECT 1 FROM escalations e WHERE e.complaint_id = c.complaint_id)
                      OR c.resolved_at > c.due_at OR (c.status IN ${OPEN} AND c.due_at < ?))`;
    const [b] = await rows(`SELECT COUNT(*) n FROM complaints c WHERE ${breached}`, [now]);
    const [e] = await rows(`SELECT COUNT(*) n FROM complaints c WHERE c.status <> 'INVALID' AND (c.status IN ('CLOSED','RESOLVED') OR (${breached}))`, [now]);
    expect(body.summary.breached).toBe(Number(b.n));
    expect(body.summary.breachEligible).toBe(Number(e.n));
    expect(body.summary.breached).toBeGreaterThanOrEqual(6); // 4 breached historical + the overdue and the escalated live ones
    expect(body.summary.breachPercent).toBe(Math.round((Number(b.n) / Number(e.n)) * 1000) / 10);
  });

  test('average rating and distribution match SQL; auto-closed complaints have no rating', async () => {
    const { body } = await dash();
    const [r] = await rows('SELECT ROUND(AVG(rating), 1) a, COUNT(*) n FROM feedback WHERE is_fixed = TRUE AND rating IS NOT NULL');
    expect(body.ratings).toMatchObject({ average: Number(r.a), count: Number(r.n) });
    expect(Object.values(body.ratings.distribution).reduce((a, b) => a + b, 0)).toBe(Number(r.n));
    expect(body.summary.ratingCount).toBe(Number(r.n));
  });

  test('workload lists every maintenance staff member and sums to the assigned complaints', async () => {
    const { body } = await dash();
    const [{ n: staffCount }] = await rows("SELECT COUNT(*) n FROM users WHERE role = 'STAFF'");
    expect(body.workload.filter((w) => w.role === 'STAFF')).toHaveLength(Number(staffCount));
    const [{ n: assigned }] = await rows('SELECT COUNT(*) n FROM complaints WHERE assignee_id IS NOT NULL');
    expect(body.workload.reduce((sum, w) => sum + w.totalAssigned, 0)).toBe(Number(assigned));
    const [{ n: working }] = await rows("SELECT COUNT(*) n FROM complaints WHERE status IN ('ASSIGNED','IN_PROGRESS','ON_HOLD','ESCALATED')");
    expect(body.workload.reduce((sum, w) => sum + w.openAssignments, 0)).toBe(Number(working));
  });

  test('filters on the seed agree with SQL counts', async () => {
    const [{ n: block }] = await rows("SELECT COUNT(*) n FROM complaints c JOIN locations l USING (location_id) WHERE l.block = 'Hostel Block A'");
    expect((await dash('?block=Hostel%20Block%20A')).body.summary.total).toBe(Number(block));
    const [{ n: cat }] = await rows("SELECT COUNT(*) n FROM complaints c JOIN categories g USING (category_id) WHERE g.name = 'Plumbing'");
    expect((await dash('?category=Plumbing')).body.summary.total).toBe(Number(cat));
  });

  test('the dashboard moves with the workflow: a new complaint, confirmed with a rating, shows up', async () => {
    const before = (await dash()).body;
    const id = await newComplaint({ stage: 'RESOLVED', category: 'HVAC' });
    expect((await dash()).body.summary).toMatchObject({ total: before.summary.total + 1, open: before.summary.open + 1 });
    await (await as('student1')).post(`/api/complaints/${id}/confirm`).send({ rating: 5 });
    const after = (await dash()).body;
    expect(after.summary).toMatchObject({ total: before.summary.total + 1, closed: before.summary.closed + 1, open: before.summary.open, ratingCount: before.summary.ratingCount + 1 });
    expect(after.ratings.distribution[5]).toBe(before.ratings.distribution[5] + 1);
    const hvac1Before = before.workload.find((w) => w.name === 'Imran Khan');
    const hvac1After = after.workload.find((w) => w.name === 'Imran Khan');
    expect(hvac1After.completed).toBe(hvac1Before.completed + 1);
  });
});
