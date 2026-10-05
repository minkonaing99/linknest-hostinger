'use strict';

process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
let implementation;
const calls = [];
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async (sql, params) => { calls.push({ sql, params }); return implementation(sql, params); } } };
const { canonicalReadingUrl, validateReadingPosition, decodeReadingPosition,
  lookupReadingLink, readReadingPosition, saveReadingPosition } = require('../lib/reading-position');
const { readLink, readAllLinksForExport, updateLink, importLinks, previewImportLinks, deleteLink } = require('../lib/links');
const { handle } = require('../lib/routes/reading-position');
const now = new Date('2026-10-05T12:00:00.000Z');
const position = { url: 'https://example.com/Article', ratio: 0.5, offset: -50,
  anchor: 'Chapter two', scrollHeight: 2400 };
const stored = { ...position, savedAt: now.toISOString() };
const row = { id: 'one', url: position.url, title: 'Article', status: 'saved', tags: '[]',
  created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  reading_position: JSON.stringify(stored) };

function mock(result = row) {
  calls.length = 0;
  implementation = async sql => sql.startsWith('SELECT')
    ? { rows: result ? [result] : [], rowCount: result ? 1 : 0 }
    : { rows: [], rowCount: 1 };
}

it('canonicalizes exact saved URLs while rejecting unsafe or malformed identities', () => {
  assert.equal(canonicalReadingUrl('http://example.com/Article/?utm_source=test#chapter'), position.url);
  assert.notEqual(canonicalReadingUrl('https://example.com/article'), position.url);
  for (const value of [null, 2, '', 'example.com', 'javascript:alert(1)', 'file:///a',
    'https://user:pass@example.com', 'https://example.com/\nArticle', 'https://example.com/' + 'a'.repeat(2048)]) {
    assert.throws(() => canonicalReadingUrl(value), { statusCode: 400 });
  }
});

it('validates bounded position fields, returns copies, and uses server save time', () => {
  const input = { ...position, savedAt: '1900-01-01', unexpected: 'private text' };
  const result = validateReadingPosition(input, now);
  assert.deepEqual(result, stored);
  assert.notEqual(result, input);
  assert.equal(input.savedAt, '1900-01-01');
  for (const change of [{ ratio: -0.1 }, { ratio: 1.1 }, { ratio: '0.5' }, { ratio: NaN },
    { offset: Infinity }, { offset: 100001 }, { offset: null }, { anchor: {} }, { anchor: 'x'.repeat(201) },
    { scrollHeight: -1 }, { scrollHeight: 100000001 }, { scrollHeight: '1' }]) {
    assert.throws(() => validateReadingPosition({ ...position, ...change }, now), { statusCode: 400 });
  }
  assert.equal(validateReadingPosition({ ...position, ratio: 0, offset: 0, anchor: '', scrollHeight: 0 }, now).ratio, 0);
  assert.equal(validateReadingPosition({ ...position, ratio: 1 }, now).ratio, 1);
  assert.throws(() => validateReadingPosition([]), { statusCode: 400 });
});

it('lookup excludes archived records and uses binary canonical URL comparison', async () => {
  mock();
  assert.deepEqual(await lookupReadingLink('http://example.com/Article?utm_source=x'), { id: 'one', url: position.url });
  assert.match(calls[0].sql, /BINARY url\s*=\s*BINARY \?/);
  assert.match(calls[0].sql, /deleted_at IS NULL/);
  assert.deepEqual(calls[0].params, [position.url]);
  mock(null);
  assert.equal(await lookupReadingLink(position.url), null);
});

it('reads positions safely; malformed or different-URL stored data never resumes', async () => {
  mock();
  assert.deepEqual(await readReadingPosition('one', position.url), stored);
  for (const raw of [null, 'broken', '{}', JSON.stringify({ ...stored, url: 'https://different.example/' }),
    JSON.stringify({ ...stored, savedAt: 'not-a-date' }), JSON.stringify({ ...stored, ratio: 2 })]) {
    assert.equal(decodeReadingPosition(raw, position.url), null);
  }
  assert.deepEqual(decodeReadingPosition(stored, position.url), stored);
  assert.equal(decodeReadingPosition({ ...stored, savedAt: '2026-02-30T12:00:00.000Z' }, position.url), null);
  mock({ ...row, reading_position: null });
  assert.equal(await readReadingPosition('one', position.url), null);
  mock(null);
  await assert.rejects(readReadingPosition('one', position.url), { statusCode: 404 });
  mock(row);
  await assert.rejects(readReadingPosition('one', 'https://example.com/article'), { statusCode: 409 });
  await assert.rejects(readReadingPosition('x'.repeat(37), position.url), { statusCode: 400 });
});

it('supports legacy imported IDs containing spaces across lookup, read, and save', async () => {
  mock({ ...row, id: 'legacy id' });
  assert.equal((await lookupReadingLink(position.url)).id, 'legacy id');
  assert.deepEqual(await readReadingPosition('legacy id', position.url), stored);
  assert.deepEqual(await saveReadingPosition('legacy id', position, now), stored);
});

it('writes only position atomically for active matching URL, without review or open mutations', async () => {
  mock();
  assert.deepEqual(await saveReadingPosition('one', position, now), stored);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE links SET reading_position=\?/);
  assert.match(calls[0].sql, /BINARY url\s*=\s*BINARY \?/);
  assert.match(calls[0].sql, /deleted_at IS NULL/);
  assert.doesNotMatch(calls[0].sql, /updated_at|opened_count|first_meaningful|last_useful|status=/);
  assert.deepEqual(JSON.parse(calls[0].params[0]), stored);
  implementation = async sql => sql.startsWith('UPDATE') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 };
  await assert.rejects(saveReadingPosition('one', position, now), { statusCode: 404 });
  implementation = async sql => sql.startsWith('UPDATE') ? { rows: [], rowCount: 0 } : { rows: [row], rowCount: 1 };
  await assert.rejects(saveReadingPosition('one', { ...position, url: 'https://other.example/' }, now), { statusCode: 409 });
});

it('complete backups, previews, and imports retain validated positions; legacy input defaults null', async () => {
  mock();
  const entry = await readLink('one');
  assert.deepEqual(entry.readingPosition, stored);
  assert.deepEqual((await readAllLinksForExport())[0].readingPosition, stored);
  implementation = async sql => sql.startsWith('SELECT COUNT') ? { rows: [{ count: 1 }] }
    : sql.startsWith('SELECT') ? { rows: [] } : { rows: [], rowCount: 1 };
  const preview = await previewImportLinks([entry]);
  assert.deepEqual(preview.readyLinks[0].readingPosition, stored);
  await importLinks([entry]);
  const insert = calls.find(call => call.sql.startsWith('INSERT'));
  assert.match(insert.sql, /reading_position/);
  assert.deepEqual(JSON.parse(insert.params.at(-1)), stored);
  const invalid = await importLinks([{ ...entry, readingPosition: { ...stored, ratio: 2 } }]);
  assert.equal(invalid.invalid, 1);
  calls.length = 0;
  await importLinks([{ ...entry, readingPosition: undefined }]);
  assert.equal(calls.find(call => call.sql.startsWith('INSERT')).params.at(-1), null);
});

it('URL edits atomically clear position before URL assignment; general updates cannot supply position', async () => {
  mock();
  implementation = async sql => sql.startsWith('SELECT *') ? { rows: [row] }
    : sql.startsWith('SELECT') ? { rows: [] } : { rows: [], rowCount: 1 };
  const same = await updateLink('one', { title: 'Edited', readingPosition: { ...stored, ratio: 1 } });
  assert.deepEqual(same.readingPosition, stored);
  const sameUpdate = calls.find(call => call.sql.startsWith('UPDATE'));
  assert.match(sameUpdate.sql, /reading_position=CASE WHEN BINARY url=BINARY \? THEN reading_position ELSE NULL END,\s*url=/);
  calls.length = 0;
  const changed = await updateLink('one', { url: 'https://example.com/Different' });
  assert.equal(changed.readingPosition, null);
  const update = calls.find(call => call.sql.startsWith('UPDATE'));
  assert.equal(update.params[0], 'https://example.com/Different');
  calls.length = 0;
  implementation = async sql => sql.startsWith('SELECT COUNT') ? { rows: [{ count: 0 }] } : { rows: [row], rowCount: 1 };
  await deleteLink('one', { hardDelete: true });
  assert.ok(calls.some(call => call.sql === 'DELETE FROM links WHERE id = ?'));
});

async function request(method, pathname, payload) {
  let status, body, headers;
  const req = Readable.from(payload === undefined ? [] : [JSON.stringify(payload)]);
  req.method = method;
  const res = { writeHead(code, values) { status = code; headers = values; }, end(value) { body = JSON.parse(value); } };
  const handled = await handle(req, res, new URL(`https://app.example${pathname}`));
  return { handled, status, body, headers };
}

it('both API prefixes expose lookup and position endpoints with private responses and errors', async () => {
  mock();
  for (const prefix of ['/api', '/api/v1']) {
    const lookup = await request('GET', `${prefix}/links/lookup?url=${encodeURIComponent(position.url)}`);
    assert.equal(lookup.status, 200);
    assert.equal(lookup.body.entry.id, 'one');
    assert.equal(lookup.headers['Cache-Control'], 'private, no-store');
    const get = await request('GET', `${prefix}/links/one/reading-position?url=${encodeURIComponent(position.url)}`);
    assert.deepEqual(get.body.position, stored);
    const put = await request('PUT', `${prefix}/links/one/reading-position`, position);
    assert.equal(put.status, 200);
    assert.equal(put.body.position.ratio, 0.5);
    assert.equal((await request('PUT', `${prefix}/links/one/reading-position`, { ...position, ratio: 2 })).status, 400);
    assert.equal((await request('GET', `${prefix}/links/lookup`)).status, 400);
    assert.equal((await request('GET', `${prefix}/links/one/reading-position`)).status, 400);
    assert.equal((await request('GET', `${prefix}/links/%ZZ/reading-position?url=x`)).status, 400);
  }
  assert.equal((await request('POST', '/api/links/one/reading-position', position)).handled, false);
  assert.equal((await request('GET', '/browse.html')).handled, false);
  implementation = async () => { throw new Error('SQL SELECT secret schema db.reading_position failed'); };
  const failed = await request('GET', `/api/links/lookup?url=${encodeURIComponent(position.url)}`);
  assert.equal(failed.status, 500);
  assert.equal(failed.body.error, 'Could not access reading position.');
});
