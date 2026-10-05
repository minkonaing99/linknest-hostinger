'use strict';

process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';

const { it } = require('node:test');
const assert = require('node:assert/strict');
let calls = [], filteredTotal = 80, filteredLinks = null;
const links = Array.from({ length: 80 }, (_, index) => ({
  id: index === 5 ? 'comma,id' : `link-${index}`, title: `Article ${index}`, url: `https://example.com/${index}`,
  status: index === 1 ? 'archived' : 'saved', tags: ['study'], notes: 'Takeaway',
  saveReason: 'For my exam', date: '2026-10-05',
}));

const linksPath = require.resolve('../lib/links');
require.cache[linksPath] = {
  id: linksPath, filename: linksPath, loaded: true,
  exports: {
    readAllLinksForExport: async () => links,
    readLinks: async options => {
      calls.push(options);
      const selected = Array.isArray(options.params[0]);
      const rows = selected ? links.filter(link => options.params[0].includes(link.id)).reverse() : (filteredLinks || links);
      return { links: rows.slice(options.skip, options.skip + options.limit), total: selected ? rows.length : filteredTotal };
    },
  },
};
const { handle, toMarkdown } = require('../lib/routes/import');

async function request(query = '', prefix = '/api') {
  let status, headers, body;
  const res = { writeHead(code, values) { status = code; headers = values; }, end(value) { body = value; } };
  await handle({ method: 'GET' }, res, new URL(`https://example.com${prefix}/links/export.md${query}`));
  await new Promise(resolve => setImmediate(resolve));
  return { status, headers, body };
}

it('exports exactly selected IDs in requested order, including deliberate archived selections', async () => {
  calls = [];
  for (const prefix of ['/api', '/api/v1']) {
    const response = await request('?scope=selected&ids=link-2,link-1', prefix);
    assert.equal(response.status, 200);
    assert.equal(response.headers['X-Link-Count'], '2');
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.match(response.headers['Content-Disposition'], /links-selected\.md/);
    assert.ok(response.body.indexOf('## Article 2') < response.body.indexOf('## Article 1'));
    assert.equal((response.body.match(/^## Article /gm) || []).length, 2);
    assert.match(response.body, /- Status: archived/);
  }
  assert.deepEqual(calls[0].params, [['link-2', 'link-1']]);
  assert.equal(calls[0].whereClause, 'id IN (?)');
});

it('exports all matching pages with the same validated filters and ordering', async () => {
  calls = [];
  filteredTotal = 80;
  const response = await request('?scope=filtered&q=exam&tag=study&status=saved&sort=title&order=asc&youtube=exclude');
  assert.equal(response.status, 200);
  assert.equal(response.headers['X-Link-Count'], '80');
  assert.equal((response.body.match(/^## Article /gm) || []).length, 80);
  assert.equal(calls[0].skip, 0);
  assert.equal(calls[0].limit, 5001);
  assert.match(calls[0].whereClause, /save_reason LIKE \?/);
  assert.match(calls[0].whereClause, /JSON_CONTAINS/);
  assert.match(calls[0].orderClause, /title ASC/);
  assert.ok(calls[0].params.includes('%exam%'));
  assert.ok(calls[0].params.includes('study'));
});

it('preserves date, age, never-opened, and YouTube filters for current-view exports', async () => {
  calls = [];
  filteredTotal = 80;
  const response = await request('?scope=filtered&ageBefore=2026-07-01T00:00:00Z&neverOpened=true&youtube=only&sort=createdAt&order=asc');
  assert.equal(response.status, 200);
  assert.match(calls[0].whereClause, /created_at <= \?/);
  assert.match(calls[0].whereClause, /opened_count = 0/);
  assert.match(calls[0].whereClause, /host IN/);
  assert.match(calls[0].orderClause, /^created_at ASC/);
  assert.equal((await request('?scope=filtered&remindBefore=2026-10-05T00:00:00Z')).status, 200);
  assert.match(calls.at(-1).whereClause, /remind_at IS NOT NULL/);
});

it('rejects missing, duplicate, excess, malformed, or mixed selections instead of exporting everything', async () => {
  const tooMany = Array.from({ length: 201 }, (_, i) => `id-${i}`).join(',');
  for (const query of [
    '?scope=selected', '?scope=selected&ids=', '?ids=link-1',
    '?scope=selected&ids=link-1,link-1', '?scope=selected&ids=link-1,,link-2',
    '?scope=selected&ids=%0Alink-1', '?scope=selected&ids=' + 'x'.repeat(37),
    '?scope=selected&ids=link-1&q=exam', '?scope=selected&ids=link-1&page=2',
    '?scope=selected&ids=link-1&ids=link-2', '?scope=unknown',
    '?scope=selected&ids=' + tooMany,
  ]) assert.equal((await request(query)).status, 400, query);
  const missing = await request('?scope=selected&ids=link-1,missing');
  assert.equal(missing.status, 404);
  assert.match(JSON.parse(missing.body).error, /no longer exist/);
});

it('rejects malformed filter values, pagination, and ambiguous parameters', async () => {
  for (const query of [
    'ids=link-1', 'page=2', 'limit=50', 'status=surprise', 'sort=random', 'order=sideways',
    'neverOpened=maybe', 'includeDeleted=yes', 'youtube=both', 'remindBefore=banana',
    'ageBefore=01', 'remindBefore=2026-02-30T00:00:00Z', 'updatedAfter=banana', 'unknown=x', 'q=one&q=two',
    'q=one&search=two', 'view=review',
  ]) assert.equal((await request('?scope=filtered&' + query)).status, 400, query);
});

it('supports JSON ID lists for imported IDs containing commas without changing scope', async () => {
  const response = await request('?scope=selected&ids=' + encodeURIComponent(JSON.stringify(['comma,id'])));
  assert.equal(response.status, 200);
  assert.equal(response.headers['X-Link-Count'], '1');
  assert.match(response.body, /## Article 5/);
  for (const ids of ['[broken', '[1]', '[null]', '[]', '{"id":"one"}']) {
    assert.equal((await request('?scope=selected&ids=' + encodeURIComponent(ids))).status, 400, ids);
  }
});

it('enforces the filtered cap without returning a truncated attachment', async () => {
  filteredTotal = 5001;
  const response = await request('?scope=filtered');
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /5,000|5000/);
  assert.equal(response.headers['Content-Disposition'], undefined);
  filteredTotal = 80;
});

it('exports an empty filtered view and the exact 5,000-link boundary', async () => {
  filteredLinks = [];
  filteredTotal = 0;
  const empty = await request('?scope=filtered');
  assert.equal(empty.status, 200);
  assert.equal(empty.headers['X-Link-Count'], '0');
  assert.equal(empty.body.trim(), '# Link Nest Export');
  filteredLinks = Array.from({ length: 5000 }, (_, i) => ({ ...links[0], id: `boundary-${i}` }));
  filteredTotal = 5000;
  const maximum = await request('?scope=filtered');
  assert.equal(maximum.status, 200);
  assert.equal(maximum.headers['X-Link-Count'], '5000');
  assert.equal((maximum.body.match(/^## Article /gm) || []).length, 5000);
  filteredLinks = null;
  filteredTotal = 80;
});

it('keeps unscoped full exports and safely serializes tags', async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Disposition'], /links-export\.md/);
  assert.equal((response.body.match(/^## Article /gm) || []).length, 80);
  const text = toMarkdown([{ ...links[0], tags: ['<img src=x>', '[topic]', '# Heading\n## Fake'] }]);
  assert.match(text, /- Tags:/);
  assert.doesNotMatch(text, /<img src=x>/);
  assert.doesNotMatch(text, /^## Fake/m);
  assert.match(text, /### Why I saved this/);
  assert.match(text, /### Note/);
});
