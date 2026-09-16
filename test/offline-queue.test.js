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
  assert.match(queue, /indexedDB\.open\('linknest-offline', 1\)/);
  assert.match(queue, /protocol !== 'http:' && parsed\.protocol !== 'https:'/);
  assert.match(queue, /records\.length >= 100/);
  assert.match(queue, /crypto\.randomUUID\(\)/);
  assert.match(queue, /transaction\.oncomplete/);
  assert.match(queue, /transaction\.onabort/);
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
  assert.match(sw, /url\.pathname === '\/editor.html'/);
  assert.match(sw, /ignoreSearch: true/);
  assert.match(sw, /res\.ok && !res\.redirected/);
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
