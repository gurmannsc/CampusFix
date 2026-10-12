// MySQL access for the Data layer. Repositories import `pool`; the db/ scripts use
// `createConnection`. Always use parameterised queries (`?` placeholders), never string concat.
import mysql from 'mysql2/promise';
import { config } from './config.js';

// timezone 'Z': JS Dates are written to and read from DATETIME columns as UTC, so results
// do not depend on the server's or MySQL's local time zone. Never use NOW() in SQL.
export function connectionOptions(overrides = {}) {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    timezone: 'Z',
    charset: 'utf8mb4',
    ...overrides,
  };
}

// MySQL 8's default strict mode. Some installs (e.g. Laragon's my.ini) run non-strict, where an
// invalid ENUM value silently becomes '' instead of failing. Every connection sets this itself
// so the app behaves the same on every laptop.
const STRICT_SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

export const pool = mysql.createPool({ ...connectionOptions(), connectionLimit: 10 });
// Runs on every new pooled connection, before it is handed out for queries.
pool.pool.on('connection', (conn) => conn.query(`SET SESSION sql_mode = '${STRICT_SQL_MODE}'`));

// Runs fn(conn) in one transaction: commit if it resolves, roll back if it throws. Everything that
// changes a complaint (status, StatusUpdate rows, notifications) goes through one of these so a
// failure half-way never leaves partial data.
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function createConnection(overrides = {}) {
  const conn = await mysql.createConnection(connectionOptions(overrides));
  await conn.query(`SET SESSION sql_mode = '${STRICT_SQL_MODE}'`);
  return conn;
}
