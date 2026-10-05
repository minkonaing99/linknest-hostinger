'use strict';

process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { sendJson } = require('../lib/http');
let queries = 0;
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async sql => {
    queries += 1;
    return sql.startsWith('SELECT') ? { rows: [{ id: 'one', url: 'https://example.com/article', reading_position: null }] }
      : { rowCount: 1, rows: [] };
  },
} };
const authPath = require.resolve('../lib/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth: async (req, res) => {
    const token = req.headers.authorization;
    if (!['Bearer read-token', 'Bearer write-token'].includes(token)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return null;
    }
    return { scope: token === 'Bearer read-token' ? 'read' : 'write', user: { id: 'user' } };
  },
} };
const { server } = require('../lib/router');

it('router enforces authentication and read-token scopes for both reading API prefixes', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const prefix of ['/api', '/api/v1']) {
    const target = `${base}${prefix}/links/one/reading-position`;
    const payload = { url: 'https://example.com/article', ratio: 0.5, offset: 0, anchor: '', scrollHeight: 2000 };
    const options = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    for (const authorization of [undefined, 'Bearer revoked-token', 'Bearer read-token']) {
      const before = queries;
      const response = await fetch(target, { ...options, headers: { ...options.headers, ...(authorization ? { authorization } : {}) } });
      assert.equal(response.status, authorization === 'Bearer read-token' ? 403 : 401);
      assert.equal(queries, before);
    }
    const get = await fetch(`${target}?url=${encodeURIComponent(payload.url)}`, { headers: { authorization: 'Bearer read-token' } });
    assert.equal(get.status, 200);
    assert.equal((await get.json()).position, null);
    const put = await fetch(target, { ...options, headers: { ...options.headers, authorization: 'Bearer write-token' } });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).position.ratio, 0.5);
  }
});
