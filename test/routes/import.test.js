'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const linksPath = require.resolve('../../lib/links');
require.cache[linksPath] = {
  id: linksPath,
  filename: linksPath,
  loaded: true,
  exports: {
    importLinks: async links => ({ imported: links.length, total: links.length }),
    parseBookmarksHtml: () => [],
    readAllLinksForExport: async () => [],
  },
};

const { handle, toCsv, parseCsv, toMarkdown } = require('../../lib/routes/import');

const link = {
  title: '=Research, "later"',
  url: 'https://example.com/article',
  notes: 'First line\nSecond line',
  status: 'saved',
  date: '2026-09-11',
};

describe('portable exports', () => {
  it('writes RFC 4180 CSV and round-trips protected fields', () => {
    const csv = toCsv([link]);
    assert.ok(csv.startsWith('\uFEFF"title","url","notes","status","date"\r\n'));
    assert.match(csv, /"'=Research, ""later"""/);
    assert.match(csv, /"First line\nSecond line"/);
    assert.deepEqual(parseCsv(csv), [link]);
    const risky = ["'=SUM(1,1)", "''=literal", '  =formula', '\t+formula', '\n@formula'];
    for (const value of risky) {
      assert.equal(parseCsv(toCsv([{ ...link, title: value }]))[0].title, value);
    }
  });

  it('rejects malformed CSV and unexpected headers', () => {
    assert.throws(() => parseCsv('title,url\n"open'), /Unterminated quoted field/);
    assert.throws(() => parseCsv('url,title\nhttps:\/\/example.com,Example'), /header/);
    assert.throws(() => parseCsv('title,url,notes,status,date\nExample,https:\/\/example.com,,unknown,2026-09-11'), /status/);
  });

  it('writes safe Markdown with all portable fields', () => {
    const markdown = toMarkdown([{ ...link, title: '<script>[Title]', notes: '<img src=x>' }]);
    assert.match(markdown, /^# Link Nest Export/m);
    assert.match(markdown, /## &lt;script&gt;\\\[Title\\\]/);
    assert.match(markdown, /- URL: <https:\/\/example\.com\/article>/);
    assert.match(markdown, /- Status: saved/);
    assert.match(markdown, /- Saved: 2026-09-11/);
    assert.match(markdown, /    &lt;img src=x&gt;/);
    assert.doesNotMatch(markdown, /<script>/);
    const unsafe = toMarkdown([{ ...link, url: 'javascript:alert(1)' }]);
    assert.doesNotMatch(unsafe, /<javascript:/);
    assert.match(unsafe, /URL: javascript:alert\(1\)/);
  });
});

it('serves CSV downloads and accepts CSV imports', async () => {
  let status;
  let headers;
  let body;
  const res = {
    writeHead(code, values) { status = code; headers = values; },
    end(value) { body = value; },
  };
  assert.equal(await handle({ method: 'GET' }, res, new URL('https://example.com/api/links/export.csv')), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(status, 200);
  assert.match(headers['Content-Type'], /text\/csv/);
  assert.match(headers['Content-Disposition'], /links-export\.csv/);
  assert.equal(headers['Cache-Control'], 'private, no-store');

  const req = Readable.from([JSON.stringify({ csv: toCsv([link]) })]);
  req.method = 'POST';
  assert.equal(await handle(req, res, new URL('https://example.com/api/links/import-csv')), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { ok: true, imported: 1, total: 1, parsed: 1 });
});

it('keeps JSON export as the complete backup endpoint', async () => {
  let status;
  let headers;
  let body;
  const res = {
    writeHead(code, values) { status = code; headers = values; },
    end(value) { body = value; },
  };
  assert.equal(await handle({ method: 'GET' }, res, new URL('https://example.com/api/links/export')), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(status, 200);
  assert.match(headers['Content-Type'], /application\/json/);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(JSON.parse(body), []);
});
