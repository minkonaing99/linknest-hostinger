'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000';

const { it } = require('node:test');
const assert = require('node:assert/strict');

const linksPath = require.resolve('../../lib/links');
require.cache[linksPath] = {
  id: linksPath,
  filename: linksPath,
  loaded: true,
  exports: {
    readReviewQueue: async () => [{ id: 'review-1' }],
  },
};

const { handle } = require('../../lib/routes/links');

it('GET /api/links/review returns review links', async () => {
  let status;
  let body;
  const res = {
    writeHead(code) { status = code; },
    end(value) { body = JSON.parse(value); },
  };
  const handled = await handle(
    { method: 'GET' },
    res,
    new URL('https://example.com/api/links/review')
  );
  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.deepEqual(body, { links: [{ id: 'review-1' }] });
});
