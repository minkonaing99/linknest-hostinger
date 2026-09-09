const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function pngSize(file) {
  const data = fs.readFileSync(path.join(root, file));
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test('approved logo source produces every required square icon size', () => {
  const expected = {
    'public/img/logo-source.png': 1254,
    'public/img/logo-mark.png': 64,
    'public/img/apple-touch-icon.png': 180,
    'public/img/icon-192.png': 192,
    'public/img/icon-512.png': 512,
    'extension/icons/icon-16.png': 16,
    'extension/icons/icon-48.png': 48,
    'extension/icons/icon-128.png': 128,
  };

  for (const [file, size] of Object.entries(expected)) {
    assert.deepEqual(pngSize(file), [size, size], file);
  }
});
