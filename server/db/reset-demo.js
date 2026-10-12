// `npm run reset-demo`: put the main database back to the demo state between rehearsals.
// Recreates the tables, reloads the seed (timestamps recomputed from "now", so the overdue /
// escalated / resolved-49-hours-ago scenarios are fresh) and deletes uploaded photos.
// Needs only the application user, not the MySQL admin.
import { createConnection } from '../src/db.js';
import { applySchema, clearUploads, explainDbError } from './lib.js';
import { seedDemoData } from './seed.js';

async function main() {
  const conn = await createConnection({ multipleStatements: true });
  try {
    await applySchema(conn);
    await seedDemoData(conn);
  } finally {
    await conn.end();
  }
  await clearUploads();
  console.log('Demo data reset. Logins: <username>@nmims.edu / demo123 (e.g. supervisor1@nmims.edu).');
}

main().catch((err) => {
  console.error(`Reset failed: ${explainDbError(err)}`);
  process.exit(1);
});
