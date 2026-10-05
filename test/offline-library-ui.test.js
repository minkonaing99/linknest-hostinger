'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(responses = [], options = {}) {
  const calls = [], events = {}, token = { userId: 'owner', generation: 1 };
  let saved = options.snapshot || null;
  const nodes = {};
  function node(tag) {
    return { tag, children: [], listeners: {}, textContent: '', value: '',
      appendChild(child) { this.children.push(child); },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      setAttribute(name, value) { this[name] = value; },
    };
  }
  if (options.page) for (const id of ['offline-library-summary', 'offline-library-download', 'offline-library-remove', 'offline-library-persist',
    'offline-library-message', 'offline-search', 'offline-status-filter', 'offline-result-count', 'offline-library-list', 'offline-retry']) nodes[id] = node(id);
  const store = {
    getIdentity: async () => token,
    verifyIdentity: async (id, expected) => { calls.push(['verify', id, expected]); return token; },
    invalidate: async () => { calls.push(['invalidate']); saved = null; },
    replaceLibrary: async (data, expected) => { calls.push(['replace', expected]); saved = data; },
    readLibrary: async () => saved,
    clearLibrary: async () => { saved = null; },
  };
  const context = {
    window: { LinkNestOfflineStore: store, addEventListener: (name, handler) => { events[name] = handler; }, location: { reload: () => calls.push(['reload']) } },
    document: { body: { dataset: { page: options.page || 'test' } }, getElementById: id => nodes[id], createElement: node },
    navigator: { onLine: options.online !== false, storage: { persist: async () => Boolean(options.persistent) } },
    fetch: async (url, options) => { calls.push([url, options]); const next = responses.shift(); if (next instanceof Error) throw next; return next; },
    URL, Date, Error, Set, console,
  };
  vm.runInNewContext(fs.readFileSync('public/js/offline-library.js', 'utf8'), context, { filename: require('node:path').resolve('public/js/offline-library.js') });
  return { api: context.window.LinkNestOfflineLibrary, calls, events, store, nodes };
}

const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

test('searches downloaded title, URL, tags, notes and save reason with status filtering', () => {
  const { api } = load();
  const links = [
    { id: 'a', title: '<script>', url: 'https://example.com', tags: ['Study'], notes: 'Exam prep', saveReason: 'Remember this', status: 'saved' },
    { id: 'b', title: 'Second', url: 'https://other.com', tags: [], notes: '', saveReason: '', status: 'unread' },
  ];
  for (const query of ['script', 'EXAMPLE', 'study', 'exam', 'remember']) assert.equal(api.filterLinks(links, query, '').length, 1);
  assert.equal(api.filterLinks(links, '', 'unread')[0].id, 'b');
  assert.equal(api.filterLinks(links, 'exam', 'unread').length, 0);
  assert.equal(links[0].title, '<script>');
});

const snapshot = { schemaVersion: 1, userId: 'owner', links: [{ id: 'a', title: '<img onerror=alert(1)>', url: 'https://example.com',
  status: 'saved', tags: ['study'], notes: '<script>notes</script>', saveReason: 'Remember' }], total: 2, complete: false, downloadedAt: new Date().toISOString() };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('offline restart renders safe text, partial scope, search and removes visible notes on logout', async () => {
  const h = load([], { page: 'offline-library', snapshot, online: false });
  await h.events.DOMContentLoaded(); await settle();
  assert.match(h.nodes['offline-library-summary'].textContent, /1 of 2.*Partial/);
  const row = h.nodes['offline-library-list'].children[0];
  assert.equal(row.children[0].children[0].textContent, '<img onerror=alert(1)>');
  assert.equal(row.children.at(-1).textContent, '<script>notes</script>');
  assert.equal(row.children[0].children[0].rel, 'noopener noreferrer');
  h.nodes['offline-search'].value = 'missing'; h.nodes['offline-search'].listeners.input();
  assert.equal(h.nodes['offline-result-count'].textContent, '0 links');
  h.nodes['offline-search'].value = ''; h.nodes['offline-status-filter'].value = 'unread'; h.nodes['offline-status-filter'].listeners.change();
  assert.equal(h.nodes['offline-result-count'].textContent, '0 links');
  h.nodes['offline-status-filter'].value = '';
  h.events['linknest:offline-identity-change'](); await settle();
  assert.equal(h.nodes['offline-result-count'].textContent, '1 links');
  await h.store.invalidate();
  h.events['linknest:offline-identity-change'](); await settle();
  assert.equal(h.nodes['offline-result-count'].textContent, '0 links');
  h.events['linknest:offline-invalidated']();
  assert.match(h.nodes['offline-library-summary'].textContent, /No downloaded/);
  h.nodes['offline-retry'].listeners.click(); assert.equal(h.calls.at(-1)[0], 'reload');
});

test('settings download, refresh, persistence and removal use explicit clicks with honest feedback', async () => {
  const h = load([response({ user: { id: 'owner' } }), response({ ...snapshot, complete: true, total: 1 })], { page: 'login' });
  await h.events.DOMContentLoaded(); await settle();
  assert.equal(h.nodes['offline-library-remove'].disabled, true);
  await h.nodes['offline-library-download'].listeners.click(); await settle();
  assert.equal(h.nodes['offline-library-download'].textContent, 'Refresh download');
  assert.match(h.nodes['offline-library-message'].textContent, /Library downloaded/);
  await h.nodes['offline-library-persist'].listeners.click(); await settle();
  assert.match(h.nodes['offline-library-message'].textContent, /declined/);
  await h.nodes['offline-library-remove'].listeners.click(); await settle();
  assert.match(h.nodes['offline-library-message'].textContent, /Pending captures kept/);
  await h.nodes['offline-library-persist'].listeners.click(); await settle();
  assert.match(h.nodes['offline-library-message'].textContent, /Download your library first/);
});

test('offline download and failed storage show retry feedback without exposing data', async () => {
  const h = load([], { page: 'offline-library', online: false });
  await h.events.DOMContentLoaded(); await settle();
  await h.nodes['offline-library-download'].listeners.click(); await settle();
  assert.match(h.nodes['offline-library-message'].textContent, /Connect and sign in/);
  h.store.readLibrary = async () => { throw new Error('Quota'); };
  h.events['linknest:offline-library-change'](); await settle();
  assert.match(h.nodes['offline-library-summary'].textContent, /No downloaded/);
});

test('persistent storage can be granted, and empty matching titles remain safe', async () => {
  const h = load([], { page: 'login', snapshot: { ...snapshot, links: [{ ...snapshot.links[0], title: '', notes: '', saveReason: '' }] }, persistent: true });
  await h.events.DOMContentLoaded(); await settle();
  await h.nodes['offline-library-persist'].listeners.click(); await settle();
  assert.match(h.nodes['offline-library-message'].textContent, /protect storage/);
});

test('downloads only after online identity verification, using owner header and generation', async () => {
  const snapshot = { schemaVersion: 1, userId: 'owner', links: [], total: 0, complete: true, downloadedAt: new Date().toISOString() };
  const { api, calls } = load([response({ user: { id: 'owner' } }), response(snapshot)]);
  await api.download();
  assert.deepEqual(calls.map(call => call[0]), ['/api/me', 'verify', '/api/links/offline-snapshot', 'replace']);
  assert.equal(calls[2][1].headers['X-LinkNest-User-ID'], 'owner');
  assert.equal(calls[3][1].generation, 1);
});

test('known authentication failure invalidates data before refusing download', async () => {
  for (const status of [401, 409]) {
    const { api, calls } = load([response({ user: { id: 'owner' } }), response({ error: 'Account changed' }, status)]);
    await assert.rejects(api.download(), /Account changed|Authentication/);
    assert.equal(calls.at(-1)[0], 'invalidate');
    assert.equal(calls.some(call => call[0] === 'replace'), false);
  }
});

test('network and server failure never replace previous download', async () => {
  for (const failure of [new TypeError('Network offline'), response({ error: 'Unavailable' }, 503)]) {
    const { api, calls } = load([response({ user: { id: 'owner' } }), failure]);
    await assert.rejects(api.download());
    assert.equal(calls.some(call => call[0] === 'replace'), false);
    assert.equal(calls.some(call => call[0] === 'invalidate'), false);
  }
});

test('identity verification rejects unauthorized or malformed identity without rebinding', async () => {
  for (const result of [response({}, 401), response({ user: {} }), response({}, 503)]) {
    const { api, calls } = load([result]);
    await assert.rejects(api.verifyOnlineIdentity());
    assert.equal(calls.some(call => call[0] === 'verify'), false);
  }
});
