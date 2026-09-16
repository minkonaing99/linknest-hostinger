'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../public/js/shared.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');

it('builds an accessible native command-search dialog', () => {
  assert.match(script, /document\.createElement\('dialog'\)/);
  assert.match(script, /role', 'combobox'/);
  assert.match(script, /aria-controls', 'command-results'/);
  assert.match(script, /role', 'listbox'/);
  assert.match(script, /dialog\.showModal\(\)/);
  assert.match(script, /document\.body\.dataset\.page === 'login'/);
});

it('opens with slash or Cmd/Ctrl+K without hijacking typing', () => {
  assert.match(script, /event\.key === '\/'/);
  assert.match(script, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(script, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(script, /INPUT\|TEXTAREA\|SELECT/);
});

it('searches safely and discards stale requests', () => {
  assert.match(script, /new AbortController\(\)/);
  assert.match(script, /params = new URLSearchParams/);
  assert.match(script, /limit: '10'/);
  assert.match(script, /requestId !== commandState\.requestId/);
  assert.doesNotMatch(script, /commandResults\.innerHTML/);
});

it('supports navigation and all five link actions', () => {
  assert.match(script, /ArrowDown/);
  assert.match(script, /ArrowUp/);
  assert.match(script, /event\.key === 'Enter'/);
  assert.match(script, /\/opened`/);
  assert.match(script, /notes: note\.value\.trim\(\)/);
  assert.match(script, /status: 'useful'/);
  assert.match(script, /remindAt/);
  assert.match(script, /remove \? 'DELETE' : 'PUT'/);
});

it('uses the shared optional takeaway for the useful command', () => {
  assert.match(script, /async function markCommandItemUseful\(\)/);
  assert.match(script, /window\.LinkNest\.usefulUpdate\(item\)/);
  assert.match(script, /if \(fields\) await updateCommandItem\(fields, 'Marked useful', false, item\)/);
});

it('keeps useful takeaway optional and bounded', () => {
  assert.match(script, /async function usefulUpdate\(item\)/);
  assert.match(script, /String\(item\?\.notes \|\| ''\)\.trim\(\)/);
  assert.match(script, /window\.prompt\('What was useful\? \(optional - Cancel to skip\)'\)/);
  assert.match(script, /if \(!notes\) return \{ status: 'useful' \}/);
  assert.match(script, /notes\.length > 10000/);
  assert.match(script, /return \{ status: 'useful', notes \}/);
});

it('preserves existing notes and handles entered, skipped, and oversized takeaways', async () => {
  let answer = null;
  let prompts = 0;
  const window = { prompt: () => { prompts += 1; return answer; } };
  vm.runInNewContext(script.split('let commandState')[0], { window, URL, Intl });
  window.LinkNest.showToast = () => {};
  const update = async item => JSON.parse(JSON.stringify(await window.LinkNest.usefulUpdate(item)));
  assert.deepEqual(await update({ notes: 'Existing note' }), { status: 'useful' });
  assert.equal(prompts, 0);
  assert.deepEqual(await update({ notes: '' }), { status: 'useful' });
  answer = '   ';
  assert.deepEqual(await update({ notes: '' }), { status: 'useful' });
  answer = '  Useful insight  ';
  assert.deepEqual(await update({ notes: '' }), { status: 'useful', notes: 'Useful insight' });
  let request;
  window.LinkNest.apiFetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({}) };
  };
  assert.deepEqual(await update({ id: 'link-1', notes: '' }), { status: 'useful' });
  assert.deepEqual(request, { url: '/api/links/link-1/merge-note', body: { note: 'Useful insight' } });
  answer = 'x'.repeat(10001);
  assert.equal(await window.LinkNest.usefulUpdate({ notes: '' }), null);
});

it('keeps note edits safe and search state current', () => {
  assert.match(script, /if \(saved\) toggleCommandNote\(false\)/);
  assert.match(script, /toggleCommandNote\(false\)[\s\S]{0,120}commandState = \{ \.\.\.commandState, selected \}/);
  assert.match(script, /if \(requestId !== commandState\.requestId\) return;[\s\S]{0,120}error\.name/);
  assert.match(script, /removeAttribute\('aria-activedescendant'\)/);
  assert.match(script, /option\.tabIndex = -1/);
  assert.match(script, /document\.activeElement\?\.isContentEditable/);
  assert.match(script, /event\.preventDefault\(\); event\.stopPropagation\(\); toggleCommandNote\(false\)/);
});

it('uses compact desktop and mobile presentation', () => {
  assert.match(css, /\.command-dialog::backdrop/);
  assert.match(css, /\.command-result\.is-active/);
  assert.match(css, /@media \(max-width: 600px\)[\s\S]*\.command-dialog/);
});
