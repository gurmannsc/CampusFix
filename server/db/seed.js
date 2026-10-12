// Seed data: reference data (rules, categories, locations), demo users, ~30 closed historical
// complaints for the dashboard, and the live demo scenarios from docs/07-demo-script.md.
// All timestamps are computed relative to `now`, so `npm run reset-demo` always gives a fresh
// "overdue", "escalated 25 hours ago" and "resolved 49 hours ago" state. The historical data
// uses a fixed-seed random generator, so it is identical on every run.
import bcrypt from 'bcrypt';

export const DEMO_PASSWORD = 'demo123';
const HOUR = 3600 * 1000;
const at = (base, hoursFromBase) => new Date(base.getTime() + hoursFromBase * HOUR);

// ---- Reference data -------------------------------------------------------------------------

// docs/01-problem-and-scope.md "Priority deadlines"
const DEADLINE_RULES = [
  ['CRITICAL', 4, 24],
  ['HIGH', 24, 24],
  ['MEDIUM', 48, 24],
  ['LOW', 120, 24],
];

// Default priorities are our choice (docs leave them open; agreed in the kickoff review).
const CATEGORIES = [
  { name: 'Electrical', type: 'INFRASTRUCTURE', defaultPriority: 'HIGH' },
  { name: 'Plumbing', type: 'INFRASTRUCTURE', defaultPriority: 'HIGH' },
  { name: 'Furniture', type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM' },
  { name: 'HVAC', type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM' },
  { name: 'IT and AV', type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM' },
  { name: 'Civil', type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM' },
  { name: 'Housekeeping', type: 'INFRASTRUCTURE', defaultPriority: 'MEDIUM' },
  { name: 'Mess and Canteen', type: 'SERVICE', defaultPriority: 'MEDIUM' },
];

const LOCATIONS = [
  { key: 'A101', block: 'Hostel Block A', floor: 1, room: '101', areaType: 'HOSTEL' },
  { key: 'A204', block: 'Hostel Block A', floor: 2, room: '204', areaType: 'HOSTEL' },
  { key: 'A205', block: 'Hostel Block A', floor: 2, room: '205', areaType: 'HOSTEL' },
  { key: 'B110', block: 'Hostel Block B', floor: 1, room: '110', areaType: 'HOSTEL' },
  { key: 'B215', block: 'Hostel Block B', floor: 2, room: '215', areaType: 'HOSTEL' },
  { key: 'BWASH', block: 'Hostel Block B', floor: 2, room: 'Washroom', areaType: 'WASHROOM' },
  { key: 'CR101', block: 'Academic Block', floor: 1, room: 'Classroom 101', areaType: 'CLASSROOM' },
  { key: 'CR204', block: 'Academic Block', floor: 2, room: 'Classroom 204', areaType: 'CLASSROOM' },
  { key: 'LAB2', block: 'Academic Block', floor: 2, room: 'Computer Lab 2', areaType: 'LAB' },
  { key: 'AWASH', block: 'Academic Block', floor: 1, room: 'Washroom', areaType: 'WASHROOM' },
  { key: 'LIB', block: 'Library', floor: 0, room: 'Entrance Lobby', areaType: 'COMMON_AREA' },
  { key: 'MESS', block: 'Hostel Mess', floor: 0, room: 'Dining Hall', areaType: 'MESS' },
  { key: 'CANTEEN', block: 'Main Canteen', floor: 0, room: 'Counter Area', areaType: 'MESS' },
];

// Inserts one row from an object of column -> value; returns the new auto-increment id.
async function insert(conn, table, row) {
  const cols = Object.keys(row);
  const [res] = await conn.query('INSERT INTO ?? (??) VALUES (?)', [table, cols, cols.map((c) => row[c] ?? null)]);
  return res.insertId;
}

// Reference data only (no users, no complaints). Tests can reuse this on an empty database.
export async function seedReference(conn) {
  for (const [priority, resolution_hours, escalation_interval_hours] of DEADLINE_RULES) {
    await insert(conn, 'deadline_rules', { priority, resolution_hours, escalation_interval_hours });
  }
  const categoryIds = {};
  for (const c of CATEGORIES) {
    categoryIds[c.name] = await insert(conn, 'categories', {
      name: c.name, type: c.type, default_priority: c.defaultPriority,
    });
  }
  const locationIds = {};
  for (const l of LOCATIONS) {
    locationIds[l.key] = await insert(conn, 'locations', {
      block: l.block, floor: l.floor, room: l.room, area_type: l.areaType,
    });
  }
  return { categoryIds, locationIds };
}

// ---- Users ----------------------------------------------------------------------------------
// Login is by email: <username>@nmims.edu, password demo123 for everyone.
const USERS = [
  { u: 'student1', role: 'STUDENT', name: 'Aarav Mehta', sap_id: '70012300101', program: 'MBA Tech CE', hostel_room: 'A-204' },
  { u: 'student2', role: 'STUDENT', name: 'Riya Sharma', sap_id: '70012300102', program: 'MBA Tech CE', hostel_room: 'B-110' },
  { u: 'student3', role: 'STUDENT', name: 'Kabir Verma', sap_id: '70012300103', program: 'B.Tech CE', hostel_room: 'B-215' },
  { u: 'faculty1', role: 'FACULTY', name: 'Dr. Neha Joshi', employee_id: 'EMP1001', department: 'Computer Engineering' },
  { u: 'faculty2', role: 'FACULTY', name: 'Prof. Sanjay Rao', employee_id: 'EMP1002', department: 'Management' },
  { u: 'electrician1', role: 'STAFF', name: 'Ramesh Yadav', trade: 'Electrical', is_available: true },
  { u: 'plumber1', role: 'STAFF', name: 'Suresh Patil', trade: 'Plumbing', is_available: true },
  { u: 'carpenter1', role: 'STAFF', name: 'Mohan Lal', trade: 'Furniture', is_available: true },
  { u: 'hvac1', role: 'STAFF', name: 'Imran Khan', trade: 'HVAC', is_available: true },
  { u: 'hvac2', role: 'STAFF', name: 'Deepak Chouhan', trade: 'HVAC', is_available: true },
  { u: 'hvac3', role: 'STAFF', name: 'Vikram Solanki', trade: 'HVAC', is_available: false }, // shows the availability filter
  { u: 'itsupport1', role: 'STAFF', name: 'Pooja Nair', trade: 'IT and AV', is_available: true },
  { u: 'civil1', role: 'STAFF', name: 'Arjun Thakur', trade: 'Civil', is_available: true },
  { u: 'housekeeper1', role: 'STAFF', name: 'Sunita Bai', trade: 'Housekeeping', is_available: true },
  { u: 'supervisor1', role: 'SUPERVISOR', name: 'Rajiv Malhotra' },
  { u: 'admin1', role: 'ADMIN', name: 'Anita Deshmukh' },
];

async function seedUsers(conn) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = {};
  let n = 0;
  for (const { u, ...fields } of USERS) {
    ids[u] = await insert(conn, 'users', {
      ...fields,
      email: `${u}@nmims.edu`,
      phone: `98260${10100 + n++}`, // dummy 10-digit numbers
      password_hash: passwordHash,
    });
  }
  return ids;
}

// ---- Complaint helpers ----------------------------------------------------------------------

// Complaint text pool per category: [title, description]
const TEXTS = {
  Electrical: [['Socket not working', 'The wall socket gives no power; tried two devices.'], ['Tube light flickering', 'Light flickers continuously and gives headaches.'], ['Switch sparks when pressed', 'Small sparks seen when the switch is turned on.']],
  Plumbing: [['Tap leaking', 'Water drips constantly from the tap.'], ['No water supply', 'No water in the room since morning.'], ['Blocked drain', 'Water is not draining from the floor outlet.']],
  Furniture: [['Chair broken', 'One leg of the chair is cracked.'], ['Cupboard door loose', 'The hinge has come off the cupboard door.'], ['Bench wobbling', 'The bench is unstable and unsafe to sit on.']],
  HVAC: [['Ceiling fan not working', 'Fan does not start at any speed.'], ['AC not cooling', 'AC runs but the room stays warm.'], ['Fan making loud noise', 'Fan rattles loudly when running.']],
  'IT and AV': [['Projector not working', 'Projector shows no signal on HDMI.'], ['Wi-Fi down', 'No Wi-Fi connectivity in this area.'], ['Microphone not working', 'Podium microphone gives no sound.']],
  Civil: [['Ceiling plaster peeling', 'Plaster is flaking and falling.'], ['Cracked floor tile', 'A tile is cracked and sharp.'], ['Door will not close', 'Door frame has warped and the door jams.']],
  Housekeeping: [['Washroom not cleaned', 'Not cleaned for two days.'], ['Dustbins overflowing', 'Bins have not been emptied.'], ['Corridor floor dirty', 'Spill left uncleaned in the corridor.']],
  'Mess and Canteen': [['Food quality poor', 'Dinner was undercooked and cold.'], ['Stale food served', 'Stale items were served at lunch.'], ['Long queue at canteen', 'Only one counter open during the lunch rush.']],
};

// Small deterministic random generator (mulberry32) so historical data is the same every run.
function makeRng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemoData(conn, now = new Date()) {
  const { categoryIds, locationIds } = await seedReference(conn);
  const userIds = await seedUsers(conn);
  const ruleHours = Object.fromEntries(DEADLINE_RULES.map(([p, h]) => [p, h]));
  const catByName = Object.fromEntries(CATEGORIES.map((c) => [c.name, c]));

  // Inserts a complaint plus its StatusUpdate / Feedback / Escalation rows.
  async function addComplaint(c, { trail = [], feedback = [], escalations = [] } = {}) {
    const category = catByName[c.category];
    const id = await insert(conn, 'complaints', {
      title: c.title, description: c.description, photo_path: null,
      priority: c.priority, status: c.status,
      created_at: c.createdAt, due_at: c.dueAt, resolved_at: c.resolvedAt, closed_at: c.closedAt,
      escalation_level: c.escalationLevel ?? 0, reopen_count: c.reopenCount ?? 0,
      reporter_id: userIds[c.reporter], category_id: categoryIds[c.category], location_id: locationIds[c.location],
      supervisor_id: category.type === 'SERVICE' || !c.assignee ? null : userIds.supervisor1,
      assignee_id: c.assignee ? userIds[c.assignee] : null,
    });
    for (const t of trail) {
      await insert(conn, 'status_updates', {
        complaint_id: id, from_status: t.from, to_status: t.to, remarks: t.remarks,
        updated_by: t.by ? userIds[t.by] : null, updated_at: t.at,
      });
    }
    for (const f of feedback) {
      await insert(conn, 'feedback', { complaint_id: id, is_fixed: f.isFixed, rating: f.rating, comment: f.comment, given_at: f.at });
    }
    for (const e of escalations) {
      await insert(conn, 'escalations', { complaint_id: id, level: e.level, reason: e.reason, escalated_at: e.at });
    }
    return id;
  }
  async function notify(user, complaintId, message, sentAt) {
    await insert(conn, 'notifications', { user_id: userIds[user], complaint_id: complaintId, message, is_read: false, sent_at: sentAt });
  }

  // ---- ~30 closed historical complaints (+2 invalid) for the dashboard ----------------------
  const rnd = makeRng(2024);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const reporters = ['student1', 'student2', 'student3', 'faculty1', 'faculty2'];
  const staffFor = (cat) => USERS.filter((x) => x.role === 'STAFF' && x.trade === cat && x.is_available).map((x) => x.u);
  const nonMess = LOCATIONS.filter((l) => l.areaType !== 'MESS').map((l) => l.key);
  const messLocs = LOCATIONS.filter((l) => l.areaType === 'MESS').map((l) => l.key);
  const ratings = [5, 5, 4, 4, 4, 3, 3, 2];
  const priorities = ['CRITICAL', 'HIGH', 'HIGH', 'HIGH', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'LOW', 'LOW'];

  for (let i = 0; i < 32; i++) {
    const category = CATEGORIES[i % CATEGORIES.length].name;
    const isService = catByName[category].type === 'SERVICE';
    const [title, description] = pick(TEXTS[category]);
    const reporter = pick(reporters);
    const location = isService ? pick(messLocs) : pick(nonMess);
    const priority = isService ? 'MEDIUM' : pick(priorities);
    const H = ruleHours[priority];
    const staff = isService ? ['admin1'] : staffFor(category);
    const assignee = pick(staff);
    const handler = isService ? 'admin1' : 'supervisor1';
    const createdAt = at(now, -between(12 * 24, 70 * 24));
    const base = { category, title, description, reporter, location, priority, createdAt, assignee };
    const trail = [{ from: null, to: 'SUBMITTED', remarks: null, by: reporter, at: createdAt }];

    // The last two are invalid/duplicate complaints (transition 2).
    if (i >= 30) {
      const tInv = at(createdAt, between(1, 4));
      trail.push({ from: 'SUBMITTED', to: 'INVALID', remarks: 'Duplicate of an existing complaint.', by: 'supervisor1', at: tInv });
      await addComplaint({ ...base, assignee: null, status: 'INVALID', dueAt: at(createdAt, H) }, { trail });
      continue;
    }

    // Pick the story for this complaint: escalated-then-reassigned, reopened once, or smooth.
    const breached = i % 7 === 3;
    const reopened = !breached && H >= 24 && i % 9 === 4;
    const autoClosed = i % 11 === 5;
    const escalations = [];
    const feedback = [];
    let dueAt = at(createdAt, H);
    let reopenCount = 0;

    const tAssign = at(createdAt, H * between(0.02, 0.1));
    const tStart = at(tAssign, H * between(0.05, 0.15));
    trail.push({ from: 'SUBMITTED', to: 'ASSIGNED', remarks: null, by: handler, at: tAssign });
    trail.push({ from: 'ASSIGNED', to: 'IN_PROGRESS', remarks: null, by: assignee, at: tStart });
    let tResolved;

    if (breached) {
      // Went past dueAt: Timer escalates (transition 12); supervisor reassigns with a fresh deadline (14).
      const tEsc = at(dueAt, 0.25);
      escalations.push({ level: 1, reason: 'Complaint overdue', at: tEsc });
      trail.push({ from: 'IN_PROGRESS', to: 'ESCALATED', remarks: 'Overdue: escalated to level 1', by: null, at: tEsc });
      const tReassign = at(tEsc, between(1, 3));
      dueAt = at(tReassign, H);
      trail.push({ from: 'ESCALATED', to: 'ASSIGNED', remarks: 'Reassigned after escalation', by: handler, at: tReassign });
      const tRestart = at(tReassign, H * between(0.05, 0.1));
      trail.push({ from: 'ASSIGNED', to: 'IN_PROGRESS', remarks: null, by: assignee, at: tRestart });
      tResolved = at(tReassign, H * between(0.4, 0.8));
    } else if (reopened) {
      // Resolved, rejected by the reporter (10), reassigned (4), resolved again.
      const tFirst = at(createdAt, H * 0.5);
      trail.push({ from: 'IN_PROGRESS', to: 'RESOLVED', remarks: 'Work completed.', by: assignee, at: tFirst });
      const tReject = at(tFirst, between(1, 6));
      feedback.push({ isFixed: false, rating: null, comment: 'Problem is still there.', at: tReject });
      trail.push({ from: 'RESOLVED', to: 'REOPENED', remarks: 'Problem is still there.', by: reporter, at: tReject });
      reopenCount = 1;
      dueAt = at(tReject, H); // dueAt restarts on reopen (kickoff decision)
      const tReassign = at(tReject, between(1, 3));
      trail.push({ from: 'REOPENED', to: 'ASSIGNED', remarks: null, by: handler, at: tReassign });
      const tRestart = at(tReassign, 1);
      trail.push({ from: 'ASSIGNED', to: 'IN_PROGRESS', remarks: null, by: assignee, at: tRestart });
      tResolved = at(tReject, H * 0.6);
    } else {
      tResolved = at(createdAt, H * between(0.4, 0.9));
    }
    trail.push({ from: 'IN_PROGRESS', to: 'RESOLVED', remarks: 'Fixed and tested.', by: assignee, at: tResolved });

    let tClosed;
    if (autoClosed) {
      tClosed = at(tResolved, 48); // transition 11: no reporter response within 48 h
      trail.push({ from: 'RESOLVED', to: 'CLOSED', remarks: 'Auto-closed after 48 hours without a response', by: null, at: tClosed });
    } else {
      tClosed = at(tResolved, between(1, 40));
      feedback.push({ isFixed: true, rating: pick(ratings), comment: 'Fixed, thanks.', at: tClosed });
      trail.push({ from: 'RESOLVED', to: 'CLOSED', remarks: 'Confirmed by reporter', by: reporter, at: tClosed });
    }
    await addComplaint(
      { ...base, status: 'CLOSED', dueAt, resolvedAt: tResolved, closedAt: tClosed, reopenCount },
      { trail, feedback, escalations },
    );
  }

  // ---- Live demo scenarios (docs/07 "Seed also contains ...") --------------------------------
  const sup = 'supervisor1';

  // (a) Overdue and still ASSIGNED: the first "Run deadline check" escalates it to level 1.
  {
    const createdAt = at(now, -30); // HIGH = 24 h, so due 6 h ago
    const id = await addComplaint(
      { category: 'Electrical', title: 'No power in Classroom 204 sockets', description: 'None of the wall sockets work, so the teaching PC cannot be used.',
        reporter: 'faculty2', location: 'CR204', priority: 'HIGH', status: 'ASSIGNED', createdAt, dueAt: at(createdAt, 24),
        assignee: 'electrician1' },
      { trail: [
        { from: null, to: 'SUBMITTED', remarks: null, by: 'faculty2', at: createdAt },
        { from: 'SUBMITTED', to: 'ASSIGNED', remarks: null, by: sup, at: at(createdAt, 1) },
      ] },
    );
    await notify('electrician1', id, `Complaint #${id} assigned to you: No power in Classroom 204 sockets`, at(createdAt, 1));
  }

  // (b) ESCALATED at level 1 whose last escalation was 25 hours ago: the check moves it to level 2.
  {
    const createdAt = at(now, -49); // HIGH = 24 h, so due 25 h ago
    const tEsc = at(now, -25);
    const id = await addComplaint(
      { category: 'Plumbing', title: 'No water supply in Hostel Block B', description: 'Taps on the second floor have been dry since yesterday.',
        reporter: 'student3', location: 'B215', priority: 'HIGH', status: 'ESCALATED', createdAt, dueAt: at(createdAt, 24),
        assignee: 'plumber1', escalationLevel: 1 },
      { trail: [
        { from: null, to: 'SUBMITTED', remarks: null, by: 'student3', at: createdAt },
        { from: 'SUBMITTED', to: 'ASSIGNED', remarks: null, by: sup, at: at(createdAt, 1) },
        { from: 'ASSIGNED', to: 'IN_PROGRESS', remarks: null, by: 'plumber1', at: at(createdAt, 3) },
        { from: 'IN_PROGRESS', to: 'ESCALATED', remarks: 'Overdue: escalated to level 1', by: null, at: tEsc },
      ],
      escalations: [{ level: 1, reason: 'Complaint overdue', at: tEsc }] },
    );
    await notify(sup, id, `Complaint #${id} overdue: No water supply in Hostel Block B`, tEsc);
  }

  // (c) RESOLVED 49 hours ago with no response: the check auto-closes it (transition 11).
  {
    const createdAt = at(now, -70);
    const tRes = at(now, -49);
    const id = await addComplaint(
      { category: 'Furniture', title: 'Study table drawer stuck', description: 'The drawer will not open or close.',
        reporter: 'student2', location: 'B110', priority: 'MEDIUM', status: 'RESOLVED', createdAt, dueAt: at(createdAt, 48),
        resolvedAt: tRes, assignee: 'carpenter1' },
      { trail: [
        { from: null, to: 'SUBMITTED', remarks: null, by: 'student2', at: createdAt },
        { from: 'SUBMITTED', to: 'ASSIGNED', remarks: null, by: sup, at: at(createdAt, 2) },
        { from: 'ASSIGNED', to: 'IN_PROGRESS', remarks: null, by: 'carpenter1', at: at(createdAt, 5) },
        { from: 'IN_PROGRESS', to: 'RESOLVED', remarks: 'Replaced the drawer rails.', by: 'carpenter1', at: tRes },
      ] },
    );
    await notify('student2', id, `Complaint #${id} was resolved. Please confirm or reject the fix.`, tRes);
  }

  // (d) A few ordinary open complaints so the supervisor list has something to sort (all due in the future).
  {
    const t = at(now, -0.5);
    const id = await addComplaint(
      { category: 'Electrical', title: 'Sparking switchboard near Computer Lab 2', description: 'Sparks and a burning smell from the switchboard by the lab door.',
        reporter: 'faculty1', location: 'LAB2', priority: 'CRITICAL', status: 'SUBMITTED', createdAt: t, dueAt: at(t, 4) },
      { trail: [{ from: null, to: 'SUBMITTED', remarks: null, by: 'faculty1', at: t }] },
    );
    await notify(sup, id, `New complaint #${id}: Sparking switchboard near Computer Lab 2`, t);
  }
  {
    const t = at(now, -2);
    const id = await addComplaint(
      { category: 'Furniture', title: 'Broken chair in Classroom 101', description: 'Back support of a chair has snapped.',
        reporter: 'faculty2', location: 'CR101', priority: 'LOW', status: 'SUBMITTED', createdAt: t, dueAt: at(t, 120) },
      { trail: [{ from: null, to: 'SUBMITTED', remarks: null, by: 'faculty2', at: t }] },
    );
    await notify(sup, id, `New complaint #${id}: Broken chair in Classroom 101`, t);
  }
  {
    const t = at(now, -3);
    const id = await addComplaint(
      { category: 'Mess and Canteen', title: 'Stale food served at lunch', description: 'Rice and dal were stale; several students felt unwell.',
        reporter: 'student2', location: 'MESS', priority: 'MEDIUM', status: 'SUBMITTED', createdAt: t, dueAt: at(t, 48) },
      { trail: [{ from: null, to: 'SUBMITTED', remarks: null, by: 'student2', at: t }] },
    );
    await notify('admin1', id, `New service complaint #${id}: Stale food served at lunch`, t);
  }
  {
    const t = at(now, -10);
    const id = await addComplaint(
      { category: 'Housekeeping', title: 'Washroom not cleaned in Hostel Block B', description: 'Second floor washroom has not been cleaned for two days.',
        reporter: 'student3', location: 'BWASH', priority: 'MEDIUM', status: 'IN_PROGRESS', createdAt: t, dueAt: at(t, 48), assignee: 'housekeeper1' },
      { trail: [
        { from: null, to: 'SUBMITTED', remarks: null, by: 'student3', at: t },
        { from: 'SUBMITTED', to: 'ASSIGNED', remarks: null, by: sup, at: at(t, 1) },
        { from: 'ASSIGNED', to: 'IN_PROGRESS', remarks: null, by: 'housekeeper1', at: at(t, 2) },
      ] },
    );
    await notify('housekeeper1', id, `Complaint #${id} assigned to you: Washroom not cleaned in Hostel Block B`, at(t, 1));
  }
  {
    const t = at(now, -5);
    const id = await addComplaint(
      { category: 'IT and AV', title: 'Projector not working in Classroom 204', description: 'Projector shows no signal on HDMI or VGA.',
        reporter: 'faculty1', location: 'CR204', priority: 'HIGH', status: 'ON_HOLD', createdAt: t, dueAt: at(t, 24), assignee: 'itsupport1' },
      { trail: [
        { from: null, to: 'SUBMITTED', remarks: null, by: 'faculty1', at: t },
        { from: 'SUBMITTED', to: 'ASSIGNED', remarks: null, by: sup, at: at(t, 0.5) },
        { from: 'ASSIGNED', to: 'IN_PROGRESS', remarks: null, by: 'itsupport1', at: at(t, 1) },
        { from: 'IN_PROGRESS', to: 'ON_HOLD', remarks: 'Waiting for a replacement lamp', by: 'itsupport1', at: at(t, 2) },
      ] },
    );
    await notify('itsupport1', id, `Complaint #${id} assigned to you: Projector not working in Classroom 204`, at(t, 0.5));
  }

  return { userIds, categoryIds, locationIds };
}
