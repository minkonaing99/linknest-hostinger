'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const queue = fs.readFileSync(path.join(__dirname, '../public/js/offline-queue.js'), 'utf8');
const home = fs.readFileSync(path.join(__dirname, '../public/js/home.js'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '../public/js/editor.js'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');

it('stores bounded validated captures in IndexedDB', () => {
  const storage = fs.readFileSync('public/js/offline-store.js', 'utf8');
  assert.match(storage, /indexedDB\.open\('linknest-offline', 2\)/);
  assert.match(queue, /protocol !== 'http:' && parsed\.protocol !== 'https:'/);
  assert.match(queue, /records\.length >= 100/);
  assert.match(queue, /crypto\.randomUUID\(\)/);
  assert.match(storage, /tx\.oncomplete/);
  assert.match(storage, /tx\.onabort/);
});

it('syncs sequentially and retains duplicates for a decision', () => {
  assert.match(queue, /for \(const record of records\)/);
  assert.match(queue, /api\/links\/duplicates/);
  assert.match(queue, /Duplicate needs decision/);
  assert.match(queue, /state: 'saved'/);
  assert.match(queue, /state: 'pending'/);
  assert.match(queue, /\['pending', 'syncing'\]\.includes/);
});

it('queues new captures from Home and Editor while offline', () => {
  assert.match(home, /LinkNestOffline\.queueCapture/);
  assert.match(editor, /LinkNestOffline\.queueCapture/);
  assert.match(home, /offline\|network\|fetch/i);
  assert.match(editor, /offline\|network\|fetch/i);
  assert.match(queue, /addEventListener\('online'/);
  assert.match(sw, /linknest-sync-captures/);
});

it('registers PWA sharing and reuses the validated editor capture flow', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/manifest.json'), 'utf8'));
  assert.equal(manifest.share_target.action, '/editor.html');
  assert.equal(manifest.share_target.method, 'GET');
  assert.deepEqual(manifest.share_target.params, { title: 'title', text: 'text', url: 'url' });
  assert.match(editor, /function sharedHttpUrl\(\)/);
  assert.match(editor, /queryParam\('text'\)/);
  assert.match(editor, /parsed\.username \|\| parsed\.password/);
  assert.match(editor, /if \(navigator\.onLine\) await fetchAndApplyTitle/);
  assert.match(sw, /caches\.match\('\/offline-library.html'\)/);
  assert.match(sw, /ignoreSearch: true/);
  assert.match(sw, /response\.ok && !response\.redirected/);
});

it('prefers explicit shared URLs and rejects unsafe shared input', () => {
  const source = 'function sharedHttpUrl()' + editor.split('function sharedHttpUrl()')[1].split('async function loadFromShareParams')[0];
  const parse = params => vm.runInNewContext(source + '; sharedHttpUrl();', {
    URL, queryParam: name => params[name] || null,
  });
  assert.equal(parse({ url: 'https://example.com/page', text: 'https://other.com' }), 'https://example.com/page');
  assert.equal(parse({ text: 'Read this https://example.com/video?v=1 now' }), 'https://example.com/video?v=1');
  assert.equal(parse({ url: 'javascript:alert(1)' }), null);
  assert.equal(parse({ url: 'https://user:password@example.com' }), null);
  assert.equal(parse({ text: 'No URL here' }), null);
});

function queueRuntime(records, initialOwner, fetchHandler) {
  let owner = { ...initialOwner }; const listeners = {}; const calls = [];
  const storage = {
    getIdentity: async () => ({ ...owner }), sameIdentity: (a, b) => a.userId === b.userId && a.generation === b.generation,
    verifyIdentity: async (id, expected) => { if (!storage.sameIdentity(owner, expected)) throw Error('Account changed'); if (owner.userId !== id) owner = { userId: id, generation: owner.generation + 1 }; return { ...owner }; },
    invalidate: async () => { owner = { userId: null, generation: owner.generation + 1 }; },
    request: async (name, mode, operation, expected) => {
      if (expected && !storage.sameIdentity(owner, expected)) throw Error('Account changed');
      return operation({ getAll: () => structuredClone(records), put: record => { const index = records.findIndex(item => item.id === record.id); if (index < 0) records.push(structuredClone(record)); else records[index] = structuredClone(record); }, delete: id => { const index = records.findIndex(item => item.id === id); if (index >= 0) records.splice(index, 1); } });
    },
  };
  const element = () => ({ children: [], events: {}, textContent: '', append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); }, setAttribute() {}, addEventListener(name, handler) { this.events[name] = handler; } });
  const elements = new Map([['offline-capture-list', element()], ['offline-captures', element()]]);
  const serviceWorkerListeners = {};
  const navigator = { onLine: true, serviceWorker: { addEventListener: (name, handler) => { serviceWorkerListeners[name] = handler; }, ready: Promise.resolve({ sync: { register: async () => {} } }) } };
  const document = { getElementById: id => elements.get(id), createElement: element, body: { dataset: { page: 'other' } }, querySelector: () => null };
  const window = { LinkNestOfflineStore: storage, dispatchEvent() {}, addEventListener: (name, handler) => { listeners[name] = handler; } };
  vm.runInNewContext(queue, { window, document, navigator, URL, URLSearchParams, crypto: { randomUUID: () => 'new-id' }, CustomEvent: class {}, fetch: async (url, options) => { calls.push({ url, options }); return fetchHandler(url, options, storage); } }, { filename: path.resolve('public/js/offline-queue.js') });
  return { api: window.LinkNestOffline, calls, storage, listeners, elements, navigator, document, serviceWorkerListeners };
}
const captureRecord = ownerId => ({ id: 'capture', ownerId, title: 'Private', url: 'https://example.com', notes: '', tags: [], state: 'pending', createdAt: '2026-01-01', saveReason: '' });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
it('quarantines legacy and foreign captures; explicit claim verifies account and sends owner precondition', async () => {
  const records = [captureRecord(null)];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async url => {
    if (url === '/api/me') return response(200, { user: { id: 'owner' } });
    if (url.startsWith('/api/links/duplicates')) return response(200, { candidates: [] });
    return response(200, { entry: { id: 'server-id' } });
  });
  assert.equal((await runtime.api.listCaptures()).length, 0);
  await runtime.api.syncCaptures(); assert.equal(runtime.calls.length, 1);
  await runtime.api.claimCapture('capture'); assert.equal(records[0].state, 'saved');
  assert.equal(records[0].ownerId, 'owner');
  const post = runtime.calls.find(call => call.options.method === 'POST');
  assert.equal(post.options.headers['X-LinkNest-User-ID'], 'owner');
  records[0].ownerId = 'another'; assert.equal((await runtime.api.listCaptures()).length, 0);
});
it('logout during duplicate lookup prevents capture POST and stale state writes', async () => {
  const records = [captureRecord('owner')];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async (url, options, storage) => {
    if (url === '/api/me') return response(200, { user: { id: 'owner' } });
    await storage.invalidate(); return response(200, { candidates: [] });
  });
  await runtime.api.syncCaptures(); assert.equal(runtime.calls.some(call => call.options.method === 'POST'), false);
  assert.equal((await runtime.api.listCaptures()).length, 0);
  assert.equal(records[0].state, 'syncing');
});
it('401 invalidates identity without replaying or deleting pending captures', async () => {
  const records = [captureRecord('owner')];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async () => response(401, {}));
  await runtime.api.syncCaptures(); assert.equal((await runtime.storage.getIdentity()).userId, null);
  assert.equal(records.length, 1); assert.equal(runtime.calls.length, 1);
});

it('queues owner-bound captures and rejects unsafe or oversized drafts and full queues', async () => {
  const records = []; const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async () => response(503, {}));
  const saved = await runtime.api.queueCapture({ url: 'https://example.com', title: 'Capture', notes: 'Notes', saveReason: 'Reason' });
  assert.equal(saved.ownerId, 'owner'); assert.equal(records.length, 1);
  for (const draft of [{ url: 'javascript:alert(1)' }, { url: 'https://a:b@example.com' }, { url: 'https://example.com', notes: 'x'.repeat(10001) }, { url: 'https://example.com', saveReason: 3 }]) await assert.rejects(runtime.api.queueCapture(draft));
  records.push(...Array(99).fill(captureRecord('owner')));
  await assert.rejects(runtime.api.queueCapture({ url: 'https://example.com' }), /queue is full/);
});
it('duplicate decisions stay failed; retry and dismissal preserve explicit capture lifecycle', async () => {
  const records = [captureRecord('owner')]; let duplicates = true;
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async url => url === '/api/me' ? response(200, { user: { id: 'owner' } }) : url.startsWith('/api/links/duplicates') ? response(200, { candidates: duplicates ? [{}] : [] }) : response(200, { entry: { id: 'saved' } }));
  await runtime.api.syncCaptures(); assert.equal(records[0].state, 'failed'); assert.equal(records[0].error, 'Duplicate needs decision');
  duplicates = false; await runtime.api.retryCapture('capture'); assert.equal(records[0].state, 'saved');
  await runtime.api.dismissCapture('capture'); assert.equal(records.length, 0);
});
it('queue rendering reveals owner titles but only generic claim controls for other owners', async () => {
  const records = [captureRecord('owner'), { ...captureRecord('other'), id: 'foreign', title: 'Foreign secret', state: 'failed' }];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async () => response(401, {}));
  await runtime.listeners['linknest:offline-queue-change']();
  const rows = runtime.elements.get('offline-capture-list').children;
  assert.equal(rows[0].children[0].children[0].textContent, 'Private');
  assert.equal(rows[1].children[0].textContent, 'Unassigned capture 1');
  assert.equal(rows[1].children[1].textContent, 'Claim after sign in');
  await rows[1].children[1].events.click(); assert.equal(rows[1].children[0].textContent, 'Sign in online to claim this capture.');
});

it('failed POST responses retain capture state appropriately; lookup auth expiry clears owner', async () => {
  for (const status of [409, 400, 500]) {
    const records = [captureRecord('owner')];
    const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async url => url === '/api/me' ? response(200, { user: { id: 'owner' } }) : url.startsWith('/api/links/duplicates') ? response(200, { candidates: [] }) : response(status, { error: 'failure' }));
    await runtime.api.syncCaptures(); assert.equal(records[0].state, status === 500 ? 'pending' : 'failed');
    await runtime.listeners['linknest:offline-queue-change']();
  }
  const records = [captureRecord('owner')];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async url => url === '/api/me' ? response(200, { user: { id: 'owner' } }) : response(401, {}));
  await runtime.api.syncCaptures(); assert.equal((await runtime.storage.getIdentity()).userId, null);
  await runtime.api.retryCapture('missing');
});

it('home panel lifecycle and rendered Retry, Dismiss and Claim controls complete capture journeys', async () => {
  const records = [{ ...captureRecord('owner'), state: 'failed' }];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async url => url === '/api/me' ? response(200, { user: { id: 'owner' } }) : url.startsWith('/api/links/duplicates') ? response(200, { candidates: [] }) : response(200, { entry: { id: 'saved' } }));
  runtime.navigator.onLine = false; runtime.document.body.dataset.page = 'home';
  runtime.listeners.DOMContentLoaded(); await new Promise(resolve => setImmediate(resolve));
  const row = runtime.elements.get('offline-capture-list').children[0];
  runtime.navigator.onLine = true; await row.children.find(child => child.textContent === 'Retry').events.click();
  assert.equal(records[0].state, 'saved');
  await row.children.find(child => child.textContent === 'Dismiss').events.click(); assert.equal(records.length, 0);
  records.push({ ...captureRecord(null), id: 'legacy' });
  await runtime.listeners['linknest:offline-identity-change']();
  const rows = runtime.elements.get('offline-capture-list').children;
  const generic = rows.at(-1); await generic.children[1].events.click(); assert.equal(records[0].ownerId, 'owner');
  assert.equal(await runtime.api.quarantinedCount(), 0);
  runtime.serviceWorkerListeners.message({ data: 'other' });
  runtime.serviceWorkerListeners.message({ data: 'linknest-sync-captures' }); await new Promise(resolve => setImmediate(resolve));
  runtime.listeners['linknest:offline-invalidated'](); await new Promise(resolve => setImmediate(resolve));
});
it('offline and already-running sync avoid duplicate requests; failed identity lookup preserves captures', async () => {
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const records = [captureRecord('owner')];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async () => { await gate; return response(403, {}); });
  runtime.navigator.onLine = false; await runtime.api.syncCaptures(); assert.equal(runtime.calls.length, 0);
  runtime.navigator.onLine = true; const running = runtime.api.syncCaptures(); await Promise.resolve(); await runtime.api.syncCaptures();
  assert.equal(runtime.calls.length, 1); finish(); await running; assert.equal(records[0].state, 'pending');
  runtime.document.body.dataset.page = 'other'; runtime.listeners.DOMContentLoaded(); await new Promise(resolve => setImmediate(resolve));
});
it('owner mismatch from capture POST invalidates identity and retains private draft', async () => {
  const records = [captureRecord('owner')];
  const runtime = queueRuntime(records, { userId: 'owner', generation: 1 }, async url => url === '/api/me' ? response(200, { user: { id: 'owner' } }) : url.startsWith('/api/links/duplicates') ? response(200, { candidates: [] }) : response(409, { error: 'Account changed. Sign in again before continuing.' }));
  await runtime.api.syncCaptures(); assert.equal((await runtime.storage.getIdentity()).userId, null);
  assert.equal(records.length, 1); assert.equal((await runtime.api.listCaptures()).length, 0);
});
