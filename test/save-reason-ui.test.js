'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function loadFunctions(file, names, scope, indent = '') {
  const source = read(file);
  const functions = names.map(name => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(match, `${name} exists`);
    const end = source.indexOf(`\n${indent}}\n`, match.index) + indent.length + 3;
    return source.slice(match.index, end);
  });
  return vm.runInNewContext(`${functions.join('\n')}; ({ ${names.join(', ')} });`, scope);
}

function element() {
  const children = new Map();
  const classes = new Set(['hidden']);
  return {
    value: '', textContent: '', disabled: false, listeners: {}, style: {},
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    setAttribute() {},
    set innerHTML(_value) { throw new Error('Untrusted content must use textContent'); },
  };
}

it('editor capture, editing, and offline draft recovery preserve separate save reasons', async () => {
  const els = Object.fromEntries(['id', 'title', 'url', 'date', 'status', 'tags', 'notes', 'saveReason', 'remindAt', 'formHeading', 'pageTitle', 'submitButton', 'message'].map(name => [name, element()]));
  const item = { id: 'one', url: 'https://example.com', saveReason: 'For my exam', notes: 'Takeaway', tags: [] };
  const { payload, loadForEdit, loadOfflineDraft } = loadFunctions('public/js/editor.js', ['payload', 'loadForEdit', 'loadOfflineDraft'], {
    els, loadedItem: null, queryParam: () => 'one', thailandDate: () => '2026-10-05',
    parseTags: () => [], setMessage() {}, apiFetch: async () => ({ ok: true, json: async () => ({ entry: item }) }),
    window: { LinkNestOffline: { listCaptures: async () => [item] } },
  });
  await loadForEdit();
  assert.equal(els.saveReason.value, item.saveReason);
  els.saveReason.value = '  New intent  ';
  assert.equal(payload().saveReason, 'New intent');
  assert.equal(payload().notes, 'Takeaway');
  await loadOfflineDraft();
  assert.equal(els.saveReason.value, item.saveReason);
});

it('Quick Add snapshots capture intent before requests and carries it through duplicate choices', async () => {
  const quickAddReason = element();
  quickAddReason.value = 'For my project';
  const saved = [], queued = [], duplicates = [];
  let candidates = [];
  const navigator = { onLine: true };
  const { saveQuickAdd } = loadFunctions('public/js/home.js', ['saveQuickAdd'], {
    navigator, quickAddReason, quickAddUrl: element(), quickAddPaste: element(), quickAddMessage: element(),
    quickAddForm: { reset() { quickAddReason.value = ''; } },
    setMessage() {}, thailandDate: () => '2026-10-05',
    fetchTitleMetadata: async url => { quickAddReason.value = 'Changed while loading'; return { url, title: 'Article' }; },
    findDuplicateCandidates: async () => candidates,
    createQuickLink: async draft => saved.push(draft),
    renderQuickAddDuplicates: (_candidates, draft) => duplicates.push(draft),
    shouldQueueOffline: () => false,
    window: { LinkNestOffline: { queueCapture: async draft => queued.push(draft) } },
  });
  await saveQuickAdd('https://example.com');
  assert.equal(saved[0].saveReason, 'For my project');
  candidates = [{ exact: false }];
  quickAddReason.value = 'Duplicate intent';
  await saveQuickAdd('https://example.com');
  assert.equal(duplicates[0].saveReason, 'Duplicate intent');
  navigator.onLine = false;
  quickAddReason.value = 'Offline intent';
  await saveQuickAdd('https://example.com');
  assert.equal(queued[0].saveReason, 'Offline intent');
});

it('Quick Add includes save reason in the actual POST payload', async () => {
  let posted;
  const { createQuickLink } = loadFunctions('public/js/home.js', ['createQuickLink'], {
    apiFetch: async (_url, options) => { posted = JSON.parse(options.body); return { ok: true, json: async () => ({}) }; },
    thailandDate: () => '2026-10-05', quickAddForm: { reset() {} },
    quickAddMessage: element(), setMessage() {}, loadHome: async () => {},
  });
  await createQuickLink({ url: 'https://example.com', title: 'Example', saveReason: 'Study' });
  assert.equal(posted.saveReason, 'Study');
});

it('home and library review cards render reason as plain text, separately from notes', () => {
  const item = { id: 'one', url: 'https://example.com', saveReason: '<img src=x>\nStudy', notes: 'Takeaway', tags: [] };
  const scope = {
    safeHost: () => 'example.com', thailandDate: () => '', applyStatusStyles() {},
    setupReviewSwipe() {}, setupReviewNote() {}, setupAgeWarning() {}, setupUsefulReview() {},
    state: { selected: new Set(), quickFilter: 'review' },
  };
  const node = element();
  const { fillLinkRow } = loadFunctions('public/js/home.js', ['fillLinkRow'], scope);
  fillLinkRow(node, item);
  assert.equal(node.querySelector('.save-reason').textContent, 'Why I saved this: ' + item.saveReason);
  fillLinkRow(node, { ...item, saveReason: '' });
  assert.ok(node.querySelector('.save-reason').classList.contains('hidden'));
  const library = element();
  const { buildRow } = loadFunctions('public/js/browse.js', ['buildRow'], {
    ...scope, template: { content: { cloneNode: () => library } },
  });
  buildRow(item);
  assert.equal(library.querySelector('.save-reason').textContent, 'Why I saved this: ' + item.saveReason);
  assert.equal(library.querySelector('.library-row__notes').textContent, 'Takeaway');
});

it('offline validation, queueing, and sync retain intent and reject invalid reasons', async () => {
  const records = [], posted = [];
  const navigator = { onLine: false };
  const { validateDraft, queueCapture, syncRecord } = loadFunctions('public/js/offline-queue.js', ['validateDraft', 'queueCapture', 'syncRecord'], {
    URL, URLSearchParams, crypto: { randomUUID: () => 'queued' }, navigator,
    storage: { getIdentity: async () => ({ userId: 'owner', generation: 1 }), sameIdentity: (a, b) => a.userId === b.userId && a.generation === b.generation },
    listCaptures: async () => records, saveCapture: async record => records.push(record), notifyChange() {},
    markRecord: async () => {},
    fetch: async (_url, options = {}) => {
      if (options.body) posted.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ candidates: [], entry: { id: 'saved' } }) };
    },
  }, '  ');
  assert.equal(validateDraft({ url: 'https://example.com' }).saveReason, '');
  for (const saveReason of [null, [], 1, 'x'.repeat(501)]) {
    assert.throws(() => validateDraft({ url: 'https://example.com', saveReason }));
  }
  const record = await queueCapture({ url: 'https://example.com', saveReason: '  Offline intent  ' });
  assert.equal(record.saveReason, 'Offline intent');
  assert.equal(records[0].saveReason, record.saveReason);
  assert.equal(await syncRecord(record, { userId: 'owner', generation: 1 }), true);
  assert.equal(posted[0].saveReason, record.saveReason);
});

it('extension capture sends optional reason without merging it into notes', async () => {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let setup, posted;
  vm.runInNewContext(read('extension/popup.js'), {
    URL, document: { getElementById: get },
    chrome: {
      storage: { local: { get: (_keys, callback) => { setup = callback({ serverUrl: 'https://links.example', apiToken: 'fixture' }); } } },
      tabs: { query: async () => [{ url: 'https://example.com', title: 'Example' }] },
      runtime: { openOptionsPage() {} },
    },
    fetch: async (_url, options) => {
      posted = JSON.parse(options.body);
      return { ok: true, json: async () => ({}) };
    },
  });
  await setup;
  // Status markup is existing trusted/escaped extension output, not reason rendering.
  Object.defineProperty(get('status'), 'innerHTML', { set() {} });
  get('save-reason').value = '  Extension intent  ';
  get('notes').value = 'Takeaway';
  await get('save').listeners.click();
  assert.equal(posted.saveReason, 'Extension intent');
  assert.equal(posted.notes, 'Takeaway');
});
