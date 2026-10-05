'use strict';
process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
let state, calls;
const copy = value => structuredClone(value);
async function query(sql, params = []) {
  calls.push([sql, params]);
  if (sql.startsWith('DELETE FROM link_actions')) return { rowCount: 0 };
  if (sql.startsWith('INSERT INTO link_actions')) {
    if (params[2] && Object.values(state.actions).some(row => row.actor_id === params[1] && row.request_id === params[2])) {
      throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    }
    state.actions[params[0]] = { id: params[0], actor_id: params[1], request_id: params[2], fingerprint: params[3],
      kind: params[4], created_at: params[5], expires_at: params[6], result_json: null, undone_at: null };
    return { rowCount: 1 };
  }
  if (sql.startsWith('SELECT * FROM link_actions')) return { rows: Object.values(state.actions).filter(row =>
    sql.includes('request_id') ? row.actor_id === params[0] && row.request_id === params[1] : row.id === params[0] && row.actor_id === params[1]) };
  if (sql.startsWith('SELECT *,') && sql.includes('FROM links')) return { rows: params[0].map(id => state.links[id]).filter(Boolean).map(copy) };
  if (sql.startsWith('SELECT * FROM links')) return { rows: state.links[params[0]] ? [copy(state.links[params[0]])] : [] };
  if (sql.startsWith('INSERT INTO link_action_items')) {
    state.items.push({ action_id: params[0], link_id: params[1], before_values: params[2], after_revision: params[3] });
    return { rowCount: 1 };
  }
  if (sql.includes('FROM link_action_items')) return { rows: state.items.filter(row => row.action_id === params[0]).map(copy) };
  if (sql.startsWith('UPDATE link_actions SET result_json')) { state.actions[params[1]].result_json = params[0]; return { rowCount: 1 }; }
  if (sql.startsWith('UPDATE link_actions SET undone_at')) {
    Object.assign(state.actions[params[2]], { undone_at: params[0], undo_result: params[1] }); return { rowCount: 1 };
  }
  if (sql.startsWith('UPDATE links SET')) {
    const row = state.links[params.at(-1)];
    const fields = [...sql.matchAll(/([a-z_]+)=\?/g)].map(match => match[1]).filter(field => field !== 'id');
    fields.forEach((field, index) => { row[field] = params[index]; });
    row.revision = String(BigInt(row.revision) + 1n);
    return { rowCount: 1 };
  }
  throw new Error(`Unexpected SQL ${sql}`);
}
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  withTransaction: async work => { const before = copy(state); try { return await work(query); } catch (error) { state = before; throw error; } },
} };
const linksPath = require.resolve('../lib/links');
require.cache[linksPath] = { id: linksPath, filename: linksPath, loaded: true, exports: {
  rowToLink: row => ({ ...row, deletedAt: row.deleted_at, firstMeaningfulAt: row.first_meaningful_at, firstUsefulAt: row.first_useful_at }),
  updateLinkInTransaction: async (q, id, body) => {
    const row = state.links[id];
    state.links[id] = { ...row, ...body, revision: String(BigInt(row.revision) + 1n),
      ...(body.status === 'useful' ? { first_meaningful_at: new Date(), first_useful_at: new Date() } : {}) };
    return state.links[id];
  },
  deleteLinkInTransaction: async (q, id) => {
    const row = state.links[id];
    state.links[id] = { ...row, status: 'archived', pinned: 0, deleted_at: new Date(), revision: String(BigInt(row.revision) + 1n) };
  },
} };
const historyPath = require.resolve('../lib/link-history');
require.cache[historyPath] = { id: historyPath, filename: historyPath, loaded: true,
  exports: { recordHistory: async (q, event) => state.events.push(event) } };
const { performLinkAction, undoLinkAction, performEditorStatusUpdate } = require('../lib/link-actions');
const actor = { user: { id: 'owner' } };
const requestId = '11111111-1111-4111-8111-111111111111';
function reset() {
  calls = []; state = { actions: {}, items: [], events: [], links: Object.fromEntries(['one', 'two'].map(id => [id, {
    id, url: `https://example.com/${id}`, title: id, host: 'example.com', status: 'saved', tags: [], pinned: 1,
    notes: '', revision: '9007199254740993', deleted_at: null, first_meaningful_at: null, first_useful_at: null,
  }])) };
}
it('archives and atomically restores exact state with high-precision revisions and repeat-safe undo', async () => {
  reset(); const result = await performLinkAction({ kind: 'archive', ids: ['two', 'one'], requestId }, actor);
  assert.equal(result.updated, 2); assert.ok(result.action.id); assert.equal(state.links.one.status, 'archived');
  const restored = await undoLinkAction(result.action.id, actor);
  assert.equal(restored.updated, 2); assert.equal(state.links.one.pinned, 1); assert.equal(state.links.one.deleted_at, null);
  assert.equal(state.links.one.revision, '9007199254740995'); assert.equal(state.events.length, 2);
  assert.deepEqual(await undoLinkAction(result.action.id, actor), restored); assert.equal(state.events.length, 2);
  const lock = calls.find(([sql]) => sql.startsWith('SELECT *,') && sql.includes('FOR UPDATE'));
  assert.deepEqual(lock[1][0], ['one', 'two']);
});
it('rejects any conflicting or missing member before restoring any row', async () => {
  for (const missing of [false, true]) {
    reset(); const result = await performLinkAction({ kind: 'archive', ids: ['one', 'two'] }, actor);
    if (missing) delete state.links.two; else state.links.two.revision = '9007199254740996';
    await assert.rejects(() => undoLinkAction(result.action.id, actor), error => error.statusCode === 409);
    assert.equal(state.links.one.status, 'archived'); assert.equal(state.events.length, 0);
  }
});
it('deduplicates requests, rejects changed fingerprints, and remembers no-op results', async () => {
  reset(); const body = { kind: 'status', ids: ['one'], status: 'unread', requestId };
  const first = await performLinkAction(body, actor);
  assert.deepEqual(await performLinkAction(body, actor), first); assert.equal(state.items.length, 1);
  await assert.rejects(() => performLinkAction({ ...body, status: 'useful' }, actor), error => error.statusCode === 409);
  reset(); const noop = { ...body, status: 'saved' };
  assert.equal((await performLinkAction(noop, actor)).action, null);
  state.links.one.status = 'unread';
  assert.equal((await performLinkAction(noop, actor)).updated, 0); assert.equal(state.links.one.status, 'unread');
});
it('undoes useful takeaway and milestone changes without retaining notes in history', async () => {
  reset(); state.links.one.notes = 'original';
  const result = await performLinkAction({ kind: 'status', ids: ['one'], status: 'useful', takeaway: ' useful note ' }, actor);
  assert.equal(state.links.one.notes, 'original\n\nuseful note');
  await undoLinkAction(result.action.id, actor);
  assert.equal(state.links.one.notes, 'original'); assert.equal(state.links.one.first_useful_at, null);
  assert.doesNotMatch(JSON.stringify(state.events), /original|useful note/);
});
it('enforces expiry, ownership, input boundaries and atomic invalid batches', async () => {
  reset(); const result = await performLinkAction({ kind: 'archive', ids: ['one'] }, actor);
  await assert.rejects(() => undoLinkAction(result.action.id, { user: { id: 'other' } }), error => error.statusCode === 404);
  state.actions[result.action.id].expires_at = new Date(0);
  await assert.rejects(() => undoLinkAction(result.action.id, actor), error => error.statusCode === 410);
  for (const body of [null, {}, { kind: 'archive', ids: [] }, { kind: 'archive', ids: ['one', 'one'] },
    { kind: 'archive', ids: ['one'], status: 'saved' }, { kind: 'status', ids: ['one'], status: 'bad' },
    { kind: 'status', ids: ['one', 'two'], status: 'useful', takeaway: 'x' },
    { kind: 'archive', ids: ['one'], requestId: 'bad' }, { kind: 'archive', ids: [1] },
    { kind: 'status', ids: ['one'], status: 'useful', takeaway: 'x'.repeat(10001) }]) {
    await assert.rejects(() => performLinkAction(body, actor), error => error.statusCode === 400);
  }
  await assert.rejects(() => performLinkAction({ kind: 'archive', ids: ['one'] }, null), error => error.statusCode === 401);
  reset(); await assert.rejects(() => performLinkAction({ kind: 'archive', ids: ['one', 'absent'] }, actor), error => error.statusCode === 404);
  assert.equal(state.links.one.status, 'saved'); assert.equal(state.items.length, 0);
});
it('editor changes preserve unrelated fields on undo and do not offer undo for unchanged status', async () => {
  reset(); const changed = await performEditorStatusUpdate('one', { status: 'unread', title: 'edited' }, actor);
  assert.ok(changed.action); await undoLinkAction(changed.action.id, actor); assert.equal(state.links.one.title, 'edited');
  const unchanged = await performEditorStatusUpdate('one', { status: 'saved', notes: 'new' }, actor);
  assert.equal(unchanged.action, null); assert.equal(state.links.one.notes, 'new');
});

it('restores nonnull milestone timestamps using mysql2 Date parameters', async () => {
  reset(); const milestone = new Date('2026-01-02T00:00:00.000Z');
  state.links.one.first_meaningful_at = milestone;
  state.links.one.first_useful_at = milestone;
  const result = await performLinkAction({ kind: 'status', ids: ['one'], status: 'unread' }, actor);
  await undoLinkAction(result.action.id, actor);
  const restore = calls.find(([sql]) => sql.startsWith('UPDATE links SET'));
  assert.ok(restore[1][1] instanceof Date); assert.ok(restore[1][2] instanceof Date);
  assert.equal(restore[1][1].toISOString(), milestone.toISOString());
});

it('rejects receipts older than 24 hours even when bounded cleanup has not removed them', async () => {
  reset(); const body = { kind: 'archive', ids: ['one'], requestId };
  const result = await performLinkAction(body, actor);
  await undoLinkAction(result.action.id, actor);
  state.actions[result.action.id].created_at = new Date(Date.now() - 86400001);
  const before = copy(state);
  await assert.rejects(() => performLinkAction(body, actor), error => error.statusCode === 410);
  await assert.rejects(() => undoLinkAction(result.action.id, actor), error => error.statusCode === 410);
  assert.deepEqual(state, before);
});
