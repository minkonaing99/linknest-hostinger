'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
let reader;
const target = require.resolve('../lib/link-history');
require.cache[target] = { id: target, filename: target, loaded: true,
  exports: { readLinkHistory: (...args) => reader(...args) } };
const { handle } = require('../lib/routes/history');

it('serves both history prefixes with private caching and validated query shape', async () => {
  for (const prefix of ['/api', '/api/v1']) {
    let status, headers, body;
    const res = { writeHead(code, values) { status = code; headers = values; }, end(value) { body = JSON.parse(value); } };
    reader = async (id, options) => { assert.equal(id, 'old id'); assert.deepEqual(options, { limit: '20', cursor: undefined }); return { events: [], nextCursor: null }; };
    assert.equal(await handle({ method: 'GET' }, res, new URL(`http://localhost${prefix}/links/old%20id/history`)), true);
    assert.equal(status, 200);
    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(body, { events: [], nextCursor: null });
    for (const [error, code, message] of [[new Error('SQL secret'), 500, 'Could not load link history.'],
      [Object.assign(new Error('Link not found'), { statusCode: 404 }), 404, 'Link not found']]) {
      reader = async () => { throw error; };
      await handle({ method: 'GET' }, res, new URL(`http://localhost${prefix}/links/one/history`));
      assert.equal(status, code); assert.equal(body.error, message);
    }
    await handle({ method: 'GET' }, res, new URL(`http://localhost${prefix}/links/%ZZ/history`));
    assert.equal(status, 400);
    await handle({ method: 'GET' }, res, new URL(`http://localhost${prefix}/links/one/history?limit=20&limit=30`));
    assert.equal(status, 400);
    await handle({ method: 'GET' }, res, new URL(`http://localhost${prefix}/links/one/history?unexpected=x`));
    assert.equal(status, 400);
    assert.equal(await handle({ method: 'POST' }, res, new URL(`http://localhost${prefix}/links/one/history`)), false);
    assert.equal(await handle({ method: 'GET' }, res, new URL('http://localhost/other')), false);
  }
});
