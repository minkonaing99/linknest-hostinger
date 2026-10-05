'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/browse.js'), 'utf8');

function load(scope) {
  const names = ['buildApiParams', 'getExportRequest', 'updateExportControls', 'downloadMarkdownExport', 'resolveReviewItem'];
  const functions = names.map(name => {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(match, `${name} exists`);
    return source.slice(match.index, source.indexOf('\n}\n', match.index) + 3);
  });
  return vm.runInNewContext(functions.join('\n') + '; ({ ' + names.join(', ') + ' });', scope);
}

function fixture() {
  const state = { links: [{ id: 'visible' }], selected: new Set(), total: 80,
    loading: false, exporting: false, exportReady: true, requestId: 1, quickFilter: null, tagFilter: 'study' };
  const scope = {
    state, URLSearchParams, LIMIT: 50, DAY_MS: 86400000, AGE_WARNING_DAYS: 90,
    SORT_MAP: { recent: { sort: 'updatedAt', order: 'desc' } },
    searchInput: { value: 'exam' }, statusFilter: { value: 'saved' }, sortModeSelect: { value: 'recent' },
    exportViewBtn: {}, exportSelectedBtn: {}, exportMessage: {},
    window: { LinkNest: { setMessage(target, text, kind) { target.textContent = text; target.kind = kind; } } },
  };
  return { ...scope, functions: load(scope) };
}

it('exports the whole filtered view, omitting loaded-page pagination', () => {
  const { functions } = fixture();
  const request = functions.getExportRequest('view');
  assert.equal(request.params.get('scope'), 'filtered');
  assert.equal(request.params.get('q'), 'exam');
  assert.equal(request.params.get('tag'), 'study');
  assert.equal(request.params.get('status'), 'saved');
  assert.equal(request.params.get('youtube'), 'exclude');
  assert.equal(request.params.has('page'), false);
  assert.equal(request.params.has('limit'), false);
  assert.equal(request.count, 80);
  assert.equal(request.label, 'matching links');
});

it('snapshots selected IDs and exact remaining review-session IDs', () => {
  const { state, functions } = fixture();
  state.selected = new Set(['first', 'second']);
  const selected = functions.getExportRequest('selected');
  state.selected.clear();
  assert.equal(selected.params.get('ids'), 'first,second');
  assert.equal(selected.params.get('scope'), 'selected');
  state.selected.add('comma,id');
  assert.deepEqual(JSON.parse(functions.getExportRequest('selected').params.get('ids')), ['comma,id']);
  for (const quickFilter of ['review', 'useful-review']) {
    state.quickFilter = quickFilter;
    const request = functions.getExportRequest('view');
    assert.equal(request.params.get('ids'), 'visible');
    assert.equal(request.params.get('scope'), 'selected');
    assert.equal(request.params.has('q'), false);
    assert.equal(request.count, 1);
  }
});

it('retains YouTube, due reminder, and age filters', () => {
  const { state, functions } = fixture();
  state.quickFilter = 'youtube';
  assert.equal(functions.getExportRequest('view').params.get('youtube'), 'only');
  state.quickFilter = 'remind';
  assert.ok(functions.getExportRequest('view').params.get('remindBefore'));
  state.quickFilter = 'age';
  const params = functions.getExportRequest('view').params;
  assert.ok(params.get('ageBefore'));
  assert.equal(params.get('sort'), 'createdAt');
  assert.equal(params.get('order'), 'asc');
});

it('blocks current-view export immediately while a search refresh is pending', () => {
  const { state, functions, exportViewBtn } = fixture();
  const start = source.indexOf("searchInput.addEventListener('input', () => {");
  assert.ok(start > 0);
  const handler = source.slice(start, source.indexOf('\n});', start) + 4);
  vm.runInNewContext(handler, {
    state, updateExportControls: functions.updateExportControls,
    searchInput: { addEventListener(_event, callback) { callback(); } },
  });
  assert.equal(state.exportReady, false);
  assert.equal(state.requestId, 2);
  assert.equal(exportViewBtn.disabled, true);
  assert.throws(() => functions.getExportRequest('view'), /finish loading/);
  for (const quickFilter of ['review', 'useful-review']) {
    state.quickFilter = quickFilter;
    state.exportReady = true;
    vm.runInNewContext(handler, {
      state, updateExportControls: functions.updateExportControls,
      searchInput: { addEventListener(_event, callback) { callback(); } },
    });
    assert.equal(state.exportReady, true);
    assert.equal(state.requestId, 2);
  }
});

it('disables current-view export after the last review decision', () => {
  const state = { links: [{ id: 'last' }], selected: new Set(), quickFilter: 'review',
    total: 1, exportReady: true, loading: false, exporting: false,
    reviewSession: { total: 1, resolved: new Set() } };
  const scope = { ...fixture(), state, updateReviewProgress() {}, renderReviewComplete() {} };
  const functions = load(scope);
  functions.updateExportControls();
  assert.equal(scope.exportViewBtn.disabled, false);
  functions.resolveReviewItem('last');
  assert.equal(state.links.length, 0);
  assert.equal(scope.exportViewBtn.disabled, true);
});

it('disables pending, unavailable, empty, and over-limit export controls', () => {
  const { state, functions, exportViewBtn, exportSelectedBtn } = fixture();
  functions.updateExportControls();
  assert.equal(exportViewBtn.disabled, false);
  assert.equal(exportSelectedBtn.disabled, true);
  state.selected.add('one');
  functions.updateExportControls();
  assert.equal(exportSelectedBtn.disabled, false);
  state.exportReady = false;
  functions.updateExportControls();
  assert.equal(exportViewBtn.disabled, true);
  state.exportReady = true;
  state.total = 5001;
  functions.updateExportControls();
  assert.equal(exportViewBtn.disabled, true);
  assert.throws(() => functions.getExportRequest('view'), /5,000|5000/);
  state.selected = new Set(Array.from({ length: 201 }, (_, i) => `id-${i}`));
  functions.updateExportControls();
  assert.equal(exportSelectedBtn.disabled, true);
  assert.throws(() => functions.getExportRequest('selected'), /200/);
  state.exporting = true;
  functions.updateExportControls();
  assert.equal(exportSelectedBtn.disabled, true);
});

it('downloads only successful responses, reports exact server count, and releases the blob URL', async () => {
  const state = { selected: new Set(['one']), links: [], total: 1, quickFilter: null,
    exportReady: true, exporting: false, loading: false };
  let clicked = 0, released = 0, requested;
  const messages = [], timers = [];
  const link = { click() { clicked += 1; }, remove() {} };
  const scope = {
    ...fixture(), state, URLSearchParams,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => { released += 1; } },
    setTimeout(callback) { timers.push(callback); },
    document: { createElement: () => link, body: { appendChild() {} } },
    window: { LinkNest: {
      setMessage(_target, text, kind) { messages.push({ text, kind }); },
      apiFetch: async url => {
        requested = url;
        assert.equal(state.exporting, true);
        return { ok: true, headers: { get: () => '1' }, blob: async () => ({}) };
      },
    } },
  };
  const functions = load(scope);
  await functions.downloadMarkdownExport('selected');
  assert.match(requested, /scope=selected/);
  assert.equal(clicked, 1);
  assert.equal(link.download, 'links-selected.md');
  assert.match(messages.at(-1).text, /1 selected link/);
  assert.equal(state.exporting, false);
  timers.forEach(callback => callback());
  assert.equal(released, 1);
  scope.window.LinkNest.apiFetch = async () => ({ ok: false, json: async () => ({ error: 'Refresh and select again' }) });
  await functions.downloadMarkdownExport('selected');
  assert.equal(clicked, 1);
  assert.equal(messages.at(-1).kind, 'error');
  assert.match(messages.at(-1).text, /Refresh/);
  assert.equal(state.exporting, false);
});
