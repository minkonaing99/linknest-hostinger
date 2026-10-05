const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_USER = 'test'; process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
let calls = [], events = [], row, failHistory = false, commits = 0, rollbacks = 0, existingUrl = false, historyConflict = false;
const query = async (sql, params) => {
  calls.push({ sql, params });
  if (sql.includes('COUNT(*)')) return { rows: [{ count: 1 }], rowCount: 1 };
  if (historyConflict && sql.startsWith('INSERT INTO link_events')) throw Object.assign(new Error('event conflict'), { code: 'ER_DUP_ENTRY' });
  if (existingUrl && sql.includes('WHERE url')) return { rows: [{ id: 'existing', deleted_at: null }], rowCount: 1 };
  if (sql.includes('WHERE url')) return { rows: [], rowCount: 0 };
  if (sql.startsWith('UPDATE links') && sql.includes('CONCAT')) row = { ...row, notes: row.notes ? row.notes + '\n\n' + params[0] : params[0] };
  if (sql.startsWith('SELECT')) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  return { rows: [], rowCount: 1 };
};
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query, withTransaction: async work => {
    try { const result = await work(query); commits++; return result; }
    catch (error) { rollbacks++; throw error; }
  },
} };
const historyPath = require.resolve('../lib/link-history');
const actualHistory = require(historyPath);
require.cache[historyPath].exports = { ...actualHistory,
  recordHistory: async (transactionQuery, event) => {
    assert.equal(transactionQuery, query); if (failHistory) throw new Error('history failed'); events.push(event);
  },
};
const links = require('../lib/links');
function reset(overrides = {}) {
  calls = []; events = []; failHistory = false; commits = 0; rollbacks = 0; existingUrl = false; historyConflict = false;
  row = { id: 'one', url: 'https://example.com/', title: 'Example', host: 'example.com',
    status: 'saved', tags: '[]', notes: '', save_reason: '', pinned: 0,
    date: '2026-01-01', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null, ...overrides };
}
test('changed notes lock source and record only safe field metadata within transaction', async () => {
  reset(); const actor = { type: 'session', userId: 'user-one' };
  await links.updateLink('one', { notes: 'private note' }, actor);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.equal(commits, 1); assert.equal(events.length, 1);
  assert.equal(events[0].type, 'note_updated'); assert.equal(events[0].actor, actor);
  assert.doesNotMatch(JSON.stringify(events[0].metadata), /private note/);
});
test('no-op update emits no event and event failure rolls back', async () => {
  reset(); await links.updateLink('one', { title: 'Example' }); assert.equal(events.length, 0);
  reset(); failHistory = true;
  await assert.rejects(() => links.updateLink('one', { notes: 'changed' }), /history failed/);
  assert.equal(commits, 0); assert.equal(rollbacks, 1);
});
test('soft archive and restore record transitions, repeated calls are no-ops', async () => {
  reset(); await links.deleteLink('one'); assert.equal(events[0].type, 'archived');
  reset({ status: 'archived', deleted_at: '2026-02-01T00:00:00.000Z' });
  await links.deleteLink('one'); assert.equal(events.length, 0);
  await links.restoreLink('one'); assert.equal(events[0].type, 'restored');
  reset(); await links.restoreLink('one'); assert.equal(events.length, 0);
});
test('bulk ignores duplicate IDs, unchanged rows, missing and deleted links', async () => {
  reset(); const result = await links.bulkUpdateStatus(['one', 'one', 'missing'], 'useful');
  assert.equal(result.updated, 1); assert.equal(events.length, 1);
  assert.match(calls[0].sql, /ORDER BY id.*FOR UPDATE/);
  assert.deepEqual(calls[0].params, [['missing', 'one']]);
  reset({ status: 'useful' }); assert.equal((await links.bulkUpdateStatus(['one'], 'useful')).updated, 0);
  assert.equal(events.length, 0);
});
test('review completion and merged note emit events without changing existing milestones', async () => {
  reset({ status: 'useful', first_useful_at: '2026-02-01T00:00:00.000Z' });
  const entry = await links.markUsefulReviewed('one', {}, new Date('2026-10-05T00:00:00Z'));
  assert.equal(events[0].type, 'useful_review_completed');
  assert.equal(entry.firstUsefulAt, '2026-02-01T00:00:00.000Z');
  reset({ notes: 'Existing' }); await links.mergeLinkNote('one', 'New insight');
  assert.equal(events[0].type, 'note_updated'); assert.match(calls[0].sql, /FOR UPDATE/);
});

test('capture emits saved only after insertion, duplicate capture emits nothing', async () => {
  reset(); row = null;
  await links.createLink({ url: 'https://example.com/new', title: 'New link' });
  assert.equal(events.length, 1); assert.equal(events[0].type, 'saved'); assert.equal(commits, 1);
  reset(); existingUrl = true;
  await assert.rejects(() => links.createLink({ url: 'https://example.com/', title: 'Duplicate' }), error => error.statusCode === 409);
  assert.equal(events.length, 0); assert.equal(rollbacks, 1);
});
test('import appends imported event, validates histories before writes, and rolls back event conflicts', async () => {
  reset(); row = null;
  await links.importLinks([{ url: 'https://example.com/new', title: 'New link' }]);
  assert.equal(events[0].type, 'imported'); assert.equal(commits, 1);
  reset(); const result = await links.importLinks([{ url: 'https://example.com/', history: [{ id: 'bad' }] }]);
  assert.equal(result.invalid, 1); assert.equal(commits, 0);
  reset(); historyConflict = true;
  const conflict = await links.importLinks([{ url: 'https://example.com/new', history: [{
    id: '11111111-1111-4111-8111-111111111111', type: 'saved', occurredAt: '2026-01-01T00:00:00.000Z', metadata: { changedFields: [] },
  }] }]);
  assert.equal(conflict.invalid, 1); assert.equal(conflict.duplicates, 0); assert.equal(rollbacks, 1);
});

test('preview/import round-trip portable event identity and time, with current actor only', async () => {
  reset(); row = null;
  const history = [{ id: '22222222-2222-4222-8222-222222222222', type: 'note_updated',
    occurredAt: '2026-03-01T00:00:00.000Z', metadata: { changedFields: ['notes'] } }];
  const preview = await links.previewImportLinks([{ url: 'https://example.com/new', title: 'New', history }]);
  assert.deepEqual(preview.readyLinks[0].history, history);
  const actor = { user: { id: 'current-user' } };
  const result = await links.importLinks(preview.readyLinks, actor);
  assert.equal(result.imported, 1);
  const restored = calls.find(call => call.sql.startsWith('INSERT INTO link_events'));
  assert.equal(restored.params[0], history[0].id); assert.equal(restored.params[2], 'current-user');
  assert.equal(restored.params[4].toISOString(), history[0].occurredAt);
  assert.equal(events[0].type, 'imported'); assert.equal(events[0].actor, actor);
  assert.equal(commits, 1);
});
