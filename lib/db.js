const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_USERNAME, ADMIN_PASSWORD } = require('./config');
const { makeId } = require('./utils');

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00',
});

async function query(sql, params = []) {
  const [result] = await pool.query(sql, params);
  if (Array.isArray(result)) {
    return { rows: result, rowCount: result.length };
  }
  return { rows: [], rowCount: result.affectedRows ?? 0 };
}

let started = false;

async function connectDb() {
  if (started) return;
  await Promise.all([
    pool.query('SELECT 1'),
    pool.query('SELECT 1'),
    pool.query('DELETE FROM sessions WHERE expires_at < NOW()'),
    pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()'),
  ]);
  started = true;
}

async function ensureAdminUser() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn('No usable initial admin credentials found. Set LINKNEST_ADMIN_USERNAME and LINKNEST_ADMIN_PASSWORD in .env.');
    return;
  }
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const now = new Date();
  await pool.query(
    `INSERT INTO users (id, username, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       updated_at    = VALUES(updated_at)`,
    [makeId(), ADMIN_USERNAME, passwordHash, now, now]
  );
  console.log(`Synced Link Nest admin credentials for: ${ADMIN_USERNAME}`);
}

async function closeDb() {
  await pool.end();
}

module.exports = { query, connectDb, ensureAdminUser, closeDb };
