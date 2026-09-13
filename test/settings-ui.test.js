'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../views/settings.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

it('keeps Settings navigation focused and spaces token controls', () => {
  const nav = html.match(/<nav class="segmented-nav settings-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(nav, />Home<\/a>/);
  assert.match(nav, />Settings<\/a>/);
  assert.doesNotMatch(nav, />Browse<\/a>/);
  assert.doesNotMatch(nav, />Add Link<\/a>/);
  assert.match(html, /class="surface surface--soft settings-section"/);
  assert.match(css, /\.settings-nav\s*\{[^}]*grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.settings-section\s*\{[^}]*padding:\s*20px/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.settings-section\s*\{[^}]*padding:\s*16px/);
});

it('keeps protected Settings HTML outside the public web root', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../public/settings.html')), false);
  for (const file of ['index.html', 'browse.html', 'editor.html', 'archive.html', 'login.html']) {
    assert.equal(fs.existsSync(path.join(__dirname, '../public', file)), false);
  }
});
