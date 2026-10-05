'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
let perform, undo;
const target = require.resolve('../lib/link-actions');
require.cache[target] = { id: target, filename: target, loaded: true, exports: {
  performLinkAction: (...args) => perform(...args), undoLinkAction: (...args) => undo(...args),
} };
const { handle } = require('../lib/routes/actions');
async function request(path, body = {}, method = 'POST') {
  let status, headers, result;
  const req = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
  req.method = method; req._auth = { user: { id: 'owner' } };
  const res = { writeHead(code, values) { status = code; headers = values; }, end(raw) { result = JSON.parse(raw); } };
  const handled = await handle(req, res, new URL(`http://localhost${path}`));
  return { status, headers, result, handled };
}
it('serves both action prefixes with actor forwarding and private responses', async () => {
  for (const prefix of ['/api', '/api/v1']) {
    perform = async (body, actor) => { assert.equal(body.kind, 'archive'); assert.equal(actor.user.id, 'owner'); return { updated: 1 }; };
    const created = await request(`${prefix}/links/actions`, { kind: 'archive' });
    assert.equal(created.status, 200); assert.equal(created.headers['Cache-Control'], 'private, no-store');
    undo = async (id, actor) => { assert.equal(id, 'action id'); assert.equal(actor.user.id, 'owner'); return { updated: 1 }; };
    assert.equal((await request(`${prefix}/actions/action%20id/undo`)).result.updated, 1);
    assert.equal((await request(`${prefix}/actions/%ZZ/undo`)).status, 400);
    for (const body of [{ previous: 'bad' }, [], null, '{', 'x'.repeat(128001)]) {
      assert.equal((await request(`${prefix}/actions/id/undo`, body)).status, 400);
    }
    for (const [code, message] of [[409, 'Conflict'], [410, 'Expired'], [500, 'SQL secret']]) {
      perform = async () => { throw Object.assign(new Error(message), { statusCode: code }); };
      const response = await request(`${prefix}/links/actions`, {});
      assert.equal(response.status, code); assert.equal(response.result.error, code === 500 ? 'Could not change this action.' : message);
    }
    assert.equal((await request(`${prefix}/links/actions`, {}, 'GET')).handled, false);
    assert.equal((await request('/other')).handled, false);
  }
});
