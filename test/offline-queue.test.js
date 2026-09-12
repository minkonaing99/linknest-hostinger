'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
