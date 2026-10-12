# Architecture (Figure 10 of the report: layered + client-server, data-centered store)

Presentation (React portals) --HTTPS/JSON REST--> Application (Express API + services) --SQL--> Data (MySQL + file storage)

## Folder layout
campusfix/
  client/   React (Vite). pages/: Login, CampusUserPortal, StaffPortal, SupervisorConsole, AdminDashboard;
            components/: ComplaintForm, ComplaintDetailsPage, StatusTimeline, NotificationBell
  server/   src/app.js, src/server.js
            src/domain/        entity classes (Complaint, Category, DeadlineRule, Escalation, ...) and complaintStateMachine.js
            src/controllers/   ComplaintController, ResolutionController, AssignmentController, AdminController
            src/services/      NotificationService, ReportService
            src/scheduler/     EscalationScheduler (node-cron)
            src/repositories/  ComplaintList and other data access (mysql2, parameterised queries only)
            src/middleware/    auth (JWT), requireRole(...roles)
            db/schema.sql, db/seed.sql (or seed.js), uploads/ (photos, git-ignored)
            tests/
  docs/ diagrams/ report/

## Allowed dependencies
server: express, mysql2, bcrypt, jsonwebtoken, multer, node-cron, dotenv, cors; dev: jest, supertest, nodemon
client: react, react-dom, react-router-dom, recharts, vite
Root: concurrently (to run both with one command). Ask before adding anything else.

## REST API
POST /api/auth/login                         -> token + user (role)
GET  /api/me
POST /api/complaints                         CampusUser, multipart (photo optional)
GET  /api/complaints                         role-filtered: reporter own; staff assigned; supervisor/admin all (filters: status, priority, category, block, from, to); default sort priority then dueAt
GET  /api/complaints/:id                     with status history, feedback, escalations
PATCH /api/complaints/:id/priority           Supervisor
GET  /api/complaints/:id/eligible-staff      Supervisor (trade match + available)
POST /api/complaints/:id/assign              Supervisor (Admin for SERVICE)
POST /api/complaints/:id/invalid             Supervisor
POST /api/complaints/:id/start | /hold | /resume | /resolve      assignee
POST /api/complaints/:id/confirm | /reject                         reporter
POST /api/complaints/:id/resolve-escalation  Supervisor {action: "reassign"|"extend", staffId | newDueAt, reason}
GET  /api/notifications ; POST /api/notifications/:id/read
GET  /api/dashboard                          Admin: avg resolution time by category, open vs closed, workload per staff, deadline breach %, avg rating; filters category, block, from, to
CRUD /api/admin/categories | locations | users | deadline-rules   Admin
POST /api/admin/run-deadline-check           Admin, DEMO ONLY: runs EscalationScheduler.checkDeadlines(now) immediately
