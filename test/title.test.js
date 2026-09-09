'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchTitle } = require('../lib/title');

test('metadata requests carry an abort deadline', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ title: 'Fast title' }) };
  };

  assert.deepEqual(await fetchTitle('https://youtu.be/ee7eRHFmqF4', 'youtu.be'), {
    title: 'Fast title',
    needsManualEntry: false,
  });
});

test('metadata redirects cannot reach private addresses', async t => {
  const originalFetch = global.fetch;
  const requested = [];
  const redirectModes = [];
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (url, options) => {
    requested.push(String(url));
    redirectModes.push(options.redirect);
    if (String(url) === 'https://93.184.216.34/article') {
      return { status: 302, headers: { get: () => 'http://127.0.0.1/admin' } };
    }
    return { ok: false, status: 500, headers: { get: () => null } };
  };

  await fetchTitle('https://93.184.216.34/article', '93.184.216.34');

  assert.ok(redirectModes.every(mode => mode === 'manual'));
  assert.equal(requested.includes('http://127.0.0.1/admin'), false);
});
