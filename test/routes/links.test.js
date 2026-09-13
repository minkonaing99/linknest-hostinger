'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const linksPath = require.resolve('../../lib/links');
require.cache[linksPath] = {
  id: linksPath,
  filename: linksPath,
  loaded: true,
  exports: {
    readReviewQueue: async () => [{ id: 'review-1' }],
    readUsefulReviewQueue: async () => [{ id: 'useful-1' }],
    markUsefulReviewed: async id => ({ id, lastUsefulReviewedAt: '2026-06-15T00:00:00.000Z' }),
    findDuplicateCandidates: async () => [{
      id: 'existing-1', url: 'https://example.com', title: 'Example',
      similarity: 1, exact: true, archived: false,
    }],
    mergeLinkNote: async (id, note) => ({ id, notes: note }),
    readRelatedLinks: async () => [{ id: 'related-1' }],
    addRelatedLink: async (_id, relatedId) => ({ id: relatedId }),
    removeRelatedLink: async () => ({ removed: true }),
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

it('supports related-link collection and member routes', async () => {
  async function request(method, pathname, payload) {
    let status;
    let body;
    const res = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
    const req = Readable.from(payload ? [JSON.stringify(payload)] : []);
    req.method = method;
    const handled = await handle(req, res, new URL(`https://example.com${pathname}`));
    await new Promise(resolve => setImmediate(resolve));
    return { handled, status, body };
  }

  const list = await request('GET', '/api/links/current/related');
  assert.deepEqual(list, { handled: true, status: 200, body: { links: [{ id: 'related-1' }] } });
  const add = await request('POST', '/api/links/current/related', { relatedId: 'related-2' });
  assert.equal(add.status, 201);
  assert.equal(add.body.link.id, 'related-2');
  const remove = await request('DELETE', '/api/links/current/related/related-2');
  assert.deepEqual(remove, { handled: true, status: 200, body: { removed: true } });
  const v1 = await request('GET', '/api/v1/links/current/related');
  assert.equal(v1.status, 200);
});

it('GET /api/links/useful-review returns due useful links', async () => {
  let status;
  let body;
  const res = {
    writeHead(code) { status = code; },
    end(value) { body = JSON.parse(value); },
  };
  const handled = await handle(
    { method: 'GET' },
    res,
    new URL('https://example.com/api/links/useful-review')
  );
  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.deepEqual(body, { links: [{ id: 'useful-1' }] });
});

it('POST /api/links/:id/useful-review completes a useful review', async () => {
  let status;
  let body;
  const res = {
    writeHead(code) { status = code; },
    end(value) { body = JSON.parse(value); },
  };
  const req = Readable.from([]);
  req.method = 'POST';
  const handled = await handle(
    req,
    res,
    new URL('https://example.com/api/links/useful-1/useful-review')
  );
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.equal(body.entry.id, 'useful-1');
});

it('POST /api/links/:id/merge-note appends note through dedicated endpoint', async () => {
  let status;
  let body;
  const res = {
    writeHead(code) { status = code; },
    end(value) { body = JSON.parse(value); },
  };
  const req = Readable.from([JSON.stringify({ note: 'New insight' })]);
  req.method = 'POST';
  const handled = await handle(
    req,
    res,
    new URL('https://example.com/api/links/existing-1/merge-note')
  );
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.deepEqual(body.entry, { id: 'existing-1', notes: 'New insight' });
});

it('GET /api/links/duplicates returns actionable candidates', async () => {
  let status;
  let body;
  const res = {
    writeHead(code) { status = code; },
    end(value) { body = JSON.parse(value); },
  };
  const handled = await handle(
    { method: 'GET' },
    res,
    new URL('https://example.com/api/links/duplicates?url=https%3A%2F%2Fexample.com')
  );
  assert.equal(handled, true);
  assert.equal(status, 200);
  assert.equal(body.candidates[0].exact, true);
  assert.equal(body.candidates[0].archived, false);
});
