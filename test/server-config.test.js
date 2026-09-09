'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

function startServer(t) {
  const script = [
    "const { server } = require('./lib/router')",
    "server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port, requestTimeout: server.requestTimeout, headersTimeout: server.headersTimeout, keepAliveTimeout: server.keepAliveTimeout, maxHeadersCount: server.maxHeadersCount })))",
  ].join(';');
  const child = spawn(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', data => resolve(JSON.parse(data)));
  });
}

test('production server exposes health check with bounded timeouts', async t => {
  const settings = await startServer(t);
  assert.deepEqual(settings, {
    port: settings.port,
    requestTimeout: 30_000,
    headersTimeout: 15_000,
    keepAliveTimeout: 5_000,
    maxHeadersCount: 100,
  });
  const response = await fetch(`http://127.0.0.1:${settings.port}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});
