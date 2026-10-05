'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('shared 401 handler clears downloaded data before redirecting', async () => {
  const source = fs.readFileSync('public/js/shared.js', 'utf8').split('function thailandDateString')[0];
  const actions = [];
  const context = vm.createContext({ window: { LinkNest: { clearUndo() {} },
    LinkNestOfflineStore: { invalidate: async () => actions.push('clear') }, location: { set href(value) { actions.push(value); } } },
    fetch: async () => ({ status: 401 }), Error });
  vm.runInContext(source, context);
  await assert.rejects(vm.runInContext("linkNestApiFetch('/api/links')", context), /Authentication/);
  assert.deepEqual(actions, ['clear', '/login.html']);
});

test('login verifies persisted generation and owner before successful redirect', async () => {
  const actions = [], elements = {};
  for (const id of ['login-form', 'username', 'password', 'login-message']) elements[id] = { value: 'input', focus() {}, addEventListener(name, handler) { this[name] = handler; } };
  const expected = { userId: null, generation: 2 };
  const context = {
    document: { getElementById: id => elements[id] },
    window: { location: { set href(value) { actions.push(value); } }, LinkNestOfflineStore: {
      getIdentity: async () => expected,
      verifyIdentity: async (id, token) => { actions.push(['verify', id, token.generation]); },
      invalidate: async () => actions.push('clear'),
    } },
    fetch: async url => ({ ok: url === '/api/login', status: url === '/api/login' ? 200 : 401, json: async () => ({ user: { id: 'new-user' } }) }), Error,
  };
  vm.runInNewContext(fs.readFileSync('public/js/login.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  actions.length = 0;
  await elements['login-form'].submit({ preventDefault() {} });
  assert.deepEqual(actions, [['verify', 'new-user', 2], '/browse.html']);
});

test('unavailable local storage never prevents server login', async () => {
  const actions = [], elements = {};
  for (const id of ['login-form', 'username', 'password', 'login-message']) elements[id] = { value: 'input', focus() {}, addEventListener(name, handler) { this[name] = handler; } };
  const context = {
    document: { getElementById: id => elements[id] },
    window: { location: { set href(value) { actions.push(value); } }, LinkNestOfflineStore: {
      getIdentity: async () => { throw new Error('Storage denied'); },
    } },
    fetch: async url => { actions.push(url); return { ok: url === '/api/login', status: 503, json: async () => ({ user: { id: 'new-user' } }) }; }, Error,
  };
  vm.runInNewContext(fs.readFileSync('public/js/login.js', 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve)); actions.length = 0;
  await elements['login-form'].submit({ preventDefault() {} });
  assert.deepEqual(actions, ['/api/login', '/browse.html']);
});

test('unavailable local storage never prevents server logout', async () => {
  const source = fs.readFileSync('public/js/shared.js', 'utf8');
  const object = source.slice(source.indexOf('window.LinkNest ='), source.indexOf('\nfunction renderUnreadBadge'));
  const actions = [];
  const window = { addEventListener() {}, LinkNestOfflineStore: { invalidate: async () => { throw new Error('Storage denied'); } },
    location: { set href(value) { actions.push(value); } } };
  const context = vm.createContext({ window, navigator: {}, fetch: async url => actions.push(url), linkNestApiFetch() {}, thailandDateString() {} });
  vm.runInContext(object, context);
  window.LinkNest.showToast = () => actions.push('warning');
  await window.LinkNest.logout();
  assert.deepEqual(actions, ['warning', '/api/logout', '/login.html']);
});

test('cross-tab invalidation hides protected page contents without interrupting its own logout', () => {
  const source = fs.readFileSync('public/js/shared.js', 'utf8');
  const object = source.slice(source.indexOf('window.LinkNest ='), source.indexOf('\nfunction renderUnreadBadge'));
  let listener;
  const window = { addEventListener(name, handler) { listener = handler; }, location: {} };
  const document = { body: { dataset: { page: 'editor' } } };
  vm.runInNewContext(object, { window, document, linkNestApiFetch() {}, thailandDateString() {} });
  window.LinkNest.loggingOut = true; listener(); assert.equal(window.location.href, undefined);
  window.LinkNest.loggingOut = false; listener(); assert.equal(window.location.href, '/login.html'); assert.equal(document.body.hidden, true);
});
