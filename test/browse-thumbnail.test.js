'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/browse.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/browse.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

it('renders safe YouTube thumbnails in Browse with text-only fallback', () => {
  assert.match(html, /class="link-thumbnail hidden"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /referrerpolicy="no-referrer"/);
  assert.match(script, /item\.thumbnailUrl/);
  assert.match(script, /addEventListener\('error'/);
  assert.match(script, /rowArticle\.classList\.remove\('has-thumbnail'\)/);
  assert.match(css, /height: auto;\s+aspect-ratio: 16 \/ 9;/);
});

it('keeps YouTube links in a dedicated Browse tab', () => {
  assert.match(html, /data-filter="youtube">YouTube/);
  assert.match(script, /params\.set\('youtube', 'exclude'\)/);
  assert.match(script, /params\.set\('youtube', 'only'\)/);
  assert.match(script, /get\('youtube'\)/);
  assert.match(script, /%3Fyoutube%3D1/);
  assert.doesNotMatch(script, /state\.quickFilter === 'youtube' \? 'YouTube'/);
});
