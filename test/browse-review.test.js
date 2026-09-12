'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/browse.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/browse.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

it('shows finite review progress and completion state', () => {
  assert.match(html, /id="review-progress"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(script, /reviewSession: null/);
  assert.match(script, /resolved: new Set\(\)/);
  assert.match(script, /Review \$\{current\} of \$\{session\.total\}/);
  assert.match(script, /Review complete/);
  assert.match(script, /You made a decision on all/);
});

it('asks for a YouTube decision before opening a video', () => {
  assert.match(script, /document\.createElement\('dialog'\)/);
  assert.match(script, /Open video/);
  assert.match(script, /Open and archive/);
  assert.match(script, /Share/);
  assert.match(script, /state\.quickFilter === 'youtube'/);
  assert.match(script, /navigator\.share/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /state\.links = state\.links\.filter/);
  assert.match(script, /const tracked = openYoutubeVideo\(item\)[\s\S]{0,180}await tracked[\s\S]{0,180}method: 'DELETE'/);
  assert.match(script, /aria-haspopup', 'dialog'/);
  assert.match(script, /error\.name === 'AbortError'[\s\S]{0,180}navigator\.clipboard\.writeText/);
  assert.match(css, /\.youtube-action-sheet::backdrop/);
  assert.match(css, /@media \(max-width: 1024px\)[\s\S]*\.youtube-action-sheet/);
});

it('advances only after meaningful review decisions', () => {
  assert.match(script, /resolveReviewItem\(item\.id\)/);
  assert.match(script, /Note unchanged/);
  assert.match(script, /hasMeaningfulRevisit\(updated\)/);
  assert.match(script, /This note is saved, but it is too early to count as reviewed/);
  assert.doesNotMatch(script, /snooze[\s\S]{0,250}resolveReviewItem/);
  assert.doesNotMatch(script, /opened[\s\S]{0,250}resolveReviewItem/);
});

it('discards stale results when the quick filter changes', () => {
  assert.match(script, /requestId: 0/);
  assert.match(script, /const requestedFilter = state\.quickFilter/);
  assert.match(script, /requestId !== state\.requestId \|\| requestedFilter !== state\.quickFilter/);
  assert.match(script, /buildApiParams\(page, requestedFilter\)/);
});

it('supports accessible inline notes during review', () => {
  assert.match(html, /class="review-note-panel hidden"/);
  assert.match(html, /class="[^"]*review-note-input[^"]*"[^>]*maxlength="10000"/);
  assert.match(html, /class="[^"]*review-note-save[^"]*"/);
  assert.match(html, /class="[^"]*review-note-cancel[^"]*"/);
  assert.match(script, /reviewNoteInput\.focus\(\)/);
  assert.match(script, /event\.key === 'Escape'/);
});

it('supports focused review keyboard shortcuts without intercepting typing', () => {
  assert.match(script, /linkList\.setAttribute\('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp N O'\)/);
  assert.match(script, /linkList\.tabIndex = reviewing \? 0 : -1/);
  assert.match(script, /function handleReviewShortcut\(event\)/);
  assert.match(script, /state\.quickFilter !== 'review' \|\| event\.repeat/);
  assert.match(script, /INPUT\|TEXTAREA\|SELECT/);
  assert.match(script, /ArrowLeft: '\.delete-button'/);
  assert.match(script, /ArrowRight: '\.mark-useful-button'/);
  assert.match(script, /ArrowUp: '\.snooze-week-button'/);
  assert.match(script, /n: '\.edit-link'/);
  assert.match(script, /o: '\.library-row__title'/);
  assert.match(script, /event\.preventDefault\(\);[\s\S]{0,80}control\.click\(\)/);
  assert.match(script, /event\.target\.closest\('\.library-row'\) \|\| linkList\.querySelector\('\.library-row'\)/);
  assert.match(script, /row\.getAttribute\('aria-busy'\) === 'true'/);
  assert.match(script, /function beginRowAction\(row\)/);
  assert.match(script, /function endRowAction\(row\)/);
  assert.match(script, /linkList\.addEventListener\('keydown', handleReviewShortcut\)/);
  assert.match(script, /if \(requestedFilter === 'review'\) linkList\.focus\(\{ preventScroll: true \}\)/);
});

it('supports touch and pen review swipes while preserving page scroll', () => {
  assert.match(script, /function setupReviewSwipe\(row\)/);
  assert.match(script, /event\.pointerType !== 'touch' && event\.pointerType !== 'pen'/);
  assert.match(script, /a, button, input, textarea, select, label, \[contenteditable\]/);
  assert.match(script, /row\.setPointerCapture\(event\.pointerId\)/);
  assert.match(script, /SWIPE_THRESHOLD = 64/);
  assert.match(script, /dx <= -SWIPE_THRESHOLD[\s\S]{0,120}'\.delete-button'/);
  assert.match(script, /dx >= SWIPE_THRESHOLD[\s\S]{0,120}'\.mark-useful-button'/);
  assert.match(script, /gesture\.verticalHandle && dy <= -SWIPE_THRESHOLD[\s\S]{0,120}'\.snooze-week-button'/);
  assert.match(script, /\.row-menu, \.review-note-panel/);
  assert.match(script, /pointercancel/);
  assert.match(script, /setupReviewSwipe\(rowArticle\)/);
  assert.match(css, /body\.is-review-view \.library-row \{[^}]*touch-action: pan-y/);
  assert.match(css, /body\.is-review-view \.library-row\.is-swiping/);
  assert.match(css, /body\.is-review-view \.library-row__status \{[^}]*touch-action: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

it('shows actionable warnings for unresolved links older than 90 days', () => {
  assert.match(html, /data-filter="age">Older than 90 days/);
  assert.match(html, /class="age-warning hidden"/);
  assert.match(html, /class="[^"]*age-review-button[^"]*"/);
  assert.match(html, /class="[^"]*age-archive-button[^"]*"/);
  assert.match(html, /class="[^"]*age-keep-button[^"]*"/);
  assert.match(script, /AGE_WARNING_DAYS = 90/);
  assert.match(script, /params\.set\('ageBefore'/);
  assert.match(script, /params\.set\('sort', 'createdAt'\)/);
  assert.match(script, /params\.set\('order', 'asc'\)/);
  assert.match(script, /const remindAt = new Date\(Date\.now\(\) \+ AGE_WARNING_DAYS \* DAY_MS\)\.toISOString\(\)/);
  assert.match(script, /updateLinkFields\(item, \{ remindAt \}\)/);
  assert.match(html, /Keep for 90 days/);
  assert.match(script, /ageArchiveButton[\s\S]{0,160}deleteButton\.click\(\)/);
  assert.match(script, /deleteButton\.addEventListener\('click'[\s\S]{0,500}const response = await window\.LinkNest\.apiFetch[\s\S]{0,220}if \(!response\.ok\)/);
  assert.match(script, /else if \(quickFilter !== 'age'\) params\.set\('youtube', 'exclude'\)/);
  assert.match(css, /\.age-warning/);
});
