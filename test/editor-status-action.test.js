'use strict';
process.env.DB_USER = 'test'; process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
let seen;
const linksPath = require.resolve('../lib/links');
require.cache[linksPath] = { id: linksPath, filename: linksPath, loaded: true, exports: {
  updateLink: async () => { seen = 'ordinary'; return { id: 'one' }; },
} };
const actionPath = require.resolve('../lib/link-actions');
require.cache[actionPath] = { id: actionPath, filename: actionPath, loaded: true, exports: {
  performEditorStatusUpdate: async (...args) => { seen = args; return { entry: { id: 'one' }, action: { id: 'action' } }; },
} };
const { handle } = require('../lib/routes/links');

it('editor status and compound details use one atomic action while ordinary edits remain compatible', async () => {
  for (const prefix of ['/api', '/api/v1']) {
    for (const payload of [{ status: 'useful', notes: 'takeaway', title: 'Changed title' }, { notes: 'note only' }]) {
      const req = Readable.from([JSON.stringify(payload)]); req.method = 'PUT'; req._auth = { user: { id: 'owner' } };
      let status, body;
      const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
      assert.equal(await handle(req, res, new URL(`http://localhost${prefix}/links/one`)), true);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(status, 200);
      if (payload.status) {
        assert.deepEqual(seen, ['one', payload, req._auth]);
        assert.equal(body.action.id, 'action');
      } else { assert.equal(seen, 'ordinary'); assert.equal(body.action, undefined); }
    }
  }
});
