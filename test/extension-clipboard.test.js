'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, '../extension/popup.js');
const script = fs.readFileSync(filename, 'utf8');

async function popup(options = {}) {
  const elements = Object.fromEntries(['url', 'title', 'tags', 'notes', 'save-reason', 'save',
    'paste-save', 'status', 'main', 'not-configured', 'open-settings'].map(id => [id, {
    value: '', disabled: false, textContent: '', style: {}, listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; },
  }]));
  const state = { reads: 0, permissions: 0, requests: [], options: 0 };
  let initialized;
  const chrome = {
    runtime: { openOptionsPage() { state.options += 1; } },
    storage: { local: { get(_keys, callback) {
      initialized = callback(options.storage || { serverUrl: 'https://links.example/', apiToken: 'test-token' });
    } } },
    tabs: { query: options.tabs || (async () => [{ url: 'https://tab.example/', title: 'Tab title' }]) },
    permissions: { request: async permission => {
      state.permissions += 1;
      assert.deepEqual(Array.from(permission.permissions), ['clipboardRead']);
      if (options.permissionError) throw new Error('Permission failed');
      return options.granted !== false;
    } },
  };
  const navigator = options.unsupported ? {} : { clipboard: { readText: async () => {
    state.reads += 1;
    if (options.read) return options.read(state.reads);
    return options.text === undefined ? 'https://copied.example/article' : options.text;
  } } };
  const fetch = async (url, request) => {
    state.requests.push({ url, request });
    if (options.fetch) return options.fetch(url, request);
    return { ok: true, status: 201, json: async () => ({ title: 'Copied title' }) };
  };
  vm.runInNewContext(script, { document: { getElementById: id => elements[id] },
    chrome, navigator, fetch, URL, console, AbortSignal: options.abortSignal || AbortSignal }, { filename });
  await initialized;
  return { elements, state, click: id => elements[id].listeners.click?.({ preventDefault() {} }) };
}

it('reads clipboard only on explicit click and reuses capture fields and configured server', async () => {
  const { elements, state, click } = await popup();
  assert.equal(state.reads, 0);
  assert.equal(state.permissions, 0);
  assert.equal(state.requests.length, 0);
  elements.tags.value = 'study, project';
  elements.notes.value = 'Note';
  elements['save-reason'].value = 'For project';
  await click('paste-save');
  assert.equal(state.reads, 1);
  assert.equal(state.permissions, 0);
  assert.equal(state.requests.length, 2);
  assert.match(state.requests[0].url, /^https:\/\/links.example\/api\/fetch-title\?url=/);
  const { url, request } = state.requests[1];
  assert.equal(url, 'https://links.example/api/links');
  assert.equal(request.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(request.body), { url: 'https://copied.example/article',
    title: 'Copied title', tags: ['study', 'project'], notes: 'Note', saveReason: 'For project' });
  assert.equal(elements['paste-save'].disabled, false);
});

it('preserves title for the same tab URL and falls back to copied URL when metadata fails', async () => {
  const same = await popup({ text: '  https://tab.example/  ' });
  await same.click('paste-save');
  assert.equal(same.state.requests.length, 1);
  assert.equal(JSON.parse(same.state.requests[0].request.body).title, 'Tab title');
  const fallback = await popup({ fetch: async (_url, request) => {
    if (!request || request.method !== 'POST') throw new Error('Metadata offline');
    return { ok: true, json: async () => ({}) };
  } });
  await fallback.click('paste-save');
  assert.equal(JSON.parse(fallback.state.requests[1].request.body).title, 'https://copied.example/article');
});

it('rejects empty, multiline, credentials, unsafe protocols, and oversized clipboard before sending', async () => {
  for (const text of ['', ' ', 'https://a.example\nhttps://b.example', 'https://a.example https://b.example',
    'javascript:alert(1)', 'file:///tmp/a', 'chrome://settings', 'https://user:pass@a.example',
    'example.com', 'https://a.example/\u0000', 'https://a.example/' + 'a'.repeat(2048)]) {
    const current = await popup({ text });
    await current.click('paste-save');
    assert.equal(current.state.requests.length, 0, text);
    assert.equal(current.elements.url.value, 'https://tab.example/');
    assert.equal(current.elements.save.disabled, false);
    assert.match(current.elements.status.className, /err/);
  }
});

it('requests optional permission only on the next explicit click; denial leaves manual paste usable', async () => {
  const current = await popup({ granted: false, read: async () => { throw new Error('Denied'); } });
  await current.click('paste-save');
  assert.equal(current.state.permissions, 0);
  assert.match(current.elements['paste-save'].textContent, /Allow clipboard/);
  await current.click('paste-save');
  assert.equal(current.state.permissions, 1);
  assert.equal(current.state.reads, 1);
  assert.equal(current.state.requests.length, 0);
  assert.equal(current.elements.url.disabled, false);
  current.elements.url.value = 'https://manual.example/';
  current.elements.url.listeners.input();
  assert.equal(current.elements.title.value, '');
  await current.click('save');
  assert.equal(JSON.parse(current.state.requests.at(-1).request.body).url, 'https://manual.example/');
});

it('permission grant retries clipboard; unsupported or permission failures restore controls', async () => {
  const granted = await popup({ read: async count => {
    if (count === 1) throw new Error('Denied');
    return 'https://copied.example/article';
  } });
  await granted.click('paste-save');
  await granted.click('paste-save');
  assert.equal(granted.state.permissions, 1);
  assert.equal(granted.state.reads, 2);
  assert.equal(granted.state.requests.length, 2);
  for (const options of [{ unsupported: true }, { permissionError: true, read: async () => { throw new Error('Denied'); } }]) {
    const current = await popup(options);
    await current.click('paste-save');
    await current.click('paste-save');
    assert.equal(current.state.requests.length, 0);
    assert.equal(current.elements.save.disabled, false);
    assert.equal(current.elements['paste-save'].disabled, false);
  }
});

it('duplicate, API failure, and network failure show safe errors and allow retry', async () => {
  for (const status of [409, 400, 500, 0]) {
    const current = await popup({ fetch: async (_url, request) => {
      if (!request || request.method !== 'POST') return { ok: false };
      if (!status) throw new Error('<img src=x>');
      return { ok: false, status, json: async () => ({ error: '<script>fail</script>' }) };
    } });
    await current.click('paste-save');
    assert.match(current.elements.status.className, /err/);
    assert.doesNotMatch(current.elements.status.innerHTML, /<script>|<img/);
    assert.equal(current.elements.save.disabled, false);
    assert.equal(current.elements['paste-save'].disabled, false);
    await current.click('save');
    assert.equal(current.state.requests.filter(item => item.request?.method === 'POST').length, 2);
  }
});

it('blocks repeated actions while pending and snapshots fields before metadata', async () => {
  let finish;
  const current = await popup({ read: () => new Promise(resolve => { finish = resolve; }) });
  current.elements.notes.value = 'Original note';
  const pending = current.click('paste-save');
  assert.equal(current.elements.save.disabled, true);
  await current.click('paste-save');
  await current.click('save');
  assert.equal(current.state.reads, 1);
  finish('https://copied.example/article');
  await pending;
  assert.equal(current.state.requests.filter(item => item.request?.method === 'POST').length, 1);
});

it('missing or unsafe configuration never reads clipboard or sends tokens', async () => {
  for (const storage of [{}, { serverUrl: 'http://remote.example', apiToken: 'test-token' },
    { serverUrl: 'https://user:pass@example.com', apiToken: 'test-token' }]) {
    const current = await popup({ storage });
    await current.click('paste-save');
    await current.click('save');
    assert.equal(current.state.reads, 0);
    assert.equal(current.state.requests.length, 0);
    assert.equal(current.elements['not-configured'].style.display, 'block');
  }
});

it('declares only optional clipboard permission and leaves URL editable', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  assert.ok(manifest.optional_permissions?.includes('clipboardRead'));
  assert.equal(manifest.permissions.includes('clipboardRead'), false);
  const html = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
  assert.match(html, /id="paste-save"/);
  assert.doesNotMatch(html.match(/<input[^>]+id="url"[^>]*>/)[0], /readonly/);
});

it('ordinary tab capture, empty tabs, and unavailable tab access keep manual capture usable', async () => {
  const current = await popup();
  await current.click('save');
  assert.equal(current.state.reads, 0);
  assert.equal(current.state.requests.length, 1);
  assert.equal(JSON.parse(current.state.requests[0].request.body).title, 'Tab title');
  await current.click('open-settings');
  assert.equal(current.state.options, 1);
  for (const tabs of [async () => [], async () => { throw new Error('No tab'); }, async () => [{}]]) {
    const manual = await popup({ tabs });
    manual.elements.url.value = 'https://manual.example/';
    await manual.click('save');
    assert.equal(manual.state.requests.length, 2);
    assert.equal(manual.elements.save.disabled, false);
  }
});

it('metadata fallback and possible duplicate feedback tolerate malformed response fields', async () => {
  for (const title of ['', '   ', 12, undefined]) {
    const current = await popup({ fetch: async (_url, request) => ({
      ok: true, json: async () => request?.method === 'POST'
        ? { duplicateCandidates: [{ id: 'other' }] } : { title },
    }) });
    await current.click('paste-save');
    assert.equal(JSON.parse(current.state.requests[1].request.body).title, 'https://copied.example/article');
    assert.match(current.elements.status.className, /dup/);
    assert.match(current.elements.status.innerHTML, /1 possible duplicate/);
  }
  const hostile = await popup({ fetch: async () => ({ ok: true,
    json: async () => ({ duplicateCandidates: { length: '<img src=x>' } }),
  }) });
  await hostile.click('paste-save');
  assert.doesNotMatch(hostile.elements.status.innerHTML, /<img/);
});

it('snapshots tags, note, and reason while metadata is pending', async () => {
  let finish;
  const current = await popup({ fetch: async (_url, request) => {
    if (!request?.method) return new Promise(resolve => { finish = resolve; });
    return { ok: true, json: async () => ({}) };
  } });
  current.elements.notes.value = 'Original note';
  const pending = current.click('paste-save');
  for (let attempt = 0; attempt < 10 && !finish; attempt += 1) await Promise.resolve();
  assert.equal(typeof finish, 'function');
  current.elements.notes.value = 'Changed programmatically';
  finish({ ok: true, json: async () => ({ title: 'Resolved title' }) });
  await pending;
  assert.equal(JSON.parse(current.state.requests[1].request.body).notes, 'Original note');
});

it('aborts stalled metadata after five seconds and saves with URL fallback', async () => {
  const controller = new AbortController();
  let started;
  const current = await popup({
    abortSignal: { timeout(milliseconds) { assert.equal(milliseconds, 5000); return controller.signal; } },
    fetch: async (_url, request) => {
      if (request.method === 'POST') return { ok: true, json: async () => ({}) };
      assert.equal(request.signal, controller.signal);
      return new Promise((_resolve, reject) => {
        started = true;
        request.signal.addEventListener('abort', () => reject(new Error('Timeout')), { once: true });
      });
    },
  });
  const pending = current.click('paste-save');
  for (let attempt = 0; attempt < 10 && !started; attempt += 1) await Promise.resolve();
  assert.equal(started, true, 'metadata request uses the timeout signal');
  controller.abort();
  await pending;
  assert.equal(JSON.parse(current.state.requests.at(-1).request.body).title, 'https://copied.example/article');
  assert.equal(current.elements['paste-save'].disabled, false);
});
