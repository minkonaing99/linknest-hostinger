'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(storage = new Map()) {
  let now = 1000, next = 0, reloads = 0;
  const timers = new Map(), requests = [], elements = [];
  const element = tag => {
    const el = { tag, children: [], listeners: {}, classList: { add() {} },
      append(...children) { this.children.push(...children); },
      addEventListener(name, handler) { this.listeners[name] = handler; },
      setAttribute() {}, remove() { this.removed = true; }, contains(target) { return this.children.includes(target); } };
    elements.push(el); return el;
  };
  const window = { LinkNest: { apiFetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body || '{}') });
    return { ok: true, status: 200, json: async () => ({ entries: [], action: null }) };
  }, showToast() {} }, location: { reload() { reloads += 1; } },
  addEventListener() {} };
  const context = { window, document: { body: { dataset: { page: 'browse' }, appendChild() {} }, createElement: element },
    crypto: { randomUUID: () => 'request-id' }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    Date: { now: () => now, parse: Date.parse }, JSON, Math, Number,
    setTimeout: (fn, delay) => { timers.set(++next, { fn, at: now + delay }); return next; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(fs.readFileSync('public/js/undo.js', 'utf8'), context, { filename: require('node:path').resolve('public/js/undo.js') });
  return { window, requests, elements, storage, reloads: () => reloads,
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
    remember(id = 'action-1') { window.LinkNest.rememberUndo({ action: { id, undoExpiresAt: new Date(601000).toISOString() } }, 'Archived'); },
    button: () => elements.filter(el => el.tag === 'button').at(-1), toast: () => elements.filter(el => el.tag === 'div').at(-1) };
}

it('sends one explicit action request and retains undo on no-op', async () => {
  const h = harness(); h.remember();
  await h.window.LinkNest.performAction({ kind: 'status', ids: ['link-1'], status: 'useful', takeaway: 'Insight' });
  assert.deepEqual(h.requests[0], { url: '/api/links/actions', body: { kind: 'status', ids: ['link-1'], status: 'useful', takeaway: 'Insight', requestId: 'request-id' } });
  assert.equal(h.toast().removed, undefined);
});
it('expires after 15 seconds and pauses while hovered or focused', () => {
  const h = harness(); h.remember(); const toast = h.toast();
  h.advance(5000); toast.listeners.mouseenter(); h.advance(20000);
  assert.equal(toast.removed, undefined);
  toast.listeners.focusin(); toast.listeners.mouseleave(); h.advance(20000);
  assert.equal(toast.removed, undefined);
  toast.listeners.focusout({ relatedTarget: null }); h.advance(9999);
  assert.equal(toast.removed, undefined); h.advance(1); assert.equal(toast.removed, true);
});
it('undo reloads canonical state and clears action metadata', async () => {
  const h = harness(); h.remember();
  await h.button().listeners.click();
  assert.equal(h.requests[0].url, '/api/actions/action-1/undo');
  assert.equal(h.reloads(), 1); assert.equal(h.storage.size, 0);
});
it('network failure allows retry and a stale response cannot erase newer undo', async () => {
  const h = harness(); h.remember();
  h.window.LinkNest.apiFetch = async () => { throw new Error('Network unavailable'); };
  await h.button().listeners.click(); assert.equal(h.button().disabled, false);
  let finish;
  h.window.LinkNest.apiFetch = () => new Promise(resolve => { finish = resolve; });
  const pending = h.button().listeners.click(); h.remember('action-2');
  finish({ ok: false, status: 409, json: async () => ({ error: 'Link changed' }) }); await pending;
  assert.equal(h.toast().removed, undefined); assert.match([...h.storage.values()][0], /action-2/);
});
it('older successful undo reloads canonical rows while retaining newer undo metadata', async () => {
  const h = harness(); h.remember(); let finish;
  h.window.LinkNest.apiFetch = () => new Promise(resolve => { finish = resolve; });
  const pending = h.button().listeners.click(); h.remember('action-2');
  finish({ ok: true, json: async () => ({ entries: [] }) }); await pending;
  assert.equal(h.reloads(), 1); assert.match([...h.storage.values()][0], /action-2/);
});
it('restores only metadata across navigation and clears on login', () => {
  const h = harness(); h.remember();
  const value = [...h.storage.values()][0]; assert.doesNotMatch(value, /notes|entries|snapshot/);
  const resumed = harness(h.storage); assert.equal(resumed.button().textContent, 'Undo');
  resumed.window.LinkNest.clearUndo(); assert.equal(h.storage.size, 0);
});

it('terminal conflicts clear undo, request errors retain it, and expiry remains bounded while paused', async () => {
  const h = harness(); h.remember();
  h.window.LinkNest.apiFetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'Offline' }) });
  await h.button().listeners.click(); assert.equal(h.button().disabled, false);
  h.window.LinkNest.apiFetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'Changed' }) });
  await h.button().listeners.click(); assert.equal(h.toast().removed, true);
  h.remember(); h.toast().listeners.mouseenter(); h.advance(600000); assert.equal(h.toast().removed, true);
});

it('validates persisted metadata and does not replace toast on action failure', async () => {
  const h = harness(new Map([['linknest-last-undo', '{broken']])); assert.equal(h.storage.size, 0);
  h.remember(); const toast = h.toast();
  h.window.LinkNest.rememberUndo({ action: { id: 'bad', undoExpiresAt: 'bad' } });
  assert.equal(h.toast(), toast);
  h.window.LinkNest.apiFetch = async () => ({ ok: false, json: async () => ({ error: 'Action rejected' }) });
  await assert.rejects(h.window.LinkNest.performAction({ kind: 'archive', ids: ['link-1'] }), /Action rejected/);
  assert.equal(toast.removed, undefined);
});

it('retries a lost action response once with the same request ID', async () => {
  const h = harness(); const bodies = [];
  h.window.LinkNest.apiFetch = async (url, options) => {
    bodies.push(options.body);
    if (bodies.length === 1) throw new Error('Connection lost after commit');
    return { ok: true, json: async () => ({ entries: [], action: { id: 'committed', undoExpiresAt: new Date(601000).toISOString() } }) };
  };
  await h.window.LinkNest.performAction({ kind: 'archive', ids: ['one'] });
  assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); assert.equal(h.button().textContent, 'Undo');
});

it('library status actions use canonical entries and plain note edits keep the existing endpoint', async () => {
  const script = fs.readFileSync('public/js/browse.js', 'utf8');
  const source = script.slice(script.indexOf('async function updateLinkFields'), script.indexOf('\nfunction updateBulkBar'));
  const calls = [];
  const state = { quickFilter: 'review', links: [{ id: 'one', status: 'saved' }] };
  const window = { LinkNest: { performAction: async fields => { calls.push(fields); return { entries: [{ id: 'one', status: 'useful', notes: 'Takeaway' }] }; },
    apiFetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ entry: { id: 'one', notes: 'Edited' } }) }; }, updateUnreadBadge() {} } };
  const context = vm.createContext({ window, state, fetchPage: async () => {}, encodeURIComponent });
  vm.runInContext(source, context);
  await vm.runInContext("updateLinkFields({ id: 'one' }, { status: 'useful', takeaway: 'Takeaway' })", context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { kind: 'status', ids: ['one'], status: 'useful', takeaway: 'Takeaway' });
  assert.equal(state.links[0].notes, 'Takeaway');
  await vm.runInContext("updateLinkFields({ id: 'one' }, { notes: 'Edited' })", context);
  assert.equal(calls[1].url, '/api/links/one'); assert.equal(state.links[0].notes, 'Edited');
});

it('bulk archive and status use one request and prevent duplicate clicks while pending', async () => {
  const script = fs.readFileSync('public/js/browse.js', 'utf8');
  const source = script.slice(script.indexOf('async function bulkDelete'), script.indexOf('async function loadTagChips'));
  const requests = [], errors = []; let finish, reloads = 0;
  const context = vm.createContext({ state: { selected: new Set(['one', 'two']), page: 1 },
    window: { LinkNest: { performAction: fields => { requests.push(fields); return new Promise(resolve => { finish = resolve; }); }, showToast: text => errors.push(text), updateUnreadBadge() {} } },
    bulkDeleteBtn: {}, bulkStatusSelect: {}, exitSelectMode() {}, fetchPage: async () => { reloads += 1; } });
  vm.runInContext(source, context);
  const pending = vm.runInContext('bulkDelete()', context);
  const duplicate = vm.runInContext('bulkDelete()', context);
  assert.equal(requests.length, 1); finish({}); await pending; await duplicate;
  assert.equal(reloads, 1); assert.equal(requests[0].kind, 'archive');
  const status = vm.runInContext("bulkChangeStatus('unread')", context); finish({}); await status;
  assert.equal(requests[1].status, 'unread');
});
