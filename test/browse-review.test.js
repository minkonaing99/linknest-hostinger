'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/browse.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/browse.js'), 'utf8');

it('shows finite review progress and completion state', () => {
  assert.match(html, /id="review-progress"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(script, /reviewSession: null/);
  assert.match(script, /resolved: new Set\(\)/);
  assert.match(script, /Review \$\{current\} of \$\{session\.total\}/);
  assert.match(script, /Review complete/);
  assert.match(script, /You made a decision on all/);
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
