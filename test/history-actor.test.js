'use strict';
process.env.DB_USER = 'test'; process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
let calls = [];
const target = require.resolve('../lib/links');
const methods = ['createLink', 'updateLink', 'deleteLink', 'restoreLink', 'mergeLinkNote', 'markUsefulReviewed', 'bulkUpdateStatus'];
require.cache[target] = { id: target, filename: target, loaded: true, exports: Object.fromEntries(methods.map(name => [name,
  async (...args) => { calls.push({ name, args }); return name === 'createLink' ? { entry: {}, duplicateCandidates: [] } : {}; }])) };
const { handle } = require('../lib/routes/links');

it('all review mutation routes forward authenticated actors under both prefixes', async () => {
  const actor = { user: { id: 'owner' }, method: 'api_token', scope: 'write' };
  const cases = [['POST', '', 'createLink', { url: 'https://example.com' }],
    ['PUT', '/one', 'updateLink', { notes: 'changed' }], ['DELETE', '/one', 'deleteLink'],
    ['POST', '/restore/one', 'restoreLink'], ['POST', '/one/merge-note', 'mergeLinkNote', { note: 'new' }],
    ['POST', '/one/useful-review', 'markUsefulReviewed', {}],
    ['PATCH', '/bulk', 'bulkUpdateStatus', { ids: ['one'], status: 'useful' }]];
  for (const prefix of ['/api', '/api/v1']) {
    for (const [method, suffix, name, payload] of cases) {
      calls = [];
      const req = Readable.from(payload ? [JSON.stringify(payload)] : []);
      req.method = method; req._auth = actor;
      let status;
      const res = { writeHead(code) { status = code; }, end() {} };
      assert.equal(await handle(req, res, new URL(`http://localhost${prefix}/links${suffix}`)), true);
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(status < 300, `${name}: ${status}`);
      assert.equal(calls[0].name, name);
      assert.equal(calls[0].args.at(-1), actor);
    }
  }
});
