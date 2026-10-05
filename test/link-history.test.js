'use strict';

process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-00000000000000000000000000';
const { it } = require('node:test');
const assert = require('node:assert/strict');
let impl;
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { query: (...args) => impl(...args) } };
const { historyChanges, recordHistory, validateHistory, restoreHistory, readLinkHistory,
  readHistoryForExport } = require('../lib/link-history');
const id = '11111111-1111-4111-8111-111111111111';
const event = { id, type: 'note_updated', occurredAt: '2026-10-05T01:00:00.000Z', metadata: { changedFields: ['notes'] } };

it('groups compound review changes without retaining private note or reason text', () => {
  const before = { status: 'saved', notes: 'old secret', saveReason: 'old reason', tags: [] };
  const after = { ...before, status: 'useful', notes: 'new secret', saveReason: 'new reason' };
  assert.deepEqual(historyChanges(before, before), null);
  const result = historyChanges(before, after);
  assert.equal(result.type, 'marked_useful');
  assert.deepEqual(result.metadata.changedFields, ['status', 'notes', 'saveReason']);
  assert.equal(result.metadata.fromStatus, 'saved');
  assert.doesNotMatch(JSON.stringify(result), /secret|old reason|new reason/);
  assert.deepEqual(before.notes, 'old secret');
  for (const [field, value, type] of [['notes', 'changed', 'note_updated'], ['saveReason', 'changed', 'save_reason_updated'],
    ['remindAt', '2026-10-06T00:00:00.000Z', 'snoozed'], ['title', 'new', 'details_updated'],
    ['status', 'unread', 'status_changed'], ['deletedAt', '2026-10-05T00:00:00.000Z', 'archived']]) {
    assert.equal(historyChanges(before, { ...before, [field]: value }).type, type);
  }
  assert.equal(historyChanges({ ...before, deletedAt: event.occurredAt }, { ...before, deletedAt: null }).type, 'restored');
  assert.equal(historyChanges(before, before, 'useful_review_completed').type, 'useful_review_completed');
});

it('validates backup event schemas, dates, sizes and summaries with immutable copies', () => {
  assert.deepEqual(validateHistory([event]), [event]);
  for (const invalid of [null, {}, [{ ...event, type: 'unknown' }], [{ ...event, id: 'bad' }],
    [{ ...event, occurredAt: 'yesterday' }], [{ ...event, metadata: { notes: 'secret' } }],
    [{ ...event, metadata: { changedFields: ['password'] } }], [event, event], Array(5001).fill(event)]) {
    assert.throws(() => validateHistory(invalid), error => error.statusCode === 400);
  }
  const copy = validateHistory([event]);
  copy[0].metadata.changedFields.push('title');
  assert.deepEqual(event.metadata.changedFields, ['notes']);
});

it('records and restores events using the provided transaction query and actor only', async () => {
  const calls = [];
  const transaction = async (...args) => { calls.push(args); return { rowCount: 1 }; };
  await recordHistory(transaction, { linkId: 'one', actor: { user: { id: 'owner' } }, type: 'saved', occurredAt: new Date(event.occurredAt), metadata: { changedFields: [] } });
  await restoreHistory(transaction, 'one', [event], { user: { id: 'owner' } });
  assert.equal(calls.length, 2);
  assert.match(calls[0][0], /INSERT INTO link_events/);
  assert.equal(calls[0][1][2], 'owner');
  assert.equal(calls[1][1][0], id);
  assert.equal(calls[1][1][1], 'one');
  assert.equal(calls[1][1][2], 'owner');
});

it('paginates archived link history stably with bounded parameterized cursors', async () => {
  const calls = [];
  impl = async (...args) => {
    calls.push(args);
    return args[0].includes('FROM links') ? { rows: [{ id: 'one', deleted_at: event.occurredAt }] }
      : { rows: [{ id, type: event.type, occurred_at: event.occurredAt, metadata: JSON.stringify(event.metadata) },
        { id: '22222222-2222-4222-8222-222222222222', type: 'saved', occurred_at: event.occurredAt, metadata: { changedFields: [] } }] };
  };
  const first = await readLinkHistory('one', { limit: '1' });
  assert.deepEqual(first.events, [event]);
  assert.ok(first.nextCursor);
  await readLinkHistory('one', { cursor: first.nextCursor, limit: '1' });
  assert.match(calls.at(-1)[0], /occurred_at < \?/);
  assert.ok(calls.at(-1)[1].includes(id));
  assert.equal(calls.at(-1)[1].at(-1), 2);
  for (const options of [{ limit: '0' }, { limit: '101' }, { limit: '1.5' }, { cursor: 'invalid' }, { cursor: 'a'.repeat(513) }]) {
    await assert.rejects(() => readLinkHistory('one', options), error => error.statusCode === 400);
  }
  await assert.rejects(() => readLinkHistory('', {}), error => error.statusCode === 400);
  impl = async () => ({ rows: [] });
  await assert.rejects(() => readLinkHistory('missing'), error => error.statusCode === 404);
});

it('exports validated compact events grouped by link without actor credentials', async () => {
  impl = async () => ({ rows: [{ link_id: 'one', id, type: event.type, occurred_at: event.occurredAt,
    metadata: event.metadata, actor_id: 'owner' }] });
  assert.deepEqual(await readHistoryForExport(), new Map([['one', [event]]]));
});

it('complete backups validate more than 5000 legitimate events without truncation', async () => {
  const rows = Array.from({ length: 5001 }, (_, index) => ({ link_id: 'one',
    id: `11111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`,
    type: 'note_updated', occurred_at: event.occurredAt, metadata: event.metadata }));
  impl = async () => ({ rows });
  const exported = (await readHistoryForExport()).get('one');
  assert.equal(exported.length, 5001);
  assert.equal(validateHistory(exported).length, 5001);
});
