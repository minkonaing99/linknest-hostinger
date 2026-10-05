'use strict';

process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { sendJson } = require('../lib/http');
let snapshots = 0, writes = 0, fail = false;
function stub(name, exports) {
  const target = require.resolve(name);
  require.cache[target] = { id: target, filename: target, loaded: true, exports };
}
stub('../lib/db', { query: async () => { writes += 1; return { rows: [], rowCount: 0 }; } });
const authenticate = req => {
  const token = req.headers.authorization;
  if (!['Bearer read-token', 'Bearer write-token'].includes(token)) return null;
  return { scope: token === 'Bearer read-token' ? 'read' : 'write', user: { id: 'owner' }, method: 'token' };
};
stub('../lib/auth', {
  getAuthenticatedUser: async req => authenticate(req),
  requireAuth: async (req, res) => {
    const auth = authenticate(req);
    if (!auth) sendJson(res, 401, { error: 'Unauthorized' });
    return auth;
  },
});
stub('../lib/offline-library', { offlineSnapshot: async userId => {
  snapshots += 1;
  if (fail) throw new Error('SQL connection password secret');
  return { schemaVersion: 1, userId, links: [], total: 0, complete: true, downloadedAt: '2026-10-05T00:00:00Z' };
} });
const { server } = require('../lib/router');

it('both snapshot prefixes enforce authentication, private output, account binding and query bounds', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const prefix of ['/api', '/api/v1']) {
    const url = `${base}${prefix}/links/offline-snapshot`;
    for (const authorization of [undefined, 'Bearer revoked-token']) {
      const before = snapshots;
      const response = await fetch(url, { headers: authorization ? { authorization } : {} });
      assert.equal(response.status, 401); assert.equal(snapshots, before);
    }
    for (const authorization of ['Bearer read-token', 'Bearer write-token']) {
      const response = await fetch(url, { headers: { authorization, 'X-LinkNest-User-ID': 'owner' } });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal((await response.json()).userId, 'owner');
    }
    const before = snapshots;
    const headers = { authorization: 'Bearer write-token', 'X-LinkNest-User-ID': 'other' };
    assert.equal((await fetch(url, { headers })).status, 409);
    const beforeWrites = writes;
    assert.equal((await fetch(`${base}${prefix}/links`, { method: 'POST', headers, body: '{}' })).status, 409);
    assert.equal(snapshots, before); assert.equal(writes, beforeWrites);
    assert.equal((await fetch(url, { headers: { ...headers, 'X-LinkNest-User-ID': '' } })).status, 409);
    const readHeaders = { authorization: 'Bearer read-token' };
    const invalid = await fetch(`${url}?limit=100`, { headers: readHeaders });
    assert.equal(invalid.status, 400); assert.equal(snapshots, before);
    fail = true;
    const failed = await fetch(url, { headers: readHeaders });
    assert.equal(failed.status, 500); assert.deepEqual(await failed.json(), { error: 'Could not download offline library.' });
    assert.equal(failed.headers.get('cache-control'), 'private, no-store');
    fail = false;
    for (const headers of [{}, readHeaders]) {
      const me = await fetch(`${base}${prefix}/me`, { headers });
      assert.equal(me.status, headers.authorization ? 200 : 401);
      assert.equal(me.headers.get('cache-control'), 'private, no-store');
    }
  }
});
