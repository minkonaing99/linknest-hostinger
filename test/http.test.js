'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { sendFile, sendJson } = require('../lib/http');

function response(resolve) {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = Buffer.alloc(0)) { this.body = body; resolve(this); },
  };
}

function serve(req, file) {
  return new Promise(resolve => sendFile(req, response(resolve), file));
}

test('static text uses Brotli, validators, and revalidation caching', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linknest-http-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'app.css');
  const source = 'body { color: green; }\n'.repeat(200);
  fs.writeFileSync(file, source);

  const first = await serve({ headers: { 'accept-encoding': 'br, gzip' } }, file);
  assert.equal(first.status, 200);
  assert.equal(first.headers['Content-Encoding'], 'br');
  assert.equal(first.headers.Vary, 'Accept-Encoding');
  assert.equal(first.headers['Cache-Control'], 'public, max-age=0, must-revalidate');
  assert.equal(zlib.brotliDecompressSync(first.body).toString(), source);

  const second = await serve({ headers: { 'if-none-match': first.headers.ETag } }, file);
  assert.equal(second.status, 304);
  assert.equal(second.headers.Vary, 'Accept-Encoding');
  assert.equal(second.body.length, 0);

  const gzip = await serve({ headers: { 'accept-encoding': 'br;q=0, gzip' } }, file);
  assert.equal(gzip.headers['Content-Encoding'], 'gzip');
});

test('HTML stays private and revalidates', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linknest-http-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, '<h1>Link Nest</h1>');
  const res = await serve({ headers: {} }, file);
  assert.equal(res.headers['Cache-Control'], 'private, no-cache');
});

test('JSON responses are compact', async () => {
  const res = await new Promise(resolve => sendJson(response(resolve), 200, { ok: true }));
  assert.equal(res.body, '{"ok":true}');
});
