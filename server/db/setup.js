// `npm run setup`: one command to get a fresh MySQL ready.
//  1. connects as the MySQL admin user (DB_ADMIN_USER / DB_ADMIN_PASSWORD in server/.env)
//  2. creates the application database, a separate "<name>_test" database for Jest, and the
//     application user (DB_USER / DB_PASSWORD) with rights on those two databases only
//  3. creates all tables in both databases and loads the demo seed into the main one
// Safe to re-run: it recreates every table, so it also acts as a full reset.
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { createConnection } from '../src/db.js';
import { applySchema, clearUploads, explainDbError } from './lib.js';
import { seedDemoData } from './seed.js';

const { baseName, user, password } = config.db;
const testName = `${baseName}_test`;

// Database and user names end up in DDL statements, where `?` placeholders are not allowed,
// so only plain identifiers are accepted.
for (const [label, value] of [['DB_NAME', baseName], ['DB_USER', user]]) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    console.error(`${label} may only contain letters, digits and underscore (got "${value}").`);
    process.exit(1);
  }
}
if (!password) {
  console.error('DB_PASSWORD is empty in server/.env. Set a password for the application database user.');
  process.exit(1);
}

async function main() {
  const admin = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.adminUser, password: config.db.adminPassword,
    multipleStatements: true,
  });
  try {
    for (const name of [baseName, testName]) {
      await admin.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4', [name]);
    }
    // 'localhost' and '127.0.0.1' are separate account hosts in MySQL; create both so that
    // either spelling of DB_HOST works. ALTER USER keeps the password in sync with .env.
    for (const host of ['localhost', '127.0.0.1']) {
      const account = `${admin.escape(user)}@${admin.escape(host)}`;
      await admin.query(`CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY ${admin.escape(password)}`);
      await admin.query(`ALTER USER ${account} IDENTIFIED BY ${admin.escape(password)}`);
      for (const name of [baseName, testName]) {
        await admin.query(`GRANT ALL PRIVILEGES ON ${admin.escapeId(name)}.* TO ${account}`);
      }
    }
    console.log(`Databases "${baseName}" and "${testName}" and user "${user}" are ready.`);
  } finally {
    await admin.end();
  }

  // From here on, work as the application user (this also proves the grants are correct).
  for (const [name, withSeed] of [[baseName, true], [testName, false]]) {
    const conn = await createConnection({ database: name, multipleStatements: true });
    try {
      await applySchema(conn);
      if (withSeed) {
        await seedDemoData(conn);
      }
      console.log(`Schema created in "${name}"${withSeed ? ' and demo data loaded' : ''}.`);
    } finally {
      await conn.end();
    }
  }
  await clearUploads();
  console.log('Setup complete. Demo logins: <username>@nmims.edu / demo123 (e.g. student1@nmims.edu).');
}

main().catch((err) => {
  console.error(`Setup failed: ${explainDbError(err)}`);
  process.exit(1);
});
