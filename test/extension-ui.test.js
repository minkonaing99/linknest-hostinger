const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readExtensionFile = name => fs.readFileSync(path.join(__dirname, '..', 'extension', name), 'utf8');

test('extension popup uses rounded grouped iOS-style controls', () => {
  const html = readExtensionFile('popup.html');
  assert.match(html, /class="capture-panel"/);
  assert.match(html, /border-radius:\s*18px/);
  assert.match(html, /min-height:\s*44px/);
  assert.match(html, /:focus-visible/);
});

test('extension API settings use a rounded settings group', () => {
  const html = readExtensionFile('settings.html');
  assert.match(html, /class="settings-panel"/);
  assert.match(html, /border-radius:\s*20px/);
  assert.match(html, /API connection/);
  assert.match(html, /min-height:\s*44px/);
  assert.match(html, /prefers-reduced-motion/);
});
