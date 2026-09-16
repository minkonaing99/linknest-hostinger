'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8');

function loadBackground({ storage = {}, fetchImpl = async () => ({ ok: true, status: 201 }) } = {}) {
  const state = { badges: [], colors: [], menu: null, optionsOpened: 0, requests: [] };
  let installed;
  let clicked;
  const chrome = {
    runtime: {
      onInstalled: { addListener(listener) { installed = listener; } },
      openOptionsPage() { state.optionsOpened += 1; },
    },
    contextMenus: {
      create(options) { state.menu = { ...options }; },
      onClicked: { addListener(listener) { clicked = listener; } },
    },
    storage: { local: { get(_keys, callback) { callback({ ...storage }); } } },
    action: {
      setBadgeText(options) { state.badges.push(options.text); },
      setBadgeBackgroundColor(options) { state.colors.push(options.color); },
    },
  };
  const fetch = async (...args) => {
    state.requests.push(args);
    return fetchImpl(...args);
  };
  vm.runInNewContext(script, { chrome, fetch, URL, console });
  return { state, installed, clicked };
}

test('registers a selection-only context menu from the manifest service worker', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.equal(manifest.background.service_worker, 'background.js');

  const background = loadBackground();
  background.installed();
  assert.deepEqual(JSON.parse(JSON.stringify(background.state.menu)), {
    id: 'save-selection',
    title: 'Save selection to Link Nest',
    contexts: ['selection'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
});

test('saves selected text as the existing note field', async () => {
  const background = loadBackground({
    storage: { serverUrl: 'https://links.example.com/', apiToken: 'secret-token' },
  });
  await background.clicked({
    menuItemId: 'save-selection',
    pageUrl: 'https://example.com/article',
    selectionText: '  Important paragraph.  ',
  }, { title: 'Example article' });

  assert.equal(background.state.requests.length, 1);
  const [url, options] = background.state.requests[0];
  assert.equal(url, 'https://links.example.com/api/links');
  assert.equal(options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(options.body), {
    url: 'https://example.com/article',
    title: 'Example article',
    tags: [],
    notes: 'Important paragraph.',
  });
  assert.equal(background.state.badges.at(-1), 'OK');
});

test('shows setup without sending when extension is not configured', async () => {
  const background = loadBackground();
  await background.clicked({
    menuItemId: 'save-selection', pageUrl: 'https://example.com', selectionText: 'Note',
  }, { title: 'Example' });
  assert.equal(background.state.requests.length, 0);
  assert.equal(background.state.optionsOpened, 1);
  assert.equal(background.state.badges.at(-1), 'SETUP');
});

test('rejects invalid input and reports duplicate or network failures', async () => {
  const storage = { serverUrl: 'https://links.example.com', apiToken: 'token' };
  const invalid = loadBackground({ storage });
  await invalid.clicked({ menuItemId: 'save-selection', pageUrl: 'chrome://settings', selectionText: 'Note' }, {});
  await invalid.clicked({ menuItemId: 'save-selection', pageUrl: 'https://example.com', selectionText: 'x'.repeat(10001) }, {});
  assert.equal(invalid.state.requests.length, 0);
  assert.equal(invalid.state.badges.at(-1), 'ERR');

  const duplicate = loadBackground({ storage, fetchImpl: async () => ({ ok: false, status: 409 }) });
  await duplicate.clicked({ menuItemId: 'save-selection', pageUrl: 'https://example.com', selectionText: 'Note' }, {});
  assert.equal(duplicate.state.badges.at(-1), 'DUP');

  const failed = loadBackground({ storage, fetchImpl: async () => { throw new Error('offline'); } });
  await assert.doesNotReject(() => failed.clicked({
    menuItemId: 'save-selection', pageUrl: 'https://example.com', selectionText: 'Note',
  }, {}));
  assert.equal(failed.state.badges.at(-1), 'ERR');
});

test('never sends credentials over remote HTTP or stores URL userinfo', async () => {
  const remoteHttp = loadBackground({
    storage: { serverUrl: 'http://links.example.com', apiToken: 'token' },
  });
  await remoteHttp.clicked({
    menuItemId: 'save-selection', pageUrl: 'https://example.com', selectionText: 'Note',
  }, {});
  assert.equal(remoteHttp.state.requests.length, 0);
  assert.equal(remoteHttp.state.optionsOpened, 1);

  const userinfo = loadBackground({
    storage: { serverUrl: 'https://links.example.com', apiToken: 'token' },
  });
  await userinfo.clicked({
    menuItemId: 'save-selection', pageUrl: 'https://user:pass@example.com', selectionText: 'Note',
  }, {});
  assert.equal(userinfo.state.requests.length, 0);

  const localhost = loadBackground({
    storage: { serverUrl: 'http://127.0.0.1:3080', apiToken: 'token' },
  });
  await localhost.clicked({
    menuItemId: 'save-selection', pageUrl: 'http://example.com', selectionText: 'Note',
  }, {});
  assert.equal(localhost.state.requests.length, 1);
});
