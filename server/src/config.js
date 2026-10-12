// Central place for environment configuration. Every other module imports from here
// instead of reading process.env directly, so defaults live in one file.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load server/.env regardless of the directory the process was started from
// (npm workspaces start the server with cwd = server/, but be explicit anyway).
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(serverRoot, '.env') });

export const config = {
  port: Number(process.env.PORT) || 4000,
  // Browser origin allowed to call the API (the Vite dev server).
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // How often EscalationScheduler runs checkDeadlines (docs/01: every 15 minutes, configurable).
  deadlineCheckMinutes: Number(process.env.DEADLINE_CHECK_MINUTES) || 15,
};
