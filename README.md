# CampusFix (code for the SE project demo)

Campus complaint management for NMIMS Indore. Design documents are in `docs/` and `diagrams/`.

Prerequisites: Node.js 18 or newer, MySQL 8, git.

## Run (development)

```bash
npm install                      # once, installs server and client (npm workspaces)
cp server/.env.example server/.env   # then edit values (Windows: copy)
npm run dev                      # server on :4000, client on :5173
```

Check it works: open http://localhost:5173 (shows "API status: ok") or
http://localhost:4000/api/health.

Database setup (`npm run setup`, `npm run reset-demo`) is added in milestone M1.
