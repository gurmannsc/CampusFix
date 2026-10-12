# CampusFix (code for the SE project demo)

Campus complaint management for NMIMS Indore. Design documents are in `docs/` and `diagrams/`.

Prerequisites: Node.js 18 or newer, MySQL 8 (running), git.

## Setup (once)

```bash
npm install
cp server/.env.example server/.env     # Windows: copy server\.env.example server\.env
```

Edit `server/.env`:
- `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD`: a MySQL account that may create databases and users
  (usually `root`). Only `npm run setup` uses it.
- `DB_USER` / `DB_PASSWORD`: the account the app will use. `setup` creates it for you.
- `JWT_SECRET`: any long random string.

Then create and seed the database with one command:

```bash
npm run setup
```

This creates the `campusfix` database (and an empty `campusfix_test` database for the tests),
the application user, all tables, and the demo data. It is safe to re-run.

## Run

```bash
npm run dev          # server on :4000, client on :5173
```

Check it works: open http://localhost:5173 (shows "API status: ok") or
http://localhost:4000/api/health.

## Demo data

```bash
npm run reset-demo   # back to the demo state, with fresh "overdue / escalated / 49 h" timestamps
```

Log in with `<username>@nmims.edu` and password `demo123`. Usernames: `student1`, `student2`,
`student3`, `faculty1`, `faculty2`, `supervisor1`, `admin1`, and staff `electrician1`,
`plumber1`, `carpenter1`, `hvac1`, `hvac2`, `hvac3` (marked unavailable), `itsupport1`, `civil1`,
`housekeeper1`.

## Deadline timer and the demo button

The server checks deadlines every `DEADLINE_CHECK_MINUTES` minutes (default 15): overdue complaints are
escalated, escalations repeat every 24 hours (the Administrator is told from level 2), and resolved
complaints nobody answered for 48 hours are closed.

For the live demo set `DEADLINE_CHECK_MINUTES=0` in `server/.env` (timer off), run `npm run reset-demo`,
and use the admin1 button "Run deadline check" (`POST /api/admin/run-deadline-check`) so the escalation
happens in front of the examiner instead of at the next timer tick.

## Tests

```bash
npm test      # needs the database from `npm run setup`; uses the separate campusfix_test database
```
