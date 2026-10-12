# CampusFix

Campus fault reporting for NMIMS Indore. Students and faculty report infrastructure faults and mess
or canteen problems; a supervisor assigns them to maintenance staff; the reporter confirms or
rejects the fix; overdue complaints escalate automatically; the administrator watches resolution
time, workload, deadline breaches and ratings.

This is the code for the Software Engineering project (SVKM's NMIMS, MBA Tech CE, Sem V). The design
is in `docs/` and `diagrams/` and the submitted report is in `report/`. Where the code differs from
the design, `docs/DEVIATIONS.md` says where and why.

## What you need

- **Node.js 18 or newer** (developed and tested on Node 22) and npm
- **MySQL 8** running on the same machine (port 3306 by default)
- git

Installing MySQL: on Windows use the MySQL Installer or Laragon, on macOS `brew install mysql && brew services start mysql`,
on Ubuntu `sudo apt install mysql-server`. You need one MySQL account that may create databases and
users (usually `root`); the setup command below uses it once.

## Set up (once)

```bash
npm install
```

Then create your settings file. On macOS/Linux/Git Bash:

```bash
cp server/.env.example server/.env
```

On Windows (cmd or PowerShell): `copy server\.env.example server\.env`

Open `server/.env` and fill in:

| Setting | What to put |
|---|---|
| `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD` | A MySQL account that can create databases and users, usually `root` and its password. Used only by `npm run setup`. |
| `DB_USER`, `DB_PASSWORD` | The account the app will use. `setup` creates it for you; pick any password. |
| `JWT_SECRET` | Any long random string. The server will not start without it. |
| `DEADLINE_CHECK_MINUTES` | How often the timer escalates overdue complaints (default 15). `0` switches the timer off. |
| `DB_NAME`, `DB_HOST`, `DB_PORT`, `PORT`, `CLIENT_ORIGIN` | Normally leave as they are. |

Then create the database, the tables and the demo data with one command:

```bash
npm run setup
```

It creates the `campusfix` database (and an empty `campusfix_test` database used by the tests), the
application user, all tables and the demo data. It can be run again at any time; it starts from scratch.

## Run

```bash
npm run dev
```

This starts the API on http://localhost:4000 and the web app on **http://localhost:5173**. Log in there.

## Demo accounts

Everyone has the password `demo123`. The login name is the e-mail address `<name>@nmims.edu`.

| Account | Role |
|---|---|
| `student1` (hostel room A-204), `student2`, `student3` | Student |
| `faculty1`, `faculty2` | Faculty |
| `hvac1`, `hvac2`, `hvac3` (marked unavailable), `electrician1`, `plumber1`, `carpenter1`, `itsupport1`, `civil1`, `housekeeper1` | Maintenance staff (the trade is the complaint category they can handle) |
| `supervisor1` | Supervisor |
| `admin1` | Administrator |

The login page has buttons for the accounts used in the demo.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Server and client together |
| `npm run setup` | Creates the databases, user, tables and demo data (needs the MySQL admin account in `.env`) |
| `npm run reset-demo` | Puts the demo data back as it was, with fresh timestamps, and deletes uploaded photos. Needs only the app account |
| `npm test` | Runs all tests (about 600) against the separate `campusfix_test` database; your demo data is never touched |
| `npm start -w server` | Runs just the API without auto-restart |

## Running the demo (docs/07-demo-script.md)

Before the demo:

1. Set `DEADLINE_CHECK_MINUTES=0` in `server/.env`. Otherwise the timer may escalate the overdue complaint
   a few minutes before you show it.
2. Run `npm run reset-demo`, then `npm run dev`.

The seed is built so that docs/07 works as written. Where to click:

| Step | Log in as | Where |
|---|---|---|
| 1. Raise "Ceiling fan not working" (HVAC, Hostel Block A, floor 2, room 204, with a photo) | `student1` | Report a fault |
| 2. List sorted by priority and due date; raise to High; eligible staff; assign | `supervisor1` | Complaints, open the new complaint |
| 3. Start work, put on hold ("waiting for capacitor"), resume, mark resolved | `hvac1` | My assignments |
| 4. Reject with a reason; supervisor reassigns; staff resolves again; confirm with rating 4 | `student1`, `supervisor1` (the bell shows the notification), `hvac2` | Complaint page |
| 5. Run deadline check: one complaint escalates, one reaches level 2, one auto-closes | `admin1` | Administration, Deadline check |
| 6. Report "Food quality in mess" (a service complaint goes to the administrator) | `faculty1`, then `admin1` | Report a fault; Service complaints |
| 7. Dashboard with filters | `admin1` | Administration, Dashboard |
| 8. State machine next to the state diagram, and a rejected illegal move | any | `server/src/domain/complaintStateMachine.js`; try rejecting a closed complaint (HTTP 409) |

Between rehearsals run `npm run reset-demo` again. The same script runs as an automated test in
`server/tests/demoScript.test.js`.

## How the code maps to the design

| Design | Code |
|---|---|
| Class diagram (Figure 5) | `server/src/domain/`: one file per class (`Complaint.js`, `Student.js`, ...) with the same names, attributes and operations |
| State diagram (Figure 9, `docs/04`) | `server/src/domain/complaintStateMachine.js`: one entry per row of the table; every route and the timer go through it |
| Raise Complaint sequence | `ComplaintForm` (client) → `ComplaintController.raiseComplaint` → `Complaint.create` → `NotificationService` |
| Confirm Resolution sequence | `ComplaintDetailsPage.respond` → `ResolutionController.submitResponse` → `Complaint.confirm` / `Complaint.reopen` |
| Escalate Overdue Complaint sequence | `EscalationScheduler.checkDeadlines` → `ComplaintList.findOverdue` → `Complaint.escalate` → `Escalation.notifyResponsible` |
| Architecture (Figure 10) | `client/` (presentation) → `server/src/controllers`, `services`, `scheduler` (application) → `repositories`, MySQL, `server/uploads` (data) |

```
client/    React (Vite): pages/ (Login, CampusUserPortal, StaffPortal, SupervisorConsole, AdminDashboard), components/
server/    src/domain  controllers  services  scheduler  repositories  middleware   db/ (schema, seed, setup)   tests/
docs/ diagrams/ report/    the submitted design (do not edit; differences go in docs/DEVIATIONS.md)
```

## Tests

`npm test` runs the unit tests (state machine, domain classes, metric formulas) and API tests that use a real
MySQL database (login and roles, every endpoint, notifications, the timer, the dashboard, administrator management,
and the whole demo script). `docs/04`'s transition table has one test per row plus a test that every move
outside the table is refused with HTTP 409.

## If something goes wrong

| Problem | Fix |
|---|---|
| `npm run setup`: "MySQL refused the login" | Check `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` in `server/.env` |
| `Cannot reach MySQL` | Start the MySQL service; check `DB_HOST` / `DB_PORT` |
| "JWT_SECRET is not set" | Add it to `server/.env` |
| Port 4000 or 5173 already in use | Stop the other program (an old `npm run dev` window?) or change `PORT` |
| The demo looks different from the script | `npm run reset-demo` (the seed is relative to the current time) |
| The overdue complaint was already escalated | The timer ran. Set `DEADLINE_CHECK_MINUTES=0`, restart, `npm run reset-demo` |
