'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function worker() {
  const handlers = {}, messages = [], order = [], cached = new Map();
  let owner = { userId: 'owner', generation: 1 }; let navigationOwner = { ...owner };
  const storage = {
    getIdentity: async () => ({ ...owner }), sameIdentity: (a, b) => a?.userId === b?.userId && a?.generation === b?.generation,
    invalidate: async () => { order.push('invalidate'); owner = { userId: null, generation: owner.generation + 1 }; },
    request: async (_name, _mode, operation, expected) => {
      if (expected && !storage.sameIdentity(owner, expected)) throw Error('Account changed');
      return operation({ get: () => navigationOwner, put: value => { navigationOwner = value; } });
    },
  };
  const normalize = request => typeof request === 'string' ? request : new URL(request.url).pathname;
  const cache = {
    keys: async () => [...cached.keys()].map(path => ({ url: 'https://app.test' + path })),
    delete: async request => cached.delete(normalize(request)), put: async (request, response) => cached.set(normalize(request), response),
    addAll: async () => {},
  };
  let fetchHandler = async () => { throw Error('offline'); };
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
    importScripts() {}, URL, Response,
    self: { LinkNestOfflineStore: storage, location: { origin: 'https://app.test' }, addEventListener: (name, handler) => { handlers[name] = handler; }, skipWaiting() {}, clients: { claim() {}, matchAll: async () => [{ postMessage: message => messages.push(message) }] } },
    caches: { keys: async () => ['linknest-v35'], open: async () => cache, delete: async () => {}, match: async request => { const value = cached.get(normalize(request)); return value instanceof Response ? value.clone() : value; } },
    fetch: async request => { order.push('fetch'); return fetchHandler(request); },
  }, { filename: require('node:path').resolve('public/sw.js') });
  return { cached, cache, order, messages, storage, setFetch: handler => { fetchHandler = handler; },
    async event(name, extra = {}) { let promise; handlers[name]({ ...extra, waitUntil: value => { promise = value; } }); await promise; },
    async fetch(path, mode = 'cors') { let result; handlers.fetch({ request: { url: 'https://app.test' + path, mode, method: 'GET' }, respondWith: promise => { result = promise; } }); return result; } };
}
it('logout invalidates and purges protected navigation before network, preserving static shell', async () => {
  const runtime = worker(); runtime.cached.set('/editor.html', 'private shell'); runtime.cached.set('/offline-library.html', 'public shell');
  runtime.setFetch(async () => new Response('logout'));
  await runtime.fetch('/api/v1/logout');
  assert.deepEqual(runtime.order, ['invalidate', 'fetch']);
  assert.equal(runtime.cached.has('/editor.html'), false); assert.equal(runtime.cached.has('/offline-library.html'), true);
  assert.deepEqual(runtime.messages, ['linknest-offline-invalidated']);
});
it('401 is returned directly and invalidates library rather than cached API fallback', async () => {
  const runtime = worker(); runtime.cached.set('/api/links', 'private cached data'); runtime.setFetch(async () => new Response('{}', { status: 401 }));
  assert.equal((await runtime.fetch('/api/links')).status, 401);
  assert.equal((await runtime.storage.getIdentity()).userId, null); assert.equal(runtime.cached.has('/api/links'), false);
});
it('offline protected editor fallback requires matching current account generation', async () => {
  const runtime = worker(); runtime.cached.set('/editor.html', 'editor shell'); runtime.cached.set('/offline-library.html', 'library shell');
  assert.equal(await runtime.fetch('/editor.html?url=https://example.com', 'navigate'), 'editor shell');
  await runtime.storage.invalidate();
  assert.equal(await runtime.fetch('/editor.html', 'navigate'), 'library shell');
});
it('late protected navigation response cannot cache after logout', async () => {
  const runtime = worker();
  runtime.setFetch(async () => { await runtime.storage.invalidate(); return new Response('editor'); });
  await runtime.fetch('/editor.html', 'navigate'); assert.equal(runtime.cached.has('/editor.html'), false);
});

it('blocked IndexedDB never prevents navigation or server logout', async () => {
  const runtime = worker(); runtime.storage.getIdentity = async () => { throw Error('blocked'); };
  runtime.storage.invalidate = async () => { throw Error('blocked'); };
  runtime.setFetch(async () => new Response('server response'));
  assert.equal(await (await runtime.fetch('/editor.html', 'navigate')).text(), 'server response');
  assert.equal(await (await runtime.fetch('/logout', 'navigate')).text(), 'server response');
  assert.equal(runtime.order.filter(item => item === 'fetch').length, 2);
});

it('worker lifecycle precaches shell, announces background sync and handles logout messages', async () => {
  const runtime = worker(); await runtime.event('install'); await runtime.event('activate');
  await runtime.event('sync', { tag: 'linknest-captures' }); assert.deepEqual(runtime.messages, ['linknest-sync-captures']);
  await runtime.event('sync', { tag: 'other' });
  await runtime.event('message', { data: 'linknest-clear-private-data' });
  assert.equal((await runtime.storage.getIdentity()).userId, null);
});
it('navigation caches current-owner shell; public shell and static assets remain available offline', async () => {
  const runtime = worker(); runtime.setFetch(async () => new Response('cached shell'));
  await runtime.fetch('/editor.html', 'navigate'); assert.equal(await runtime.cached.get('/editor.html').clone().text(), 'cached shell');
  await runtime.fetch('/js/offline-library.js'); assert.equal(await runtime.cached.get('/js/offline-library.js').clone().text(), 'cached shell');
  runtime.setFetch(async () => { throw Error('offline'); });
  assert.equal(await (await runtime.fetch('/js/offline-library.js')).text(), 'cached shell');
  runtime.cached.set('/offline-library.html', new Response('public library'));
  assert.equal(await (await runtime.fetch('/offline-library.html', 'navigate')).text(), 'public library');
  assert.equal((await runtime.fetch('/api/links')).status, 503);
});

it('cache writes and later identity failure never replace successful network navigation or assets', async () => {
  for (const path of ['/offline-library.html', '/editor.html', '/js/offline-library.js']) {
    const runtime = worker(); runtime.cached.set('/offline-library.html', new Response('offline fallback'));
    runtime.cache.put = async () => { throw Error('Quota exceeded'); };
    runtime.setFetch(async () => new Response('network page'));
    assert.equal(await (await runtime.fetch(path, path.endsWith('.html') ? 'navigate' : 'cors')).text(), 'network page');
  }
  const runtime = worker(); let reads = 0;
  runtime.storage.getIdentity = async () => { if (++reads > 1) throw Error('blocked'); return { userId: 'owner', generation: 1 }; };
  runtime.setFetch(async () => new Response('network page'));
  assert.equal(await (await runtime.fetch('/editor.html', 'navigate')).text(), 'network page');
});
it('offline navigation falls back to public library even if identity storage is unavailable', async () => {
  const runtime = worker(); runtime.cached.set('/offline-library.html', new Response('public fallback'));
  runtime.storage.getIdentity = async () => { throw Error('blocked'); };
  assert.equal(await (await runtime.fetch('/editor.html', 'navigate')).text(), 'public fallback');
});
