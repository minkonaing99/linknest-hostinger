'use strict';

process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
let source, candidates, failure;
const calls = [];
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => {
    calls.push({ sql, params });
    if (failure) throw failure;
    return { rows: sql.includes('WHERE id=?') ? (source ? [source] : []) : candidates };
  },
} };
const { readLinkSuggestions } = require('../lib/link-suggestions');
const { handle } = require('../lib/routes/suggestions');

function fixture() {
  calls.length = 0;
  failure = null;
  source = { id: 'one', title: 'Understanding JavaScript closures', url: 'https://example.com/one',
    host: 'example.com', tags: JSON.stringify(['javascript', 'study']) };
  candidates = [];
}

it('ranks shared tags, title similarity, and ID deterministically with clear match reasons', async () => {
  fixture();
  candidates = [
    { id: 'two-tags', title: 'Completely different title', tags: ['study', 'javascript'] },
    { id: 'z', title: 'Understanding JavaScript closures', tags: ['javascript'] },
    { id: 'a', title: 'Understanding JavaScript closures', tags: ['javascript'] },
    { id: 'similar', title: 'Understanding Javascript closure', tags: [] },
    { id: 'noise', title: 'A garden watering timetable', tags: [] },
  ].map(item => ({ host: 'example.com', url: `https://example.com/${item.id}`, ...item }));
  const input = JSON.stringify(candidates);
  const result = await readLinkSuggestions('one');
  assert.deepEqual(result.map(item => item.link.id), ['two-tags', 'a', 'z', 'similar']);
  assert.deepEqual(result[0].sharedTags, ['javascript', 'study']);
  assert.equal(result[0].reason, 'Shares tags: javascript, study');
  assert.equal(result[3].reason, 'Similar title');
  assert.ok(result[3].titleSimilarity >= 0.85);
  assert.equal(JSON.stringify(candidates), input);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.sql.startsWith('SELECT')));
});

it('candidate SQL excludes self, archived links, and either direction of existing relationships', async () => {
  fixture();
  await readLinkSuggestions('one');
  assert.match(calls[0].sql, /deleted_at IS NULL/);
  const query = calls[1];
  assert.match(query.sql, /l\.id<>\?/);
  assert.match(query.sql, /l\.deleted_at IS NULL/);
  assert.match(query.sql, /l\.status<>'archived'/);
  assert.match(query.sql, /NOT EXISTS/);
  assert.match(query.sql, /r\.link_id_a=\? AND r\.link_id_b=l\.id/);
  assert.match(query.sql, /r\.link_id_b=\? AND r\.link_id_a=l\.id/);
  assert.match(query.sql, /JSON_CONTAINS\(l\.tags, JSON_QUOTE\(\?\)\)/);
  assert.match(query.sql, /ORDER BY shared_count DESC, BINARY l\.id ASC LIMIT \?/);
  assert.equal(query.params.at(-1), 200);
  assert.ok(query.params.includes('javascript'));
  assert.ok(query.params.includes('example.com'));
  assert.doesNotMatch(query.sql, /Understanding JavaScript/);
});

it('caps candidates at 200 and suggestions at five, with exact case-sensitive normalized tags', async () => {
  fixture();
  source = { ...source, tags: [' javascript ', 'javascript', 'Study'] };
  candidates = Array.from({ length: 201 }, (_, i) => ({ id: String(i).padStart(3, '0'),
    title: i === 200 ? source.title : 'Unrelated', tags: i < 6 ? ['javascript'] : ['study'],
    url: 'https://example.com/a', host: 'example.com' }));
  const result = await readLinkSuggestions('one');
  assert.deepEqual(result.map(item => item.link.id), ['000', '001', '002', '003', '004']);
  assert.ok(result.every(item => item.sharedTags.length === 1));
  candidates = [{ id: 'case', title: 'Unrelated', tags: ['study'], host: 'example.com' }];
  assert.deepEqual(await readLinkSuggestions('one'), []);
});

it('host alone and empty/URL-fallback titles do not create false suggestions', async () => {
  fixture();
  for (const title of ['', 'https://example.com/one']) {
    source = { ...source, title, tags: [] };
    candidates = [{ id: 'two', title: 'https://example.com/two', tags: [], host: 'example.com', url: 'https://example.com/two' }];
    assert.deepEqual(await readLinkSuggestions('one'), []);
  }
  source = { ...source, host: '', tags: [], title: '' };
  calls.length = 0;
  assert.deepEqual(await readLinkSuggestions('one'), []);
  assert.equal(calls.length, 1);
});

it('validates IDs and handles missing/archived source and malformed legacy tags', async () => {
  fixture();
  for (const id of ['', null, [], 'x'.repeat(37)]) {
    await assert.rejects(readLinkSuggestions(id), { statusCode: 400 });
  }
  source = null;
  await assert.rejects(readLinkSuggestions('missing'), { statusCode: 404 });
  fixture();
  source.tags = 'bad JSON';
  assert.deepEqual(await readLinkSuggestions('legacy id'), []);
  fixture();
  source.tags = '{}';
  assert.deepEqual(await readLinkSuggestions('one'), []);
});

async function request(pathname, method = 'GET') {
  let status, body, headers;
  const res = { writeHead(code, value) { status = code; headers = value; }, end(value) { body = JSON.parse(value); } };
  const handled = await handle({ method }, res, new URL(`https://app.example${pathname}`));
  return { handled, status, body, headers };
}

it('serves both API prefixes privately, preserving validation errors and hiding unexpected failures', async () => {
  for (const prefix of ['/api', '/api/v1']) {
    fixture();
    const result = await request(`${prefix}/links/one/suggestions`);
    assert.equal(result.handled, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { suggestions: [] });
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.equal((await request(`${prefix}/links/%ZZ/suggestions`)).status, 400);
    assert.equal((await request(`${prefix}/links/${'x'.repeat(37)}/suggestions`)).status, 400);
    fixture();
    source = null;
    assert.equal((await request(`${prefix}/links/missing/suggestions`)).status, 404);
    fixture();
    failure = new Error('Secret SQL schema');
    const failed = await request(`${prefix}/links/one/suggestions`);
    assert.equal(failed.status, 500);
    assert.equal(failed.body.error, 'Could not load suggested connections.');
  }
  assert.equal((await request('/api/links/one/suggestions', 'POST')).handled, false);
  assert.equal((await request('/browse.html')).handled, false);
});
