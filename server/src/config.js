// Central place for environment configuration. Every other module imports from here
// instead of reading process.env directly, so defaults live in one file.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load server/.env regardless of the directory the process was started from
// (npm workspaces start the server with cwd = server/, but be explicit anyway).
export const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverRoot, '.env') });

const dbName = process.env.DB_NAME || 'campusfix';

export const config = {
  port: Number(process.env.PORT) || 4000,
  // Browser origin allowed to call the API (the Vite dev server).
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // How often EscalationScheduler runs checkDeadlines (docs/01: every 15 minutes, configurable).
  deadlineCheckMinutes: Number(process.env.DEADLINE_CHECK_MINUTES) || 15,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    // Tests (NODE_ENV=test) run against a separate database so they never touch demo data.
    database: process.env.NODE_ENV === 'test' ? `${dbName}_test` : dbName,
    baseName: dbName,
    user: process.env.DB_USER || 'campusfix',
    password: process.env.DB_PASSWORD || '',
    // Only `npm run setup` uses these: it creates the databases and the application user.
    adminUser: process.env.DB_ADMIN_USER || 'root',
    adminPassword: process.env.DB_ADMIN_PASSWORD || '',
  },
  uploadsDir: path.join(serverRoot, 'uploads'),
};
