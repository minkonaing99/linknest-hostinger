'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, '../public/js/editor-related.js');
const script = fs.readFileSync(filename, 'utf8');
const suggested = { link: { id: 'two', title: '<script>Title', url: 'https://example.com/two' },
  sharedTags: ['<img src=x>'], reason: 'Shares tags: <img src=x>', titleSimilarity: 0.2 };

function element(tag = 'div') {
  return { tag, children: [], listeners: {}, attributes: {}, value: '', hidden: false, disabled: false,
    textContent: '', addEventListener(event, callback) { this.listeners[event] = callback; },
    append(...children) { this.children.push(...children); }, appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = [...children]; },
    setAttribute(key, value) { this.attributes[key] = value; }, focus() { this.focused = true; },
    querySelector(selector) { return this.children.find(child => child.tag === selector)
      || this.children.map(child => child.querySelector(selector)).find(Boolean) || null; },
    set innerHTML(_value) { throw new Error('Unsafe HTML rendering'); },
  };
}

async function fixture(options = {}) {
  const ids = ['related-links', 'related-add-toggle', 'related-search-panel', 'related-search',
    'related-search-results', 'related-list', 'related-view-all', 'related-status',
    'suggestions-list', 'suggestions-status', 'suggestions-retry', 'suggestions-heading'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const state = { requests: [], related: options.related || [], timers: [] };
  const apiFetch = async (target, request = {}) => {
    state.requests.push({ target, request });
    if (options.apiFetch) return options.apiFetch(target, request, state);
    if (request.method === 'POST') {
      state.related = [...state.related, suggested.link];
      return { ok: true, json: async () => ({ link: suggested.link }) };
    }
    return { ok: true, json: async () => target.endsWith('/suggestions')
      ? { suggestions: options.suggestions || [suggested] }
      : target.includes('?') ? { links: [suggested.link] } : { links: state.related } };
  };
  const scope = { URL, URLSearchParams, console,
    document: { getElementById: id => elements[id], createElement: element },
    setTimeout(callback) { state.timers.push(callback); return state.timers.length; }, clearTimeout() {},
    window: { LinkNest: { apiFetch, queryParam: () => options.noId ? null : 'one',
      setMessage(target, text, kind) { target.textContent = text; target.kind = kind; } } },
  };
  vm.runInNewContext(script, scope, { filename });
  await new Promise(resolve => setImmediate(resolve));
  return { state, elements };
}

function buttons(row) { return row.children.flatMap(child => child.tag === 'button' ? [child] : child.children.filter(item => item.tag === 'button')); }

it('loads read-only suggestions with safe text and encoded editor links', async () => {
  const { state, elements } = await fixture();
  assert.equal(state.requests.filter(item => item.request.method === 'POST').length, 0);
  assert.ok(state.requests.some(item => item.target.endsWith('/suggestions')));
  const row = elements['suggestions-list'].children[0];
  assert.ok(row);
  assert.equal(row.children[0].href, '/editor.html?id=two');
  assert.equal(row.children[0].children[0].children[0].textContent, '<script>Title');
  assert.equal(row.children[0].children.at(-1).textContent, suggested.reason);
  assert.deepEqual(buttons(row).map(button => button.textContent), ['Connect', 'Skip for now']);
});

it('connect requires one explicit click and updates actual related list', async () => {
  const { state, elements } = await fixture();
  await buttons(elements['suggestions-list'].children[0])[0].listeners.click();
  const posts = state.requests.filter(item => item.request.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].target, '/api/links/one/related');
  assert.deepEqual(JSON.parse(posts[0].request.body), { relatedId: 'two' });
  assert.equal(elements['related-list'].children.length, 1);
  assert.equal(elements['suggestions-list'].children.length, 0);
  assert.equal(elements['suggestions-heading'].focused, true);
});

it('late initial related response cannot erase a newly confirmed connection', async () => {
  let finish, reads = 0;
  const existing = { id: 'three', title: 'Existing connection', url: 'https://example.com/three' };
  const { elements } = await fixture({ apiFetch: async (target, request) => {
    if (request.method === 'POST') return { ok: true, json: async () => ({ link: suggested.link }) };
    if (target.endsWith('/related')) {
      reads += 1;
      if (reads === 1) return new Promise(resolve => { finish = resolve; });
      return { ok: true, json: async () => ({ links: [existing, suggested.link] }) };
    }
    return { ok: true, json: async () => ({ suggestions: [suggested] }) };
  } });
  await buttons(elements['suggestions-list'].children[0])[0].listeners.click();
  assert.equal(elements['related-list'].children.length, 2);
  finish({ ok: true, json: async () => ({ links: [existing] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['related-list'].children.length, 2);
});

it('drops older suggestion results when a newer refresh succeeds', async () => {
  let finish, count = 0;
  const { elements } = await fixture({ apiFetch: async target => {
    if (target.endsWith('/suggestions')) {
      count += 1;
      if (count === 1) return new Promise(resolve => { finish = resolve; });
      return { ok: true, json: async () => ({ suggestions: [] }) };
    }
    return { ok: true, json: async () => ({ links: [] }) };
  } });
  await elements['suggestions-retry'].listeners.click();
  finish({ ok: true, json: async () => ({ suggestions: [suggested] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['suggestions-list'].children.length, 0);
  assert.match(elements['suggestions-status'].textContent, /No suggested/);
});

it('skip sends no write and persists during page-session refresh with focus restored', async () => {
  const { state, elements } = await fixture();
  await buttons(elements['suggestions-list'].children[0])[1].listeners.click();
  assert.equal(elements['suggestions-list'].children.length, 0);
  assert.equal(elements['suggestions-heading'].focused, true);
  await elements['suggestions-retry'].listeners.click();
  assert.equal(elements['suggestions-list'].children.length, 0);
  assert.equal(state.requests.filter(item => item.request.method === 'POST').length, 0);
});

it('filters already connected suggestions and preserves manual relationship search', async () => {
  const connected = await fixture({ related: [suggested.link] });
  assert.equal(connected.elements['suggestions-list'].children.length, 0);
  const { state, elements } = await fixture();
  elements['related-search'].value = 'Title';
  elements['related-search'].listeners.input();
  await state.timers.at(-1)();
  const result = elements['related-search-results'].children[0];
  await result.listeners.click();
  assert.equal(elements['suggestions-list'].children.length, 0);
  assert.equal(elements['related-list'].children.length, 1);
});

it('reconciles concurrent duplicate connections via GET and never retries POST automatically', async () => {
  const { state, elements } = await fixture({ apiFetch: async (target, request, current) => {
    if (request.method === 'POST') {
      current.related = [suggested.link];
      return { ok: false, status: 409, json: async () => ({ error: 'Links are already related' }) };
    }
    return { ok: true, json: async () => target.endsWith('/suggestions') ? { suggestions: [suggested] } : { links: current.related } };
  } });
  await buttons(elements['suggestions-list'].children[0])[0].listeners.click();
  assert.equal(elements['related-list'].children.length, 1);
  assert.equal(elements['suggestions-list'].children.length, 0);
  assert.equal(state.requests.filter(item => item.request.method === 'POST').length, 1);
});

it('pending and failed Connect guard repeated clicks and restore retry controls', async () => {
  let finish;
  const { state, elements } = await fixture({ apiFetch: async (target, request) => {
    if (request.method === 'POST') return new Promise(resolve => { finish = resolve; });
    return { ok: true, json: async () => target.endsWith('/suggestions') ? { suggestions: [suggested] } : { links: [] } };
  } });
  const connect = buttons(elements['suggestions-list'].children[0])[0];
  const pending = connect.listeners.click();
  assert.equal(buttons(elements['suggestions-list'].children[0])[0].disabled, true);
  await connect.listeners.click();
  assert.equal(state.requests.filter(item => item.request.method === 'POST').length, 1);
  finish({ ok: false, status: 500, json: async () => ({ error: 'Failed to connect' }) });
  await pending;
  assert.equal(buttons(elements['suggestions-list'].children[0])[0].disabled, false);
  assert.equal(elements['suggestions-status'].kind, 'error');
});

it('failed suggestion load offers retry without breaking manual relationships; capture hides section', async () => {
  const { elements } = await fixture({ apiFetch: async target => ({ ok: !target.endsWith('/suggestions'),
    json: async () => ({ error: 'Offline', links: [suggested.link] }) }) });
  assert.equal(elements['related-list'].children.length, 1);
  assert.equal(elements['suggestions-status'].kind, 'error');
  assert.equal(elements['suggestions-retry'].hidden, false);
  assert.equal(typeof elements['related-add-toggle'].listeners.click, 'function');
  assert.equal((await fixture({ noId: true })).state.requests.length, 0);
});

it('manual expand, collapse and removal preserve connections and refresh suggestions', async () => {
  const links = Array.from({ length: 4 }, (_, index) => ({ ...suggested.link, id: `saved-${index}` }));
  const { state, elements } = await fixture({ related: links, apiFetch: async (target, request, current) => {
    if (request.method === 'DELETE') {
      current.related = current.related.filter(link => !target.endsWith(`/${link.id}`));
      return { ok: true, json: async () => ({ removed: true }) };
    }
    return { ok: true, json: async () => target.endsWith('/suggestions')
      ? { suggestions: [suggested] } : { links: current.related } };
  } });
  assert.equal(elements['related-list'].children.length, 3);
  elements['related-view-all'].listeners.click();
  assert.equal(elements['related-list'].children.length, 4);
  elements['related-view-all'].listeners.click();
  assert.equal(elements['related-list'].children.length, 3);
  await buttons(elements['related-list'].children[0])[0].listeners.click();
  assert.equal(state.related.length, 3);
  assert.equal(elements['related-view-all'].hidden, true);
  assert.equal(elements['suggestions-list'].children.length, 1);
});

it('manual search panel toggles focus and excludes current and connected links', async () => {
  const { state, elements } = await fixture({ related: [suggested.link] });
  elements['related-search-panel'].hidden = true;
  elements['related-add-toggle'].listeners.click();
  assert.equal(elements['related-search'].focused, true);
  assert.equal(elements['related-search-panel'].hidden, false);
  elements['related-add-toggle'].listeners.click();
  assert.equal(elements['related-search-panel'].hidden, true);
  elements['related-search'].listeners.input();
  await state.timers.at(-1)();
  elements['related-search'].value = 'already saved';
  elements['related-search'].listeners.input();
  await state.timers.at(-1)();
  assert.equal(elements['related-search-results'].children.length, 0);
  assert.match(elements['related-status'].textContent, /No available links/);
});

it('failed manual removal retains its connection and reports the server error', async () => {
  const fallback = { id: 'saved', title: '', url: 'invalid-url' };
  const { elements } = await fixture({ apiFetch: async (target, request) => ({
    ok: request.method !== 'DELETE', json: async () => request.method === 'DELETE'
      ? { error: 'Removal failed' } : target.endsWith('/suggestions')
        ? { suggestions: [] } : { links: [fallback] },
  }) });
  await buttons(elements['related-list'].children[0])[0].listeners.click();
  assert.equal(elements['related-list'].children.length, 1);
  assert.equal(elements['related-status'].textContent, 'Removal failed');
  assert.equal(elements['related-status'].kind, 'error');
});
