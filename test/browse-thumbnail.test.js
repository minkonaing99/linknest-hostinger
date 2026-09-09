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
  assert.match(html, /decoding="async"/);
  assert.match(html, /fetchpriority="low"/);
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

it('uses a compact YouTube media list on mobile and tablet only', () => {
  assert.match(script, /is-youtube-view/);
  assert.match(css, /body\.is-youtube-view \.library-row \{\s+grid-template-columns: minmax\(0, 1fr\) 32px/);
  assert.match(css, /@media \(max-width: 1024px\)[\s\S]*body\.is-youtube-view \.library-row\.has-thumbnail/);
  assert.match(css, /body\.is-youtube-view \.link-thumbnail[\s\S]*aspect-ratio: 16 \/ 9/);
  assert.match(css, /body\.is-youtube-view \.library-row__title[\s\S]*-webkit-line-clamp: 2/);
  assert.match(css, /body\.is-youtube-view \.library-row__status[\s\S]*display: none/);
  assert.match(css, /content-visibility: auto/);
});

it('keeps Favorite inside the three-dot menu', () => {
  assert.doesNotMatch(html, /class="pin-toggle"/);
  assert.match(html, /class="row-menu__item favorite-button"/);
  assert.match(script, /favoriteButton\.textContent = item\.pinned \? 'Remove from Favorites' : 'Add to Favorites'/);
  const togglePinned = script.match(/async function togglePinned[\s\S]*?\n}/)[0];
  assert.doesNotMatch(togglePinned, /fetchPage/);
  assert.match(togglePinned, /item\.pinned = nextPinned/);
  assert.match(togglePinned, /JSON\.stringify\(\{ pinned: nextPinned \}\)/);
});

it('lets an open row menu paint above neighboring rows', () => {
  assert.match(css, /\.library-row\.is-menu-open \{[^}]*content-visibility: visible;/);
});
