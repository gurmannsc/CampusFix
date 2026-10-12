# CampusFix: project memory for Claude Code

## What this is
CampusFix is a web platform for NMIMS Indore where students and faculty report infrastructure
faults (hostel rooms, classrooms, labs, washrooms, common areas) and mess/canteen service issues.
A maintenance supervisor assigns complaints to staff, staff resolve them, the reporter confirms or
rejects the fix, overdue complaints escalate automatically, and an administrator monitors
resolution time, workload, priorities and service quality.

This is a Software Engineering course project (SVKM's NMIMS, MBA Tech CE, Sem V). The design report
is ALREADY SUBMITTED. The code is graded in a live demo (30% of marks) and examiners will compare
it against the report's UML diagrams. Faithfulness to the design matters more than extra features.

## Source of truth (read before writing code)
- docs/01-problem-and-scope.md   scope, roles, categories, priority deadlines
- docs/02-user-stories.md        11 user stories with acceptance criteria (each becomes tests)
- docs/03-domain-model.md        classes, attributes, operations, relationships, enums, DB mapping
- docs/04-state-machine.md       AUTHORITATIVE transition table for Complaint.status
- docs/05-sequences.md           the three sequence diagrams as code-level flows
- docs/06-architecture.md        layers, stack, folder layout, API endpoints
- docs/07-demo-script.md         the exact flow we will show the examiner
- docs/08-build-plan.md          milestones in order, with done-criteria
- diagrams/                      UML sources (.puml) and rendered diagrams (.svg/.png)
- report/CampusFix_SE_Project_Report.pdf   the submitted report

## Non-negotiable rules
1. Names must match the class and sequence diagrams exactly: class names, attribute names (camelCase
   in code, snake_case in SQL), operation names and enum literals. If you think a name is wrong,
   do not rename it. Write the issue in docs/DEVIATIONS.md and ask.
2. Complaint.status may only change through the transitions in docs/04-state-machine.md. Every
   illegal transition must be rejected with HTTP 409 and a clear message. Every status change writes
   one StatusUpdate row.
3. Never edit files in docs/ (except DEVIATIONS.md), diagrams/ or report/. They describe what was
   submitted. Any unavoidable difference between code and design goes in docs/DEVIATIONS.md with a
   one-line reason.
4. Build milestone by milestone (docs/08-build-plan.md). Finish, run tests, show the result, then
   move on. Do not scaffold the whole app in one go.
5. Ask before adding a dependency that is not listed in docs/06-architecture.md, and before any
   schema change not described in docs/03-domain-model.md.
6. Keep it runnable on a student laptop: one command to set up the database with seed data, one
   command to run server and client. No paid services, no external APIs.
7. Explain non-obvious code briefly in comments. The team must be able to answer examiner questions
   about any file.

## Stack (fixed by the report)
- client/: React (Vite, JavaScript), react-router-dom, recharts for the admin dashboard
- server/: Node.js 18+ with Express (JavaScript, ES modules), mysql2, bcrypt, jsonwebtoken, multer,
  node-cron, dotenv
- Database: MySQL 8
- Tests: Jest + supertest on the server

## Team (for commit authorship; the Teamwork mark checks equal participation)
- Gurmann Singh Chiraunde, Disha Singh Kushwaha, Mahima Singh. See docs/08-build-plan.md for the
  suggested split. Commits should be made under the name of whoever owns that milestone.

## Commands (fill in once scaffolded)
- setup:  (to be added in milestone M1)
- dev:    `npm run dev` from the repo root (server :4000, client :5173)
- test:   (to be added in milestone M2)
