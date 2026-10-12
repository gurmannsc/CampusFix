// Helpers shared by setup.js and reset-demo.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const dbDir = path.dirname(fileURLToPath(import.meta.url));

// Runs db/schema.sql on an open connection (created with multipleStatements: true).
export async function applySchema(conn) {
  const sql = await fs.readFile(path.join(dbDir, 'schema.sql'), 'utf8');
  await conn.query(sql);
}

// Photos uploaded during a demo rehearsal are removed on reset (the rows pointing to them are gone).
export async function clearUploads() {
  await fs.mkdir(config.uploadsDir, { recursive: true });
  for (const name of await fs.readdir(config.uploadsDir)) {
    await fs.rm(path.join(config.uploadsDir, name), { recursive: true, force: true });
  }
}

// Turns raw MySQL errors into one-line hints a student can act on.
export function explainDbError(err) {
  if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    return 'MySQL refused the login. Check DB_ADMIN_USER / DB_ADMIN_PASSWORD (setup) or DB_USER / DB_PASSWORD (reset-demo) in server/.env.';
  }
  if (err.code === 'ECONNREFUSED') {
    return `Cannot reach MySQL at ${config.db.host}:${config.db.port}. Start the MySQL service and check DB_HOST / DB_PORT in server/.env.`;
  }
  if (err.code === 'ER_BAD_DB_ERROR') {
    return 'The database does not exist yet. Run `npm run setup` first.';
  }
  return err.message;
}
