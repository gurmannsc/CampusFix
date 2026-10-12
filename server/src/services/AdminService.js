// AdminService: what the Administrator manages (docs/01 roles table; docs/06 "CRUD /api/admin/..."):
// categories, locations, users and deadline rules. It uses only the tables of docs/03: nothing is
// added to the schema, so a user or category that is referenced by complaints cannot be deleted
// (409, with the reason) instead of being "deactivated".
//
// Rules worth knowing:
//   - Staff are matched to complaints by trade = category name, so renaming a category renames the
//     trade of its staff in the same transaction, and a category with staff or complaints cannot be
//     deleted or switched between INFRASTRUCTURE and SERVICE.
//   - A user's role cannot be changed after creation (the role decides which columns apply and which
//     complaints they may have touched). Create a new account instead.
//   - Deadline rules apply to complaints raised or re-prioritised from now on; existing dueAt values
//     are not rewritten. The escalation interval is read live by the timer.
import bcrypt from 'bcrypt';
import { pool, withTransaction } from '../db.js';
import { AreaType, CategoryType, DomainError, Priority, Role, ValidationError } from '../domain/index.js';

// ---- small validation helpers ---------------------------------------------------------------

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;

// Collects problems per field, then throws one ValidationError (400) with all of them.
class Check {
  constructor(label) { this.label = label; this.errors = {}; }

  text(obj, key, { max, required = false, label = key } = {}) {
    if (!has(obj, key) || obj[key] === null || obj[key] === '') {
      if (required) this.errors[key] = `${label} is required`;
      return null;
    }
    if (typeof obj[key] !== 'string' || obj[key].trim() === '') { this.errors[key] = `${label} must be text`; return null; }
    const value = obj[key].trim();
    if (value.length > max) { this.errors[key] = `${label} must be at most ${max} characters`; return null; }
    return value;
  }

  oneOf(obj, key, values, { required = false } = {}) {
    if (!has(obj, key)) { if (required) this.errors[key] = `${key} is required`; return undefined; }
    if (!values.includes(obj[key])) { this.errors[key] = `${key} must be one of ${values.join(', ')}`; return undefined; }
    return obj[key];
  }

  int(obj, key, { min, max, required = false }) {
    if (!has(obj, key)) { if (required) this.errors[key] = `${key} is required`; return undefined; }
    if (!Number.isInteger(obj[key]) || obj[key] < min || obj[key] > max) { this.errors[key] = `${key} must be a whole number from ${min} to ${max}`; return undefined; }
    return obj[key];
  }

  done() {
    if (Object.keys(this.errors).length) throw new ValidationError(`Invalid ${this.label}`, this.errors);
  }
}

const duplicate = (message) => (err) => {
  if (err.code === 'ER_DUP_ENTRY') throw new DomainError(message, 409);
  throw err;
};
const notFound = (what, id) => new DomainError(`${what} ${id} not found`, 404);
const count = async (db, sql, params) => Number((await db.query(sql, params))[0][0].n);

// ---- categories -----------------------------------------------------------------------------

const categoryDto = (r) => ({
  categoryId: r.category_id, name: r.name, type: r.type, defaultPriority: r.default_priority,
  complaintCount: Number(r.complaint_count ?? 0), staffCount: Number(r.staff_count ?? 0),
});
const CATEGORY_SQL = `SELECT c.*,
    (SELECT COUNT(*) FROM complaints x WHERE x.category_id = c.category_id) AS complaint_count,
    (SELECT COUNT(*) FROM users u WHERE u.role = 'STAFF' AND u.trade = c.name) AS staff_count
  FROM categories c`;

async function loadCategory(db, id, lock = false) {
  const [rows] = await db.query(`${CATEGORY_SQL} WHERE c.category_id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Category', id);
  return rows[0];
}

// ---- users ----------------------------------------------------------------------------------

const userDto = (r) => ({
  userId: r.user_id, role: r.role, name: r.name, email: r.email, phone: r.phone,
  sapId: r.sap_id, program: r.program, hostelRoom: r.hostel_room, employeeId: r.employee_id, department: r.department,
  trade: r.trade, isAvailable: r.is_available == null ? null : Boolean(r.is_available),
  complaintCount: Number(r.complaint_count ?? 0),
});
const USER_SQL = `SELECT u.user_id, u.role, u.name, u.email, u.phone, u.sap_id, u.program, u.hostel_room, u.employee_id,
    u.department, u.trade, u.is_available,
    (SELECT COUNT(*) FROM complaints c WHERE c.reporter_id = u.user_id OR c.assignee_id = u.user_id OR c.supervisor_id = u.user_id) AS complaint_count
  FROM users u`;

// Which optional columns each role has (docs/03: single-table inheritance, nullable subclass columns).
const ROLE_FIELDS = {
  STUDENT: { sapId: ['sap_id', 20], program: ['program', 80], hostelRoom: ['hostel_room', 20] },
  FACULTY: { employeeId: ['employee_id', 20], department: ['department', 80] },
  STAFF: {}, SUPERVISOR: {}, ADMIN: {},
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function infrastructureTrades(db) {
  const [rows] = await db.query("SELECT name FROM categories WHERE type = 'INFRASTRUCTURE'");
  return rows.map((r) => r.name);
}

// ---- the service ----------------------------------------------------------------------------

class AdminService {
  // ======== categories ========
  async listCategories() {
    const [rows] = await pool.query(`${CATEGORY_SQL} ORDER BY c.type, c.name`);
    return rows.map(categoryDto);
  }

  async createCategory(input = {}) {
    const check = new Check('category');
    const name = check.text(input, 'name', { max: 50, required: true });
    const type = check.oneOf(input, 'type', Object.values(CategoryType), { required: true });
    const defaultPriority = check.oneOf(input, 'defaultPriority', Object.values(Priority), { required: true });
    check.done();
    const [res] = await pool.query('INSERT INTO categories (name, type, default_priority) VALUES (?)', [[name, type, defaultPriority]])
      .catch(duplicate('A category with this name already exists'));
    return categoryDto(await loadCategory(pool, res.insertId));
  }

  async updateCategory(categoryId, patch = {}) {
    return withTransaction(async (conn) => {
      const current = await loadCategory(conn, categoryId, true);
      const check = new Check('category');
      const name = check.text(patch, 'name', { max: 50 });
      const type = check.oneOf(patch, 'type', Object.values(CategoryType));
      const defaultPriority = check.oneOf(patch, 'defaultPriority', Object.values(Priority));
      check.done();

      if (type && type !== current.type && (Number(current.complaint_count) > 0 || Number(current.staff_count) > 0)) {
        throw new DomainError('The type cannot be changed while complaints or staff use this category', 409);
      }
      await conn.query('UPDATE categories SET name = ?, type = ?, default_priority = ? WHERE category_id = ?',
        [name ?? current.name, type ?? current.type, defaultPriority ?? current.default_priority, categoryId])
        .catch(duplicate('A category with this name already exists'));
      // Staff are matched to complaints by trade = category name: keep them matched after a rename.
      if (name && name !== current.name) {
        await conn.query("UPDATE users SET trade = ? WHERE role = 'STAFF' AND trade = ?", [name, current.name]);
      }
      return categoryDto(await loadCategory(conn, categoryId));
    });
  }

  async deleteCategory(categoryId) {
    const current = await loadCategory(pool, categoryId);
    if (Number(current.complaint_count) > 0) throw new DomainError(`${current.complaint_count} complaint(s) use this category, so it cannot be deleted`, 409);
    if (Number(current.staff_count) > 0) throw new DomainError(`${current.staff_count} staff member(s) have this trade; change their trade first`, 409);
    await pool.query('DELETE FROM categories WHERE category_id = ?', [categoryId]);
  }

  // Administrator.manageCategory(category) from the class diagram: create it, or update it when it has an id.
  manageCategory(category) {
    const { categoryId, ...fields } = category;
    return categoryId ? this.updateCategory(categoryId, fields) : this.createCategory(fields);
  }

  // ======== locations ========
  async listLocations() {
    const [rows] = await pool.query(
      `SELECT l.*, (SELECT COUNT(*) FROM complaints c WHERE c.location_id = l.location_id) AS complaint_count
       FROM locations l ORDER BY l.block, l.floor, l.room`);
    return rows.map((r) => ({ locationId: r.location_id, block: r.block, floor: r.floor, room: r.room, areaType: r.area_type, complaintCount: Number(r.complaint_count) }));
  }

  async createLocation(input = {}) {
    const check = new Check('location');
    const block = check.text(input, 'block', { max: 50, required: true });
    const room = check.text(input, 'room', { max: 50, required: true });
    const floor = check.int(input, 'floor', { min: -3, max: 100, required: true });
    const areaType = check.oneOf(input, 'areaType', Object.values(AreaType), { required: true });
    check.done();
    await this.#assertLocationFree(pool, block, floor, room);
    const [res] = await pool.query('INSERT INTO locations (block, floor, room, area_type) VALUES (?)', [[block, floor, room, areaType]]);
    return (await this.listLocations()).find((l) => l.locationId === res.insertId);
  }

  async updateLocation(locationId, patch = {}) {
    return withTransaction(async (conn) => {
      const [[current]] = await conn.query('SELECT * FROM locations WHERE location_id = ? FOR UPDATE', [locationId]);
      if (!current) throw notFound('Location', locationId);
      const check = new Check('location');
      const block = check.text(patch, 'block', { max: 50 }) ?? current.block;
      const room = check.text(patch, 'room', { max: 50 }) ?? current.room;
      const floor = check.int(patch, 'floor', { min: -3, max: 100 }) ?? current.floor;
      const areaType = check.oneOf(patch, 'areaType', Object.values(AreaType)) ?? current.area_type;
      check.done();
      await this.#assertLocationFree(conn, block, floor, room, locationId);
      await conn.query('UPDATE locations SET block = ?, floor = ?, room = ?, area_type = ? WHERE location_id = ?', [block, floor, room, areaType, locationId]);
    }).then(async () => (await this.listLocations()).find((l) => l.locationId === locationId));
  }

  async deleteLocation(locationId) {
    const [[current]] = await pool.query('SELECT location_id FROM locations WHERE location_id = ?', [locationId]);
    if (!current) throw notFound('Location', locationId);
    const used = await count(pool, 'SELECT COUNT(*) n FROM complaints WHERE location_id = ?', [locationId]);
    if (used > 0) throw new DomainError(`${used} complaint(s) were reported at this location, so it cannot be deleted`, 409);
    await pool.query('DELETE FROM locations WHERE location_id = ?', [locationId]);
  }

  // The schema has no unique key on a location, so duplicates are refused here.
  async #assertLocationFree(db, block, floor, room, exceptId = 0) {
    const same = await count(db, 'SELECT COUNT(*) n FROM locations WHERE block = ? AND floor = ? AND room = ? AND location_id <> ?', [block, floor, room, exceptId]);
    if (same > 0) throw new DomainError('This location already exists', 409);
  }

  // ======== users ========
  async listUsers({ role } = {}) {
    if (role != null && !Object.values(Role).includes(role)) throw new ValidationError('Invalid filter', { role: `must be one of ${Object.values(Role).join(', ')}` });
    const [rows] = await pool.query(`${USER_SQL} ${role ? 'WHERE u.role = ?' : ''} ORDER BY FIELD(u.role, 'ADMIN', 'SUPERVISOR', 'STAFF', 'FACULTY', 'STUDENT'), u.name`, role ? [role] : []);
    return rows.map(userDto);
  }

  async createUser(input = {}) {
    const check = new Check('user');
    const role = check.oneOf(input, 'role', Object.values(Role), { required: true });
    const name = check.text(input, 'name', { max: 100, required: true });
    const email = check.text(input, 'email', { max: 150, required: true })?.toLowerCase();
    if (email && !EMAIL.test(email)) check.errors.email = 'email is not valid';
    const phone = check.text(input, 'phone', { max: 20 });
    const password = this.#password(check, input, true);
    const extra = this.#roleColumns(check, role, input);
    const trades = role === Role.STAFF ? await infrastructureTrades(pool) : [];
    if (role === Role.STAFF) this.#staffFields(check, input, extra, trades, true);
    check.done();

    const row = { role, name, email, phone, password_hash: await bcrypt.hash(password, 10), ...extra };
    const cols = Object.keys(row);
    const [res] = await pool.query('INSERT INTO users (??) VALUES (?)', [cols, cols.map((c) => row[c] ?? null)])
      .catch(duplicate('A user with this email already exists'));
    return this.#loadUser(res.insertId);
  }

  // patch: any of name, email, phone, password (reset), the role's own columns, and for staff trade / isAvailable.
  async updateUser(userId, patch = {}) {
    const [[current]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [userId]);
    if (!current) throw notFound('User', userId);
    const check = new Check('user');
    if (has(patch, 'role') && patch.role !== current.role) check.errors.role = 'The role cannot be changed; create a new account instead';
    const set = {};
    const name = check.text(patch, 'name', { max: 100 });
    if (name) set.name = name;
    const email = check.text(patch, 'email', { max: 150 })?.toLowerCase();
    if (email) { if (EMAIL.test(email)) set.email = email; else check.errors.email = 'email is not valid'; }
    if (has(patch, 'phone')) set.phone = patch.phone === null || patch.phone === '' ? null : check.text(patch, 'phone', { max: 20 });
    if (has(patch, 'password')) set.password_hash = await bcrypt.hash(this.#password(check, patch, true) ?? '', 10);
    Object.assign(set, this.#roleColumns(check, current.role, patch));
    if (current.role === Role.STAFF) this.#staffFields(check, patch, set, await infrastructureTrades(pool), false);
    check.done();

    const cols = Object.keys(set);
    if (cols.length) {
      await pool.query(`UPDATE users SET ${cols.map(() => '?? = ?').join(', ')} WHERE user_id = ?`, [...cols.flatMap((c) => [c, set[c]]), userId])
        .catch(duplicate('A user with this email already exists'));
    }
    return this.#loadUser(userId);
  }

  // actingUserId: the Administrator doing it. Nobody can delete themselves, so there is always one admin left.
  async deleteUser(userId, actingUserId) {
    return withTransaction(async (conn) => {
      const [[current]] = await conn.query('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [userId]);
      if (!current) throw notFound('User', userId);
      if (userId === actingUserId) throw new DomainError('You cannot delete your own account', 409);
      const complaints = await count(conn, 'SELECT COUNT(*) n FROM complaints WHERE reporter_id = ? OR assignee_id = ? OR supervisor_id = ?', [userId, userId, userId]);
      const history = await count(conn, 'SELECT COUNT(*) n FROM status_updates WHERE updated_by = ?', [userId]);
      if (complaints > 0 || history > 0) {
        throw new DomainError('This user appears in complaints and their history, so the account cannot be deleted. For staff, mark them as unavailable instead.', 409);
      }
      await conn.query('DELETE FROM notifications WHERE user_id = ?', [userId]); // their own inbox goes with them
      await conn.query('DELETE FROM users WHERE user_id = ?', [userId]);
    });
  }

  async #loadUser(userId) {
    const [rows] = await pool.query(`${USER_SQL} WHERE u.user_id = ?`, [userId]);
    return userDto(rows[0]);
  }

  #password(check, obj, required) {
    if (!has(obj, 'password')) { if (required) check.errors.password = 'password is required'; return undefined; }
    if (typeof obj.password !== 'string' || obj.password.length < 8 || obj.password.length > 72) {
      check.errors.password = 'password must be 8 to 72 characters'; // 72: the limit of bcrypt
      return undefined;
    }
    return obj.password;
  }

  // Columns that belong to the role (sapId for students, ...). Others in the input are ignored.
  #roleColumns(check, role, obj) {
    const out = {};
    for (const [key, [column, max]] of Object.entries(ROLE_FIELDS[role] ?? {})) {
      if (has(obj, key)) out[column] = obj[key] === null || obj[key] === '' ? null : check.text(obj, key, { max });
    }
    return out;
  }

  // Staff: trade must be the name of an INFRASTRUCTURE category (that is how complaints are matched to staff).
  #staffFields(check, obj, target, trades, creating) {
    if (has(obj, 'trade') || creating) {
      if (!trades.includes(obj.trade)) check.errors.trade = `trade must be the name of an infrastructure category (${trades.join(', ')})`;
      else target.trade = obj.trade;
    }
    if (has(obj, 'isAvailable')) {
      if (typeof obj.isAvailable !== 'boolean') check.errors.isAvailable = 'isAvailable must be true or false';
      else target.is_available = obj.isAvailable;
    } else if (creating) {
      target.is_available = true;
    }
  }

  // ======== deadline rules ========
  async listDeadlineRules() {
    const [rows] = await pool.query("SELECT * FROM deadline_rules ORDER BY FIELD(priority, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW')");
    return rows.map((r) => ({ priority: r.priority, resolutionHours: r.resolution_hours, escalationIntervalHours: r.escalation_interval_hours }));
  }

  // Administrator.configureDeadline(priority, hours): `hours` is resolutionHours; the interval is optional.
  async configureDeadline(priority, resolutionHours, escalationIntervalHours) {
    const patch = {};
    if (resolutionHours !== undefined) patch.resolutionHours = resolutionHours;
    if (escalationIntervalHours !== undefined) patch.escalationIntervalHours = escalationIntervalHours;
    return this.updateDeadlineRule(priority, patch);
  }

  async updateDeadlineRule(priority, patch = {}) {
    if (!Object.values(Priority).includes(priority)) throw new DomainError(`Unknown priority ${priority}`, 404);
    const check = new Check('deadline rule');
    const resolutionHours = check.int(patch, 'resolutionHours', { min: 1, max: 8760 });
    const escalationIntervalHours = check.int(patch, 'escalationIntervalHours', { min: 1, max: 8760 });
    if (resolutionHours === undefined && escalationIntervalHours === undefined && Object.keys(check.errors).length === 0) {
      check.errors.resolutionHours = 'give resolutionHours and/or escalationIntervalHours';
    }
    check.done();
    await pool.query('UPDATE deadline_rules SET resolution_hours = COALESCE(?, resolution_hours), escalation_interval_hours = COALESCE(?, escalation_interval_hours) WHERE priority = ?',
      [resolutionHours ?? null, escalationIntervalHours ?? null, priority]);
    return (await this.listDeadlineRules()).find((r) => r.priority === priority);
  }
}

export const adminService = new AdminService();
