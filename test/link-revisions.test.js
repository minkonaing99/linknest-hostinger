'use strict';
process.env.DB_USER = 'test'; process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
let calls = [], row;
const query = async (sql, params) => {
  calls.push({ sql, params });
  if (sql.includes('COUNT(*)')) return { rows: [{ count: 1 }], rowCount: 1 };
  if (sql.includes('WHERE url')) return { rows: [], rowCount: 0 };
  if (sql.startsWith('SELECT id FROM links WHERE id IN')) return { rows: [{ id: 'one' }, { id: 'two' }], rowCount: 2 };
  if (sql.startsWith('SELECT')) return { rows: [row], rowCount: 1 };
  return { rows: [], rowCount: 1 };
};
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { query, withTransaction: work => work(query) } };
const links = require('../lib/links');
const { saveReadingPosition } = require('../lib/reading-position');
function reset(overrides = {}) {
  calls = [];
  row = { id: 'one', url: 'https://example.com/', title: 'Example', host: 'example.com', status: 'saved',
    tags: '[]', notes: '', pinned: 0, date: '2026-01-01', created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, revision: '4', ...overrides };
}

it('all existing link mutation paths advance internal revision', async () => {
  const paths = [() => links.updateLink('one', { notes: 'changed' }), () => links.mergeLinkNote('one', 'note'),
    () => links.markUsefulReviewed('one'), () => links.deleteLink('one'), () => links.restoreLink('one'),
    () => links.openLink('one'), () => links.bulkUpdateStatus(['one'], 'unread'),
    () => saveReadingPosition('one', { url: 'https://example.com/', ratio: 0.5, offset: 0, anchor: '', scrollHeight: 2000 })];
  for (const [index, work] of paths.entries()) {
    reset(index === 2 ? { status: 'useful' } : index === 4 ? { deleted_at: '2026-01-02T00:00:00.000Z', status: 'archived' } : {});
    await work();
    const updates = calls.filter(call => call.sql.startsWith('UPDATE links'));
    assert.ok(updates.length, `path ${index}`);
    assert.ok(updates.every(call => /revision\s*=\s*revision\s*\+\s*1/.test(call.sql)), `path ${index} must invalidate undo`);
  }
});

it('relationship changes lock both links in order and advance both revisions', async () => {
  for (const work of [() => links.addRelatedLink('two', 'one'), () => links.removeRelatedLink('two', 'one'),
    () => links.importRelationships([{ linkIdA: 'one', linkIdB: 'two' }])]) {
    reset(); await work();
    assert.match(calls[0].sql, /ORDER BY id FOR UPDATE/);
    assert.deepEqual(calls[0].params, [['one', 'two']]);
    const update = calls.find(call => call.sql.startsWith('UPDATE links'));
    assert.match(update.sql, /revision=revision\+1/);
    assert.deepEqual(update.params, [['one', 'two']]);
  }
});

it('exported records do not expose or restore internal revisions', async () => {
  reset(); const exported = await links.readAllLinksForExport();
  assert.equal(exported[0].revision, undefined);
});
