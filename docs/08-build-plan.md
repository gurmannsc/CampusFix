# Build plan (one milestone at a time; tests green before moving on)

Suggested ownership for commits (change if the team decides otherwise):
- Gurmann: M2, M5, M6 (state machine, workflow API, scheduler)
- Disha: M7, M8 (frontend portals, notifications UI)
- Mahima: M1, M4, M9 (database and seed, complaint API, admin dashboard)
- Shared: M0, M3, M10

| M | Milestone | Done when |
|---|---|---|
| M0 | Scaffold monorepo, root scripts (dev runs client and server together), .env.example, README stub | `npm run dev` starts both; health endpoint responds |
| M1 | db/schema.sql and seed (incl. demo scenarios in docs/07), `npm run setup` and `npm run reset-demo` | Fresh MySQL is created and seeded with one command |
| M2 | Domain classes + complaintStateMachine.js with unit tests for every row in docs/04 and illegal cases | All state machine tests pass |
| M3 | Auth (bcrypt, JWT) and requireRole middleware | Each role can log in; role checks tested |
| M4 | Raise, list, details, priority, eligible staff, assign, invalid (incl. photo upload, SERVICE routing) | US-01, 02, 03, 04, 05, 06, 11 tests pass |
| M5 | Staff workflow and resolution (start, hold, resume, resolve, confirm, reject, resolve-escalation) | US-07, 08 tests pass |
| M6 | EscalationScheduler with node-cron, ComplaintList.findOverdue, auto-close, demo trigger endpoint | US-09 tests pass, including level 2 |
| M7 | NotificationService and notification endpoints | Notifications created at every point listed in docs/04 |
| M8 | React portals: Login, CampusUserPortal (ComplaintForm, ComplaintDetailsPage, StatusTimeline), StaffPortal, SupervisorConsole | Demo steps 1 to 6 work in the browser |
| M9 | AdminDashboard with ReportService metrics and filters | Demo step 7 works |
| M10 | README with setup steps, reset-demo, full demo rehearsal, DEVIATIONS.md reviewed | Whole demo script runs start to finish on a clean machine |
