'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, '../extension/reading-position.js');
const script = fs.readFileSync(filename, 'utf8');
const url = 'https://example.com/article';

function page(options = {}) {
  const headings = (options.headings || []).map(({ text, top, hidden, form }) => ({ textContent: text,
    getBoundingClientRect: () => ({ top }), getClientRects: () => hidden ? [] : [1], closest: () => form ? {} : null }));
  const document = { contentType: options.type || 'text/html', scrollingElement: options.noScroll ? null
    : { scrollHeight: options.height ?? 3000 }, querySelector: () => options.unsupported || null,
    querySelectorAll: () => headings };
  const scope = { document, location: { href: options.url || url }, window: { innerHeight: 600,
    scrollY: options.scrollY ?? 1200, scrollTo(value) { scope.destination = value; } } };
  scope.window.top = scope.window;
  vm.runInNewContext(script, scope, { filename });
  return { scope, run: (mode, position) => scope.articlePosition(mode, url, position) };
}

it('saves top, middle, bottom, and zero-height ratios without article body text', () => {
  for (const [scrollY, expected] of [[0, 0], [1200, 0.5], [2400, 1], [9000, 1], [-20, 0]]) {
    const current = page({ scrollY, headings: [{ text: '  Chapter\n two ', top: -50 }] });
    const result = current.run('save');
    assert.equal(result.position.ratio, expected);
    assert.equal(result.position.anchor, 'Chapter two');
    assert.equal(result.position.offset, -50);
    assert.equal(result.position.scrollHeight, 2400);
    assert.equal(result.url, url);
  }
  assert.equal(page({ height: 600 }).run('save').position.ratio, 0);
  assert.equal(page({ headings: [{ text: 'x'.repeat(201), top: 0 }] }).run('save').position.anchor, '');
});

it('resumes a unique heading with saved viewport offset and clamps within current document', () => {
  const current = page({ headings: [{ text: 'Chapter two', top: 300 }] });
  const result = current.run('resume', { ratio: 0.5, offset: -50, anchor: 'Chapter two', scrollHeight: 2400 });
  assert.equal(current.scope.destination.top, 1550);
  assert.equal(current.scope.destination.behavior, 'instant');
  assert.equal(result.approximate, false);
  const end = page({ headings: [{ text: 'End', top: 5000 }] });
  end.run('resume', { ratio: 1, offset: 0, anchor: 'End', scrollHeight: 2400 });
  assert.equal(end.scope.destination.top, 2400);
});

it('missing or ambiguous heading and changed height use approximate feedback', () => {
  for (const headings of [[], [{ text: 'Repeat', top: 100 }, { text: 'Repeat', top: 200 }]]) {
    const current = page({ height: 5000, headings });
    const result = current.run('resume', { ratio: 0.5, offset: 0, anchor: 'Repeat', scrollHeight: 2400 });
    assert.equal(current.scope.destination.top, 2200);
    assert.equal(result.approximate, true);
  }
  const changed = page({ height: 5000, headings: [{ text: 'Unique', top: 10 }] });
  assert.equal(changed.run('resume', { ratio: 0.5, offset: 0, anchor: 'Unique', scrollHeight: 2400 }).approximate, true);
});

it('rejects navigation, PDF/embedded/feed pages, and invalid resume data before scrolling', () => {
  for (const options of [{ url: 'https://other.example/' }, { type: 'application/pdf' },
    { unsupported: {} }, { noScroll: true }]) {
    const current = page(options);
    assert.ok(current.run('save').error);
    assert.ok(current.run('resume', {}).error);
    assert.equal(current.scope.destination, undefined);
  }
  const current = page();
  assert.ok(current.run('resume', { ratio: 2, offset: 0, anchor: '', scrollHeight: 2400 }).error);
  assert.equal(current.scope.destination, undefined);
});

async function popup(options = {}) {
  const elements = Object.fromEntries(['save-position', 'resume-reading'].map(id => [id, {
    disabled: true, listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; },
  }]));
  const state = { busy: false, messages: [], requests: [], injections: [] };
  const tab = { id: 7, url: options.url || url };
  const chrome = {
    tabs: { query: async () => options.noTab ? [] : [tab], get: async () => ({ ...tab, url: options.navigated || tab.url }) },
    scripting: { executeScript: async request => {
      state.injections.push(request);
      if (options.injectionError) throw new Error('Restricted page');
      return options.results || [{ frameId: 0, documentId: 'document-one', result: request.args[0] === 'save'
        ? { url: tab.url, position: { ratio: 0.5, offset: -50, anchor: 'Chapter two', scrollHeight: 2400 } }
        : { url: tab.url, approximate: options.approximate || false } }];
    } },
  };
  const fetch = async (target, request) => {
    state.requests.push({ target, request });
    if (options.fetch) return options.fetch(target, request);
    return { ok: true, json: async () => target.includes('/lookup?')
      ? { entry: options.unsaved ? null : { id: 'one', url } }
      : { position: options.missing ? null : { url, ratio: 0.5, offset: -50, anchor: 'Chapter two', scrollHeight: 2400 } } };
  };
  const scope = { chrome, fetch, AbortSignal, URL, document: { getElementById: id => elements[id] },
    setBusy(value) { state.busy = value; Object.values(elements).forEach(element => { element.disabled = value; }); },
    showStatus(type, message) { state.messages.push({ type, message }); },
    escapeHtml: text => String(text).replace(/</g, '&lt;'), isBusy: () => state.busy };
  vm.runInNewContext(script, scope, { filename });
  scope.initReadingPosition('https://links.example', 'test-token', () => state.busy);
  return { state, elements, click: id => elements[id].listeners.click() };
}

it('popup injects only on explicit action and never passes credentials into page', async () => {
  const current = await popup();
  assert.equal(current.state.requests.length, 0);
  assert.equal(current.state.injections.length, 0);
  await current.click('save-position');
  assert.equal(current.state.requests.length, 2);
  assert.match(current.state.requests[0].target, /\/api\/links\/lookup\?url=/);
  const put = current.state.requests[1];
  assert.equal(put.request.method, 'PUT');
  assert.equal(put.request.headers.Authorization, 'Bearer test-token');
  assert.equal(JSON.parse(put.request.body).url, url);
  const injection = current.state.injections[0];
  assert.equal(injection.world, 'ISOLATED');
  assert.equal(injection.target.tabId, 7);
  assert.equal(injection.target.allFrames, undefined);
  assert.doesNotMatch(JSON.stringify(injection.args), /test-token|links.example/);
  assert.equal(current.state.messages.at(-1).type, 'ok');
  assert.equal(current.state.busy, false);
});

it('resume requests position and reports approximate fallback', async () => {
  const current = await popup({ approximate: true });
  await current.click('resume-reading');
  assert.match(current.state.requests[1].target, /one\/reading-position\?url=/);
  assert.equal(current.state.injections[0].args[0], 'resume');
  assert.match(current.state.messages.at(-1).message, /approximate/i);
  assert.equal(current.state.busy, false);
});

it('unsaved, missing position, unsupported, and navigated pages give actionable feedback', async () => {
  for (const options of [{ unsaved: true }, { missing: true }, { noTab: true },
    { url: 'chrome://settings' }, { url: 'https://chromewebstore.google.com/detail/x' },
    { navigated: 'https://other.example/' }]) {
    const current = await popup(options);
    await current.click('resume-reading');
    assert.equal(current.state.injections.length, 0);
    assert.equal(current.state.messages.at(-1).type, 'err');
    assert.equal(current.state.busy, false);
  }
});

it('network, revoked token, page error, and injection failure restore controls safely', async () => {
  for (const options of [{ injectionError: true }, { results: [] },
    { results: [{ frameId: 0, result: { error: 'Page changed' } }] },
    { fetch: async () => { throw new Error('<img src=x>'); } },
    { fetch: async () => ({ ok: false, json: async () => ({ error: 'Unauthorized' }) }) }]) {
    const current = await popup(options);
    await current.click('save-position');
    assert.equal(current.state.messages.at(-1).type, 'err');
    assert.doesNotMatch(current.state.messages.at(-1).message, /<img/);
    assert.equal(current.elements['save-position'].disabled, false);
    assert.equal(current.state.busy, false);
  }
});

it('manifest and popup expose explicit reading actions without automatic content scripts', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.equal(manifest.content_scripts, undefined);
  const html = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
  assert.match(html, /id="save-position"/);
  assert.match(html, /id="resume-reading"/);
  assert.match(html, /src="reading-position.js"/);
});

it('ignores form/navigation and hidden headings, and rejects frame or mid-injection navigation', () => {
  const current = page({ headings: [{ text: 'Form secret', top: 0, form: true },
    { text: 'Hidden', top: 0, hidden: true }, { text: 'Article', top: -100 }] });
  assert.equal(current.run('save').position.anchor, 'Article');
  current.scope.window.top = {};
  assert.ok(current.run('save').error);
  const moved = page();
  moved.scope.location.href = 'https://other.example/';
  assert.ok(moved.run('resume', { ratio: 0.5, offset: 0, anchor: '', scrollHeight: 2400 }).error);
  assert.equal(moved.scope.destination, undefined);
});

it('locks competing reading actions and restores controls after a pending request', async () => {
  let finish;
  const current = await popup({ fetch: async target => {
    if (target.includes('/lookup?')) return new Promise(resolve => { finish = resolve; });
    return { ok: true, json: async () => ({ position: {} }) };
  } });
  const pending = current.click('save-position');
  for (let attempt = 0; attempt < 10 && !finish; attempt += 1) await Promise.resolve();
  assert.equal(typeof finish, 'function');
  await current.click('resume-reading');
  assert.equal(current.state.requests.length, 1);
  finish({ ok: true, json: async () => ({ entry: { id: 'one' } }) });
  await pending;
  assert.equal(current.state.injections.length, 1);
  assert.equal(current.state.busy, false);
});

it('actual popup shares busy controls and keeps edited capture URL separate from reading tab', async () => {
  const ids = ['url', 'title', 'tags', 'notes', 'save-reason', 'save', 'paste-save', 'status',
    'main', 'not-configured', 'open-settings', 'save-position', 'resume-reading'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', style: {}, listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; } }]));
  const state = { requests: [], injections: [] };
  let initialized, finish;
  const tab = { id: 7, url, title: 'Article' };
  const chrome = { runtime: { openOptionsPage() {} },
    storage: { local: { get(_keys, callback) { initialized = callback({ serverUrl: 'https://links.example', apiToken: 'test-token' }); } } },
    tabs: { query: async () => [tab], get: async () => tab }, scripting: { executeScript: async request => {
      state.injections.push(request);
      return [{ frameId: 0, result: { url, position: { ratio: 0.5, offset: 0, anchor: '', scrollHeight: 2400 } } }];
    } } };
  const scope = { chrome, URL, AbortSignal, document: { getElementById: id => elements[id] },
    fetch: async (target, request) => {
      state.requests.push({ target, request });
      if (target.includes('/lookup?')) return new Promise(resolve => { finish = resolve; });
      return { ok: true, json: async () => ({ position: {} }) };
    } };
  vm.runInNewContext(script, scope, { filename });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/popup.js'), 'utf8'), scope,
    { filename: path.join(__dirname, '../extension/popup.js') });
  await initialized;
  elements.url.value = 'https://clipboard.example/other';
  const pending = elements['save-position'].listeners.click();
  for (let attempt = 0; attempt < 10 && !finish; attempt += 1) await Promise.resolve();
  assert.equal(typeof finish, 'function');
  assert.equal(elements.save.disabled, true);
  assert.equal(elements['paste-save'].disabled, true);
  await elements.save.listeners.click();
  assert.equal(state.requests.length, 1);
  finish({ ok: true, json: async () => ({ entry: { id: 'one' } }) });
  await pending;
  assert.equal(JSON.parse(state.requests.at(-1).request.body).url, url);
  assert.equal(state.injections[0].args[1], url);
  assert.equal(elements.url.value, 'https://clipboard.example/other');
  assert.equal(elements.save.disabled, false);
});
