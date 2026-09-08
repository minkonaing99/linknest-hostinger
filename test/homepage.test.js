'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/home.js'), 'utf8');

describe('homepage workflow', () => {
  it('orders review, recent links, then secondary measurement', () => {
    const review = html.indexOf('id="review-links"');
    const recent = html.indexOf('id="recent-links"');
    const measurement = html.indexOf('id="revisit-summary"');

    assert.ok(review > 0);
    assert.ok(recent > review);
    assert.ok(measurement > recent);
    assert.match(html, /id="review-badge"[^>]*aria-label="Review items pending"/);
    assert.match(html, /href="\/browse\.html\?review=1"/);
  });

  it('loads review queue, five newly saved links, and revisit stats', () => {
    assert.match(script, /api\/links\/review/);
    assert.match(script, /api\/links\?limit=5&sort=createdAt&order=desc/);
    assert.match(script, /api\/stats/);
    assert.match(script, /api\/links\/\$\{encodeURIComponent\(item\.id\)\}\/opened/);
    assert.match(script, /editor\.html\?id=\$\{encodeURIComponent\(item\.id\)\}/);
    assert.match(script, /Building baseline/);
  });
});
