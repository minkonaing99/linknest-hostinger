'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const editorHtml = fs.readFileSync(path.join(__dirname, '../public/editor.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/home.js'), 'utf8');
const shared = fs.readFileSync(path.join(__dirname, '../public/js/shared.js'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '../public/js/editor.js'), 'utf8');
const browse = fs.readFileSync(path.join(__dirname, '../public/js/browse.js'), 'utf8');

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
    assert.match(script, /api\/links\?limit=5&sort=createdAt&order=desc&youtube=exclude/);
    assert.match(script, /api\/stats/);
    assert.match(script, /api\/links\/\$\{encodeURIComponent\(item\.id\)\}\/opened/);
    assert.match(script, /editor\.html\?id=\$\{encodeURIComponent\(item\.id\)\}/);
    assert.match(script, /Building baseline/);
  });

  it('uses Thailand calendar dates for saving and grouping', () => {
    assert.match(shared, /timeZone: 'Asia\/Bangkok'/);
    assert.match(script, /thailandDateString/);
    assert.match(editor, /thailandDateString/);
    assert.match(browse, /thailandDateString/);
  });

  it('does not redeclare shared globals in page scripts', () => {
    assert.doesNotThrow(() => new vm.Script(`${shared}\n${script}`));
    assert.doesNotThrow(() => new vm.Script(`${shared}\n${editor}`));
  });

  it('uses compact right-side row actions without an Open link', () => {
    assert.doesNotMatch(html, />Open<\/a>/);
    assert.match(html, /class="recent-row__tail"/);
    assert.doesNotMatch(html, /class="pin-toggle"/);
    assert.match(html, /class="row-menu__trigger"/);
    assert.match(html, /class="row-menu__item favorite-button"/);
    assert.doesNotMatch(script, /row-action--open/);
    assert.match(script, /pinned: !item\.pinned/);
    assert.match(script, /\/opened/);
  });

  it('requires an explicit duplicate decision before saving', () => {
    assert.match(shared, /api\/links\/duplicates/);
    assert.match(editor, /Open existing/);
    assert.match(editor, /Merge note/);
    assert.match(editor, /Restore/);
    assert.match(editor, /Save separately/);
    assert.match(editor, /\/merge-note/);
    assert.match(script, /Open existing/);
    assert.match(script, /Restore/);
    assert.match(script, /Save separately/);
    assert.doesNotMatch(editor, /innerHTML/);
    assert.match(html, /id="quick-add-message"[^>]*role="status"[^>]*aria-live="polite"[^>]*tabindex="-1"/);
    assert.match(editorHtml, /id="form-message"[^>]*role="status"[^>]*aria-live="polite"[^>]*tabindex="-1"/);
    assert.match(editor, /aria-label', 'Duplicate choices'/);
    assert.match(script, /aria-label', 'Duplicate choices'/);
    assert.match(editor, /querySelector\('a, button'\)\?\.focus\(\)/);
    assert.match(script, /querySelector\('a, button'\)\?\.focus\(\)/);
  });

  it('offers Markdown and CSV export plus CSV import', () => {
    assert.match(editorHtml, /href="\/api\/links\/export\.md"/);
    assert.match(editorHtml, /href="\/api\/links\/export\.csv"/);
    assert.match(editorHtml, /id="csv-file"[^>]*accept="\.csv,text\/csv"/);
    assert.match(editor, /api\/links\/import-csv/);
  });
});
