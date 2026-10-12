// M3: login, /api/me, JWT checks and the requireRole middleware (supertest + MySQL test database).
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { Role, CAMPUS_USER_ROLES } from '../src/domain/index.js';
import { authenticate } from '../src/middleware/auth.js';
import { requireRole } from '../src/middleware/requireRole.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { resetTestDatabase, closeDb, pool } from './helpers/db.js';

const PASSWORD = 'demo123'; // seed password of every demo account

beforeAll(resetTestDatabase);
afterAll(closeDb);

const login = (email, password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });
async function tokenFor(username) {
  const res = await login(`${username}@nmims.edu`);
  return res.body.token;
}
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe('POST /api/auth/login', () => {
  test('every seeded account can log in, and the response carries the right role', async () => {
    const [users] = await pool.query('SELECT email, role FROM users');
    expect(users.length).toBe(16);
    const roles = new Set();
    for (const { email, role } of users) {
      const res = await login(email);
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ email, role });
      expect(typeof res.body.token).toBe('string');
      roles.add(res.body.user.role);
    }
    // all five roles of the system are covered
    expect([...roles].sort()).toEqual(['ADMIN', 'FACULTY', 'STAFF', 'STUDENT', 'SUPERVISOR']);
  });

  test('the response never contains the password hash', async () => {
    const res = await login('student1@nmims.edu');
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);
    expect(res.body.user).toMatchObject({ name: 'Aarav Mehta', role: 'STUDENT', hostelRoom: 'A-204' });
  });

  test('subclass details are returned (staff trade and availability)', async () => {
    const res = await login('hvac3@nmims.edu');
    expect(res.body.user).toMatchObject({ role: 'STAFF', trade: 'HVAC', isAvailable: false });
  });

  test('the token is signed with the server secret and carries the user id and role', async () => {
    const res = await login('supervisor1@nmims.edu');
    const payload = jwt.verify(res.body.token, config.jwt.secret, { algorithms: ['HS256'] });
    expect(payload).toMatchObject({ sub: String(res.body.user.userId), role: 'SUPERVISOR' });
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  test('email lookup ignores case and surrounding spaces', async () => {
    expect((await login('  STUDENT1@NMIMS.EDU ')).status).toBe(200);
  });

  test('wrong password: 401', async () => {
    const res = await login('student1@nmims.edu', 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
    expect(res.body.token).toBeUndefined();
  });

  test('unknown email: 401 with the same message (no account enumeration)', async () => {
    const res = await login('nobody@nmims.edu');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  test.each([
    ['no body', undefined],
    ['missing password', { email: 'student1@nmims.edu' }],
    ['missing email', { password: PASSWORD }],
    ['blank email', { email: '  ', password: PASSWORD }],
    ['empty password', { email: 'student1@nmims.edu', password: '' }],
    ['object instead of email (injection attempt)', { email: { $ne: null }, password: PASSWORD }],
    ['number as password', { email: 'student1@nmims.edu', password: 123 }],
  ])('%s: 400', async (_name, body) => {
    const res = await request(app).post('/api/auth/login').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  test('SQL metacharacters in the email are just a failed login', async () => {
    const res = await login("' OR '1'='1' --");
    expect(res.status).toBe(401);
  });

  test('malformed JSON: 400 with a JSON body', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid JSON/);
  });
});

describe('GET /api/me and token checks', () => {
  test('returns the logged-in user', async () => {
    const res = await request(app).get('/api/me').set(bearer(await tokenFor('faculty1')));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'faculty1@nmims.edu', role: 'FACULTY', department: 'Computer Engineering' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  test.each([
    ['no Authorization header', {}],
    ['not a Bearer scheme', { Authorization: 'Basic dXNlcjpwYXNz' }],
    ['Bearer with no token', { Authorization: 'Bearer ' }],
    ['garbage token', { Authorization: 'Bearer not.a.jwt' }],
  ])('%s: 401', async (_name, headers) => {
    const res = await request(app).get('/api/me').set(headers);
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('a token signed with a different secret: 401', async () => {
    const forged = jwt.sign({ role: 'ADMIN' }, 'some-other-secret', { subject: '1' });
    expect((await request(app).get('/api/me').set(bearer(forged))).status).toBe(401);
  });

  test('an expired token: 401', async () => {
    const expired = jwt.sign({ role: 'STUDENT' }, config.jwt.secret, { subject: '1', expiresIn: -60 });
    const res = await request(app).get('/api/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/);
  });

  test('an unsigned token ("alg: none"): 401', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '1', role: 'ADMIN' })}.`;
    expect((await request(app).get('/api/me').set(bearer(none))).status).toBe(401);
  });

  test('a token signed with the right secret but another algorithm (HS512): 401, the algorithm is pinned to HS256', async () => {
    const other = jwt.sign({ role: 'ADMIN' }, config.jwt.secret, { subject: '1', algorithm: 'HS512' });
    expect((await request(app).get('/api/me').set(bearer(other))).status).toBe(401);
  });

  test('a token whose subject is not a user id: 401', async () => {
    const odd = jwt.sign({ role: 'ADMIN' }, config.jwt.secret, { subject: 'admin' });
    expect((await request(app).get('/api/me').set(bearer(odd))).status).toBe(401);
  });

  test('a valid token for a user that was deleted: 401', async () => {
    const [res] = await pool.query("INSERT INTO users (role, name, email, password_hash) VALUES ('STUDENT', 'Temp', 'temp@nmims.edu', 'x')");
    const token = jwt.sign({ role: 'STUDENT' }, config.jwt.secret, { subject: String(res.insertId) });
    expect((await request(app).get('/api/me').set(bearer(token))).status).toBe(200);
    await pool.query('DELETE FROM users WHERE user_id = ?', [res.insertId]);
    const after = await request(app).get('/api/me').set(bearer(token));
    expect(after.status).toBe(401);
    expect(after.body.error).toMatch(/no longer exists/);
  });

  test('the role claim inside a token is ignored: the database decides', async () => {
    // A correctly signed token that CLAIMS ADMIN for student1 (user id 1).
    const [[student1]] = await pool.query("SELECT user_id FROM users WHERE email = 'student1@nmims.edu'");
    const lying = jwt.sign({ role: 'ADMIN' }, config.jwt.secret, { subject: String(student1.user_id) });
    const res = await request(app).get('/api/me').set(bearer(lying));
    expect(res.body.user.role).toBe('STUDENT');
  });
});

describe('requireRole middleware', () => {
  // A throwaway app with the real middleware, one route per role set. Production routes using
  // requireRole arrive from M4 on; this proves the rules now.
  const guarded = express();
  const ok = (req, res) => res.json({ role: req.user.role });
  guarded.get('/admin-only', requireRole(Role.ADMIN), ok);
  guarded.get('/supervisor-only', requireRole(Role.SUPERVISOR), ok);
  guarded.get('/staff-only', requireRole(Role.STAFF), ok);
  guarded.get('/campus-users', requireRole(...CAMPUS_USER_ROLES), ok);
  guarded.get('/supervisor-or-admin', requireRole(Role.SUPERVISOR, Role.ADMIN), ok);
  guarded.get('/any-logged-in', authenticate, ok);
  guarded.use(errorHandler);

  const ACCOUNTS = {
    STUDENT: 'student1', FACULTY: 'faculty1', STAFF: 'electrician1', SUPERVISOR: 'supervisor1', ADMIN: 'admin1',
  };
  const ROUTES = {
    '/admin-only': ['ADMIN'],
    '/supervisor-only': ['SUPERVISOR'],
    '/staff-only': ['STAFF'],
    '/campus-users': ['STUDENT', 'FACULTY'],
    '/supervisor-or-admin': ['SUPERVISOR', 'ADMIN'],
    '/any-logged-in': ['STUDENT', 'FACULTY', 'STAFF', 'SUPERVISOR', 'ADMIN'],
  };

  test.each(Object.entries(ROUTES))('%s allows exactly %j', async (path, allowed) => {
    for (const [role, username] of Object.entries(ACCOUNTS)) {
      const res = await request(guarded).get(path).set(bearer(await tokenFor(username)));
      if (allowed.includes(role)) {
        expect([role, res.status]).toEqual([role, 200]);
        expect(res.body.role).toBe(role);
      } else {
        expect([role, res.status]).toEqual([role, 403]);
        expect(res.body.error).toMatch(/requires the role/);
      }
    }
  });

  test('without a token it is 401 (not 403), even on role-protected routes', async () => {
    for (const path of Object.keys(ROUTES)) {
      expect([path, (await request(guarded).get(path)).status]).toEqual([path, 401]);
    }
  });

  test('403 does not run the handler', async () => {
    let ran = false;
    const probe = express();
    probe.get('/x', requireRole(Role.ADMIN), (req, res) => { ran = true; res.end(); });
    probe.use(errorHandler);
    const res = await request(probe).get('/x').set(bearer(await tokenFor('student1')));
    expect(res.status).toBe(403);
    expect(ran).toBe(false);
  });

  test('a mistyped role fails when the route is defined, not at request time', () => {
    expect(() => requireRole('Admin')).toThrow(/requireRole needs/);
    expect(() => requireRole('JANITOR')).toThrow(/requireRole needs/);
    expect(() => requireRole()).toThrow(/requireRole needs/);
  });

  test('role changes in the database apply to existing tokens immediately', async () => {
    const token = await tokenFor('carpenter1');
    expect((await request(guarded).get('/staff-only').set(bearer(token))).status).toBe(200);
    await pool.query("UPDATE users SET role = 'STUDENT' WHERE email = 'carpenter1@nmims.edu'");
    expect((await request(guarded).get('/staff-only').set(bearer(token))).status).toBe(403);
    await pool.query("UPDATE users SET role = 'STAFF' WHERE email = 'carpenter1@nmims.edu'");
  });
});

describe('API basics still work', () => {
  test('health needs no login and no database', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
  test('unknown API routes are a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No such endpoint/);
  });
});
