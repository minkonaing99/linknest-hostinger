'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.join(__dirname, '../public/js/editor-history.js');

function element(tag = 'div') {
  return { tag, children: [], listeners: {}, hidden: true, open: false, disabled: false,
    textContent: '', attributes: {}, focused: false,
    addEventListener(type, handler) { this.listeners[type] = handler; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
    set innerHTML(_value) { throw new Error('Unsafe HTML rendering'); },
  };
}

const event = { id: 'one', type: 'marked_useful', occurredAt: '2026-10-05T00:30:00.000Z',
  metadata: { fromStatus: 'unread', toStatus: 'useful', changedFields: ['status', 'notes', 'saveReason'] } };
const response = (events = [event], nextCursor = null) => ({ ok: true, json: async () => ({ events, nextCursor }) });

function fixture(options = {}) {
  const ids = ['link-history', 'history-list', 'history-status', 'history-more', 'history-retry', 'history-summary'];
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const requests = [];
  const apiFetch = async target => {
    requests.push(target);
    return options.apiFetch ? options.apiFetch(target, requests.length) : response();
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Intl, Date, URLSearchParams,
    document: { getElementById: id => options.missing && id === 'link-history' ? null : elements[id], createElement: element },
    window: { LinkNest: { apiFetch, queryParam: () => options.noId ? null : 'a/b',
      setMessage(target, message, kind) { target.textContent = message; target.kind = kind; } } },
  }, { filename });
  return { elements, requests, async open() {
    elements['link-history'].open = true;
    await elements['link-history'].listeners.toggle();
  } };
}

it('history stays collapsed without requests; new capture hides history', async () => {
  const current = fixture();
  assert.equal(current.elements['link-history'].hidden, false);
  assert.equal(current.requests.length, 0);
  current.elements['link-history'].open = false;
  await current.elements['link-history'].listeners.toggle();
  assert.equal(current.requests.length, 0);
  assert.equal(fixture({ noId: true }).elements['link-history'].hidden, true);
  assert.equal(fixture({ missing: true }).requests.length, 0);
});

it('opening loads once with safe compound descriptions and Bangkok timestamp', async () => {
  const current = fixture();
  await current.open();
  await current.open();
  assert.deepEqual(current.requests, ['/api/links/a%2Fb/history?limit=20']);
  const row = current.elements['history-list'].children[0];
  assert.match(row.children[0].textContent, /Marked useful/);
  assert.match(row.children[0].textContent, /unread to useful/);
  assert.match(row.children[0].textContent, /Notes changed/);
  assert.match(row.children[0].textContent, /Save reason changed/);
  assert.match(row.children[1].textContent, /07:30.*Bangkok/);
  assert.equal(row.children[1].dateTime, event.occurredAt);
});

it('load more appends unique events, encodes cursor, and restores focus at end', async () => {
  const current = fixture({ apiFetch: async (_target, count) => count === 1
    ? response([event], 'next+/=') : response([event, { ...event, id: 'two', type: 'note_updated', metadata: {} }]) });
  await current.open();
  assert.equal(current.elements['history-more'].hidden, false);
  await current.elements['history-more'].listeners.click();
  assert.equal(current.requests[1], '/api/links/a%2Fb/history?limit=20&cursor=next%2B%2F%3D');
  assert.equal(current.elements['history-list'].children.length, 2);
  assert.equal(current.elements['history-more'].hidden, true);
  assert.equal(current.elements['history-summary'].focused, true);
});

it('pending pages guard repeated clicks and recover inline failures with retry', async () => {
  let finish;
  const current = fixture({ apiFetch: async (_target, count) => count === 1
    ? new Promise(resolve => { finish = resolve; }) : response([]) });
  const pending = current.open();
  await current.open();
  await current.elements['history-more'].listeners.click();
  assert.equal(current.requests.length, 1);
  assert.equal(current.elements['history-list'].attributes['aria-busy'], 'true');
  finish({ ok: false, json: async () => ({ error: '<script>Offline' }) });
  await pending;
  assert.equal(current.elements['history-status'].textContent, '<script>Offline');
  assert.equal(current.elements['history-retry'].hidden, false);
  await current.elements['history-retry'].listeners.click();
  assert.match(current.elements['history-status'].textContent, /Recording begins/);
  assert.equal(current.elements['history-retry'].hidden, true);
  assert.equal(current.elements['history-summary'].focused, true);
});

it('failed later page preserves events and retries same cursor', async () => {
  const current = fixture({ apiFetch: async (_target, count) => count === 1 ? response([event], 'page-two')
    : count === 2 ? Promise.reject(new Error('Offline')) : response([{ ...event, id: 'two' }]) });
  await current.open();
  await current.elements['history-more'].listeners.click();
  assert.equal(current.elements['history-list'].children.length, 1);
  await current.elements['history-retry'].listeners.click();
  assert.equal(current.requests[1], current.requests[2]);
  assert.equal(current.elements['history-list'].children.length, 2);
});

it('descriptions cover event types without rendering note or reason contents', async () => {
  const types = ['saved', 'imported', 'note_updated', 'status_changed', 'snoozed', 'archived', 'restored',
    'useful_review_completed', 'save_reason_updated', 'details_updated', 'unknown'];
  const events = types.map((type, index) => ({ ...event, id: String(index), type,
    metadata: { changedFields: ['title'], remindAt: '2026-10-06T00:00:00.000Z', note: '<img>', saveReason: '<script>' } }));
  const current = fixture({ apiFetch: async () => response(events) });
  await current.open();
  const labels = current.elements['history-list'].children.map(row => row.children[0].textContent);
  assert.ok(labels.some(label => /Snoozed until 0?6 Oct 2026.*07:00.*Bangkok/.test(label)));
  assert.ok(labels.some(label => /Useful review completed/.test(label)));
  assert.ok(labels.some(label => /Details updated/.test(label)));
  assert.ok(labels.every(label => !label.includes('<img>') && !label.includes('<script>')));
});
