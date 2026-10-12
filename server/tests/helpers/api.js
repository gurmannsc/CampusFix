// Helpers for API tests: logged-in agents, lookups into the seeded test database, sample files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { app } from '../../src/app.js';
import { config } from '../../src/config.js';
import { pool } from './db.js';

// ---- sample files ----
// A real 1x1 PNG, and bytes that start like a JPEG (the server checks the file signature).
export const PNG = { name: 'fan.png', type: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') };
export const JPEG = { name: 'fan.jpg', type: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(40, 1)]) };

// ---- logged-in agents ----
const tokens = new Map();
// as('student1') -> { userId, get/post/patch(url) that already carry the user's token }
export async function as(username) {
  if (!tokens.has(username)) {
    const res = await request(app).post('/api/auth/login').send({ email: `${username}@nmims.edu`, password: 'demo123' });
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status}`);
    tokens.set(username, { token: res.body.token, userId: res.body.user.userId });
  }
  const { token, userId } = tokens.get(username);
  const auth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    username, userId, token,
    get: (url) => auth(request(app).get(url)),
    post: (url) => auth(request(app).post(url)),
    patch: (url) => auth(request(app).patch(url)),
  };
}
export const anonymous = { get: (url) => request(app).get(url), post: (url) => request(app).post(url) };

// POST /api/complaints as multipart (fields + optional file), the way the ComplaintForm sends it.
export function raiseMultipart(agent, fields, file) {
  let req = agent.post('/api/complaints');
  for (const [key, value] of Object.entries(fields)) req = req.field(key, String(value));
  if (file) req = req.attach('photo', file.buffer, { filename: file.name, contentType: file.type });
  return req;
}

// ---- lookups in the seeded test database ----
export async function categoryId(name) {
  const [[row]] = await pool.query('SELECT category_id FROM categories WHERE name = ?', [name]);
  return row.category_id;
}
export async function locationId(block, room) {
  const [[row]] = await pool.query('SELECT location_id FROM locations WHERE block = ? AND room = ?', [block, room]);
  return row.location_id;
}
export async function complaintIdByTitle(title) {
  const [[row]] = await pool.query('SELECT complaint_id FROM complaints WHERE title = ?', [title]);
  return row.complaint_id;
}
export async function rows(sql, params = []) {
  return (await pool.query(sql, params))[0];
}
export const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;

// Photos go to a temporary folder during tests instead of server/uploads.
export function useTempUploads() {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusfix-uploads-'));
    config.uploadsDir = dir;
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { files: () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []), dir: () => dir };
}

export async function userIdOf(username) {
  return (await rows('SELECT user_id FROM users WHERE email = ?', [`${username}@nmims.edu`]))[0].user_id;
}

// Adds a user cloned from an existing demo account's password (login: <username>@nmims.edu / demo123).
export async function addUser(username, role, fields = {}) {
  const [{ h }] = await rows("SELECT password_hash h FROM users WHERE email = 'admin1@nmims.edu'");
  const cols = ['role', 'name', 'email', 'password_hash', ...Object.keys(fields)];
  await pool.query('INSERT INTO users (??) VALUES (?)', [cols, [role, username, `${username}@nmims.edu`, h, ...Object.values(fields)]]);
  return userIdOf(username);
}

export const STAGES = ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED'];

// Creates a complaint through the real API and moves it to `stage`:
//   SUBMITTED -> ASSIGNED (supervisor1 assigns `staff`) -> IN_PROGRESS -> ON_HOLD, or IN_PROGRESS -> RESOLVED.
// Returns the complaint id. SERVICE categories are taken by admin1 instead of staff.
export async function newComplaint({ reporter = 'student1', category = 'HVAC', staff = 'hvac1', stage = 'SUBMITTED', title = 'Test complaint' } = {}) {
  const service = category === 'Mess and Canteen';
  const loc = service ? await locationId('Hostel Mess', 'Dining Hall') : await locationId('Hostel Block A', '204');
  const raised = await (await as(reporter)).post('/api/complaints').send({
    categoryId: await categoryId(category), locationId: loc, title, description: `${title} (test)`,
  });
  if (raised.status !== 201) throw new Error(`could not raise complaint: ${raised.status} ${JSON.stringify(raised.body)}`);
  const id = raised.body.complaintId;
  const step = async (user, path, body = {}) => {
    const res = await (await as(user)).post(`/api/complaints/${id}/${path}`).send(body);
    if (res.status !== 200) throw new Error(`${user} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  };
  const worker = service ? 'admin1' : staff;
  const upTo = STAGES.indexOf(stage);
  if (upTo >= 1) await step(service ? 'admin1' : 'supervisor1', 'assign', service ? {} : { staffId: await userIdOf(staff) });
  if (upTo >= 2) await step(worker, 'start');
  if (stage === 'ON_HOLD') await step(worker, 'hold', { reason: 'waiting for parts' });
  if (stage === 'RESOLVED') await step(worker, 'resolve', { remarks: 'Fixed and tested' });
  return id;
}

export const statusOf = async (id) => (await rows('SELECT status FROM complaints WHERE complaint_id = ?', [id]))[0].status;
export const historyOf = async (id) => (await rows(
  'SELECT from_status, to_status FROM status_updates WHERE complaint_id = ? ORDER BY updated_at, update_id', [id])).map((r) => `${r.from_status}>${r.to_status}`);
export const notificationsOf = (id) => rows(
  'SELECT u.email, n.message FROM notifications n JOIN users u ON u.user_id = n.user_id WHERE n.complaint_id = ? ORDER BY n.notification_id', [id]);
