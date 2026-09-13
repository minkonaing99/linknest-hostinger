'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../views/index.html'), 'utf8');
const editorHtml = fs.readFileSync(path.join(__dirname, '../views/editor.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/home.js'), 'utf8');
const shared = fs.readFileSync(path.join(__dirname, '../public/js/shared.js'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '../public/js/editor.js'), 'utf8');
const editorRelated = fs.readFileSync(path.join(__dirname, '../public/js/editor-related.js'), 'utf8');
const editorImport = fs.readFileSync(path.join(__dirname, '../public/js/editor-import.js'), 'utf8');
const browse = fs.readFileSync(path.join(__dirname, '../public/js/browse.js'), 'utf8');

describe('homepage workflow', () => {
  it('orders review, recent links, then secondary measurement', () => {
    const review = html.indexOf('id="review-links"');
    const recent = html.indexOf('id="recent-links"');
    const measurement = html.indexOf('id="weekly-summary"');

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

  it('shows the in-app weekly summary', () => {
    assert.match(html, /id="weekly-summary"/);
    assert.match(html, /id="weekly-saved"/);
    assert.match(html, /id="weekly-reviewed"/);
    assert.match(html, /id="weekly-useful"/);
    assert.match(html, /id="weekly-revisit"/);
    assert.match(html, /id="weekly-oldest"/);
    assert.match(script, /function renderWeeklySummary\(weekly\)/);
    assert.match(script, /weekly\.oldestUnresolved/);
    assert.doesNotMatch(script, /weeklySummary\.innerHTML/);
    assert.match(script, /updateHomeUnreadBadge\(stats\.unread\)/);
    assert.match(shared, /!\['home', 'login', 'offline'\]\.includes\(document\.body\.dataset\.page\)/);
  });

  it('does not request protected badge data from public pages', () => {
    assert.match(shared, /!\['home', 'login', 'offline'\]\.includes\(document\.body\.dataset\.page\)/);
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
    assert.match(editorImport, /api\/links\/import-preview/);
    assert.match(editorImport, /links\.slice\(offset, offset \+ 100\)/);
    assert.match(editorImport, /MAX_IMPORT_FILE_BYTES = 512_000_000/);
  });

  it('manages related links only while editing', () => {
    assert.match(editorHtml, /id="related-links"[^>]*hidden/);
    assert.match(editorHtml, /type="search"[^>]*id="related-search"/);
    assert.match(editorHtml, /id="related-status"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(editorHtml, /id="related-add-toggle"[^>]*aria-controls="related-search-panel"[^>]*aria-expanded="false"/);
    assert.match(editorRelated, /api\/links\/\$\{encodeURIComponent\(linkId\)\}\/related/);
    assert.match(editorRelated, /limit: '10'/);
    assert.match(editorRelated, /relatedLinks\.slice\(0, 3\)/);
    assert.match(editorRelated, /requestId !== searchRequest/);
    assert.doesNotMatch(editorRelated, /innerHTML/);
    assert.doesNotMatch(editorRelated, /DELETE.*api\/links\/\$\{encodeURIComponent\(relatedId\)\}(?!\/)/);
  });

  it('previews every import source before chunked confirmation', () => {
    assert.match(editorHtml, /id="json-file"[^>]*accept="\.json,application\/json"/);
    assert.match(editorHtml, /id="import-preview"[^>]*hidden/);
    assert.match(editorHtml, /id="import-progress"[\s\S]*<progress[^>]*aria-labelledby="import-progress-text"/);
    assert.match(editorHtml, /id="import-progress-text"[^>]*aria-live="polite"/);
    assert.match(editorImport, /import-preview/);
    assert.match(editorImport, /slice\(offset, offset \+ 100\)/);
    assert.match(editorImport, /replaceChildren/);
    assert.doesNotMatch(editorImport, /innerHTML/);
  });
});
