const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_USER = 'test'; process.env.DB_NAME = 'test';
process.env.LINKNEST_ADMIN_USERNAME = 'test-admin';
process.env.LINKNEST_ADMIN_PASSWORD = 'test-admin-password';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
let calls = [], failure = null, rollbackFailure = false, beginFailure = false;
const connection = {
  beginTransaction: async () => { calls.push('begin'); if (beginFailure) throw new Error('begin failed'); },
  query: async sql => { calls.push(sql.startsWith('SET TRANSACTION') ? sql : 'query'); return [[{ id: 'one' }]]; },
  commit: async () => { calls.push('commit'); if (failure) throw failure; },
  rollback: async () => { calls.push('rollback'); if (rollbackFailure) throw new Error('rollback failed'); },
  destroy: () => { calls.push('destroy'); },
  release: () => { calls.push('release'); },
};
let poolCalls = [], poolResult = [], poolFailure = null, closed = false, hashCalls = [];
const pool = {
  getConnection: async () => connection,
  query: async (sql, params) => {
    poolCalls.push({ sql, params });
    if (poolFailure) throw poolFailure;
    return [poolResult];
  },
  end: async () => { closed = true; },
};
const bcryptPath = require.resolve('bcryptjs');
require.cache[bcryptPath] = { id: bcryptPath, filename: bcryptPath, loaded: true,
  exports: { hash: async (...args) => { hashCalls.push(args); return 'hashed-test-password'; } } };
const mysqlPath = require.resolve('mysql2/promise');
require.cache[mysqlPath] = { id: mysqlPath, filename: mysqlPath, loaded: true,
  exports: { createPool: () => pool } };
const { withTransaction, query, connectDb, ensureAdminUser, closeDb } = require('../lib/db');
test('transaction scopes query to one connection and commits before release', async () => {
  calls = []; failure = null;
  const result = await withTransaction(async query => query('SELECT id FROM links'));
  assert.deepEqual(result, { rows: [{ id: 'one' }], rowCount: 1 });
  assert.deepEqual(calls, ['begin', 'query', 'commit', 'release']);
});
test('work and commit failures roll back and always release', async () => {
  for (const duringCommit of [false, true]) {
    calls = []; const error = new Error('failed'); failure = duringCommit ? error : null;
    await assert.rejects(() => withTransaction(async () => { if (!duringCommit) throw error; }), error);
    assert.deepEqual(calls, duringCommit ? ['begin', 'commit', 'rollback', 'release'] : ['begin', 'rollback', 'release']);
  }
});

test('rollback failures destroy broken connection; begin failure still releases', async () => {
  calls = []; failure = null; rollbackFailure = true;
  await assert.rejects(() => withTransaction(async () => { throw new Error('original'); }), /original/);
  assert.deepEqual(calls, ['begin', 'rollback', 'destroy', 'release']);
  calls = []; rollbackFailure = false; beginFailure = true;
  await assert.rejects(() => withTransaction(async () => {}), /begin failed/);
  assert.deepEqual(calls, ['begin', 'rollback', 'release']);
  beginFailure = false;
});

test('backup snapshot sets next transaction isolation on its own connection before begin', async () => {
  calls = []; failure = null;
  await withTransaction(async query => query('SELECT id FROM links'), { consistentRead: true });
  assert.deepEqual(calls, ['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'begin', 'query', 'commit', 'release']);
});

test('pool query binds parameters and normalizes row and write results', async () => {
  poolCalls = []; poolResult = [{ id: 'one' }];
  assert.deepEqual(await query('SELECT id FROM links WHERE id=?', ['one']), { rows: [{ id: 'one' }], rowCount: 1 });
  assert.deepEqual(poolCalls[0], { sql: 'SELECT id FROM links WHERE id=?', params: ['one'] });
  poolResult = { affectedRows: 3 };
  assert.deepEqual(await query('UPDATE links SET pinned=0'), { rows: [], rowCount: 3 });
  poolResult = {};
  assert.deepEqual(await query('CREATE TABLE example (id INT)'), { rows: [], rowCount: 0 });
});
test('startup retries failure, cleans expired credentials, then skips repeated startup', async () => {
  poolCalls = []; poolFailure = new Error('database unavailable');
  await assert.rejects(connectDb, /database unavailable/);
  poolFailure = null; poolCalls = [];
  await connectDb();
  assert.deepEqual(poolCalls.map(call => call.sql), ['SELECT 1', 'SELECT 1',
    'DELETE FROM sessions WHERE expires_at < NOW()', 'DELETE FROM refresh_tokens WHERE expires_at < NOW()']);
  await connectDb(); assert.equal(poolCalls.length, 4);
});
test('initial admin hashes password at configured cost and binds upsert values', async () => {
  poolCalls = []; hashCalls = [];
  const originalLog = console.log; console.log = () => {};
  try { await ensureAdminUser(); } finally { console.log = originalLog; }
  assert.deepEqual(hashCalls, [['test-admin-password', 12]]);
  assert.equal(poolCalls.length, 1);
  assert.match(poolCalls[0].sql, /ON DUPLICATE KEY UPDATE/);
  const [id, username, passwordHash, createdAt, updatedAt] = poolCalls[0].params;
  assert.match(id, /^[0-9a-f-]{36}$/); assert.equal(username, 'test-admin');
  assert.equal(passwordHash, 'hashed-test-password'); assert.equal(createdAt, updatedAt);
  assert.ok(createdAt instanceof Date);
  assert.doesNotMatch(poolCalls[0].sql, /test-admin-password/);
});
test('shutdown closes pool', async () => {
  closed = false; await closeDb(); assert.equal(closed, true);
});
