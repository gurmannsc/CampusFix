// Helpers for tests that use MySQL (supertest against the real app + the `campusfix_test` database).
import { config } from '../../src/config.js';
import { createConnection, pool } from '../../src/db.js';
import { applySchema } from '../../db/lib.js';
import { seedDemoData } from '../../db/seed.js';

// Drops and recreates all tables in the TEST database and loads the demo seed.
// Jest sets NODE_ENV=test, which makes config.db.database "<name>_test"; the check below makes
// sure a misconfiguration can never wipe the real demo database.
export async function resetTestDatabase() {
  if (!config.db.database.endsWith('_test')) {
    throw new Error(`Refusing to reset "${config.db.database}": it is not a test database (NODE_ENV=${process.env.NODE_ENV})`);
  }
  const conn = await createConnection({ multipleStatements: true });
  try {
    await applySchema(conn);
    await seedDemoData(conn);
  } finally {
    await conn.end();
  }
}

// Call in afterAll so Jest can exit.
export const closeDb = () => pool.end();

export { pool };
