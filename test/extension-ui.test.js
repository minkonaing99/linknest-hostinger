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

test('extension popup captures an optional plain-text note', () => {
  const html = readExtensionFile('popup.html');
  const script = readExtensionFile('popup.js');
  assert.match(html, /<textarea[^>]+id="notes"[^>]+maxlength="10000"/);
  assert.match(html, /placeholder="Note \(optional\)"/);
  assert.match(script, /document\.getElementById\('notes'\)/);
  assert.match(script, /JSON\.stringify\(\{ url, title, tags, notes \}\)/);
});

test('extension API settings use a rounded settings group', () => {
  const html = readExtensionFile('settings.html');
  assert.match(html, /class="settings-panel"/);
  assert.match(html, /border-radius:\s*20px/);
  assert.match(html, /API connection/);
  assert.match(html, /min-height:\s*44px/);
  assert.match(html, /prefers-reduced-motion/);
});

test('extension never sends API tokens to insecure remote servers', () => {
  for (const name of ['popup.js', 'settings.js']) {
    const script = readExtensionFile(name);
    assert.match(script, /function isSecureServerUrl\(value\)/);
    assert.match(script, /parsed\.username \|\| parsed\.password/);
    assert.match(script, /parsed\.protocol === 'https:'/);
    assert.match(script, /\['localhost', '127\.0\.0\.1', '\[::1\]'\]/);
    assert.match(script, /isSecureServerUrl\(serverUrl\)/);
  }
});
