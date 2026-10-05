'use strict';
process.env.DB_USER = 'test'; process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
let state, calls, failHistory;
const copy = value => structuredClone(value);
function result(rows = [], rowCount = rows.length) { return { rows, rowCount }; }
function bump(row) { return { ...row, revision: String(BigInt(row.revision) + 1n) }; }
async function query(sql, params = []) {
  calls.push([sql, params]);
  if (sql.startsWith('DELETE FROM link_actions')) {
    const expired = Object.values(state.actions).filter(row => new Date(row.created_at) < new Date(Date.now() - 86400000)).slice(0, 100);
    state.actions = Object.fromEntries(Object.entries(state.actions).filter(([id]) => !expired.some(row => row.id === id)));
    state.items = state.items.filter(item => !expired.some(row => row.id === item.action_id));
    return result([], expired.length);
  }
  if (sql.startsWith('INSERT INTO link_actions')) {
    if (params[2] && Object.values(state.actions).some(row => row.actor_id === params[1] && row.request_id === params[2])) {
      throw Object.assign(new Error('Duplicate'), { code: 'ER_DUP_ENTRY' });
    }
    state.actions = { ...state.actions, [params[0]]: { id: params[0], actor_id: params[1], request_id: params[2],
      fingerprint: params[3], kind: params[4], created_at: params[5], expires_at: params[6], result_json: null } };
    return result([], 1);
  }
  if (sql.startsWith('SELECT * FROM link_actions')) return result(Object.values(state.actions).filter(row =>
    sql.includes('request_id') ? row.actor_id === params[0] && row.request_id === params[1] : row.id === params[0] && row.actor_id === params[1]).map(copy));
  if (sql.startsWith('SELECT *,') && sql.includes('FROM links')) return result(params[0].map(id => state.links[id]).filter(Boolean).map(copy));
  if (sql.startsWith('SELECT * FROM links')) return result(state.links[params[0]] ? [copy(state.links[params[0]])] : []);
  if (sql.startsWith('SELECT id FROM links WHERE url')) return result([]);
  if (sql.includes('COUNT(*)')) return result([{ count: Object.values(state.links).filter(row => !row.deleted_at).length }]);
  if (sql.startsWith('INSERT INTO link_events')) {
    if (failHistory) throw new Error('History failed');
    state.events = [...state.events, { id: params[0], link_id: params[1], actor_id: params[2], type: params[3], metadata: JSON.parse(params[5]) }];
    return result([], 1);
  }
  if (sql.startsWith('INSERT INTO link_action_items')) {
    state.items = [...state.items, { action_id: params[0], link_id: params[1], before_values: params[2], after_revision: params[3] }];
    return result([], 1);
  }
  if (sql.includes('FROM link_action_items')) return result(state.items.filter(row => row.action_id === params[0]).map(copy));
  if (sql.startsWith('UPDATE link_actions SET result_json')) {
    state.actions[params[1]] = { ...state.actions[params[1]], result_json: params[0] }; return result([], 1);
  }
  if (sql.startsWith('UPDATE link_actions SET undone_at')) {
    state.actions[params[2]] = { ...state.actions[params[2]], undone_at: params[0], undo_result: params[1] }; return result([], 1);
  }
  if (sql.startsWith('UPDATE links')) {
    const id = params.at(-1), before = state.links[id];
    let after = bump(before);
    if (sql.includes('reading_position=CASE')) {
      const columns = ['url', 'title', 'host', 'status', 'tags', 'pinned', 'date', 'created_at', 'updated_at', 'deleted_at', 'remind_at', 'notes', 'save_reason'];
      after = { ...after, ...Object.fromEntries(columns.map((column, index) => [column, params[index + 1]])) };
      if (before.url !== params[0]) after.reading_position = null;
      if (params[14] && !before.first_useful_at) after.first_useful_at = params[15];
      if (params[16] && (!before.first_meaningful_at || new Date(before.first_meaningful_at) < new Date(new Date(before.created_at).getTime() + 86400000))) {
        after.first_meaningful_at = params[17];
      }
    } else if (sql.includes("status='archived'")) {
      after = { ...after, deleted_at: params[0], updated_at: params[1], status: 'archived', pinned: 0 };
      if (new Date(before.created_at).getTime() <= new Date(params[2]).getTime() - 86400000
        && (!before.first_meaningful_at || new Date(before.first_meaningful_at).getTime() < new Date(before.created_at).getTime() + 86400000)) {
        after.first_meaningful_at = params[3];
      }
    } else {
      const fields = [...sql.matchAll(/([a-z_]+)=\?/g)].map(match => match[1]).filter(field => field !== 'id');
      after = { ...after, ...Object.fromEntries(fields.map((field, index) => [field, params[index]])) };
    }
    state.links = { ...state.links, [id]: after }; return result([], 1);
  }
  throw new Error(`Unexpected SQL: ${sql}`);
}
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query,
  withTransaction: async work => { const before = copy(state); try { return await work(query); } catch (error) { state = before; throw error; } },
} };
const { performLinkAction, undoLinkAction, performEditorStatusUpdate, cleanupExpiredActions } = require('../lib/link-actions');
const { updateLink } = require('../lib/links');
const actor = { user: { id: 'owner' } }, requestId = '11111111-1111-4111-8111-111111111111';
function reset() {
  failHistory = false; calls = [];
  state = { actions: {}, items: [], events: [], links: Object.fromEntries(['one', 'two'].map(id => [id, {
    id, url: `https://example.com/${id}`, host: 'example.com', title: id, tags: '[]', status: 'saved', pinned: 1,
    created_at: new Date(Date.now() - 86400000 * 2), updated_at: new Date(Date.now() - 86400000),
    date: '2026-01-01', notes: 'original', save_reason: '', deleted_at: null,
    first_meaningful_at: null, first_useful_at: null, revision: '0', reading_position: null,
  }])) };
}
it('real domain archive/update helpers restore exact pinned status date notes and useful milestones', async () => {
  reset(); const old = copy(state.links.one);
  const archived = await performLinkAction({ kind: 'archive', ids: ['one'] }, actor);
  assert.equal(archived.entries[0].deletedAt !== null, true); assert.equal(archived.entries[0].pinned, false);
  assert.ok(state.links.one.first_meaningful_at);
  const restored = await undoLinkAction(archived.action.id, actor);
  assert.equal(restored.entries[0].status, old.status); assert.equal(restored.entries[0].pinned, true);
  assert.equal(state.links.one.date, old.date); assert.equal(state.links.one.deleted_at, null);
  assert.equal(state.links.one.first_meaningful_at, null);
  const useful = await performLinkAction({ kind: 'status', ids: ['one'], status: 'useful', takeaway: 'Insight' }, actor);
  assert.equal(useful.entries[0].notes, 'original\n\nInsight'); assert.ok(useful.entries[0].firstUsefulAt);
  await undoLinkAction(useful.action.id, actor);
  assert.equal(state.links.one.notes, old.notes); assert.equal(state.links.one.first_useful_at, null);
  assert.deepEqual(state.events.map(event => event.type), ['archived', 'action_undone', 'marked_useful', 'action_undone']);
  assert.doesNotMatch(JSON.stringify(state.events), /original|Insight/);
});
it('young links remain outside meaningful/useful metrics and existing milestone dates restore exactly', async () => {
  reset(); state.links.one = { ...state.links.one, created_at: new Date(), first_meaningful_at: new Date('2026-01-02T00:00:00Z') };
  const prior = copy(state.links.one.first_meaningful_at);
  const useful = await performLinkAction({ kind: 'status', ids: ['one'], status: 'useful' }, actor);
  assert.equal(state.links.one.first_useful_at, null);
  await undoLinkAction(useful.action.id, actor); assert.deepEqual(state.links.one.first_meaningful_at, prior);
});
it('real helper errors and history failures roll back entire action receipts, rows and events', async () => {
  reset(); const before = copy(state);
  await assert.rejects(() => performLinkAction({ kind: 'archive', ids: ['one', 'missing'] }, actor), error => error.statusCode === 404);
  assert.deepEqual(state, before);
  failHistory = true;
  await assert.rejects(() => performLinkAction({ kind: 'archive', ids: ['one', 'two'] }, actor), /History failed/);
  assert.deepEqual(state, before);
});
it('editor undo preserves unrelated title and note edits and their meaningful milestone', async () => {
  reset(); const result = await performEditorStatusUpdate('one', { status: 'unread', title: 'edited', notes: 'edited notes' }, actor);
  const meaningful = copy(state.links.one.first_meaningful_at);
  assert.ok(meaningful); await undoLinkAction(result.action.id, actor);
  assert.equal(state.links.one.status, 'saved'); assert.equal(state.links.one.title, 'edited');
  assert.equal(state.links.one.notes, 'edited notes'); assert.deepEqual(state.links.one.first_meaningful_at, meaningful);
});
it('request retry and no-op receipt never reapply action after later domain mutations', async () => {
  reset(); const input = { kind: 'status', ids: ['one'], status: 'unread', requestId };
  const action = await performLinkAction(input, actor); await updateLink('one', { status: 'useful' }, actor);
  assert.deepEqual(await performLinkAction(input, actor), action); assert.equal(state.links.one.status, 'useful');
  await assert.rejects(() => undoLinkAction(action.action.id, actor), error => error.statusCode === 409);
  reset(); const noop = { ...input, status: 'saved' }; assert.equal((await performLinkAction(noop, actor)).action, null);
  await updateLink('one', { status: 'useful' }, actor);
  assert.equal((await performLinkAction(noop, actor)).updated, 0); assert.equal(state.links.one.status, 'useful');
});
it('scheduled cleanup deletes only old receipts and snapshots, keeping permanent history', async () => {
  reset(); const first = await performLinkAction({ kind: 'archive', ids: ['one'] }, actor);
  await performLinkAction({ kind: 'archive', ids: ['two'] }, actor);
  state.actions[first.action.id] = { ...state.actions[first.action.id], created_at: new Date(Date.now() - 86400001) };
  const history = copy(state.events);
  await cleanupExpiredActions(); assert.equal(Object.keys(state.actions).length, 1); assert.equal(state.items.length, 1);
  assert.deepEqual(state.events, history); assert.match(calls.at(-1)[0], /INTERVAL 1 DAY.*LIMIT 100/);
});
