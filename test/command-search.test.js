'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
