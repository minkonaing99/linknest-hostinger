'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
let rows = [], total = 0;
const calls = [];
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  withTransaction: async (work, options) => {
    assert.deepEqual(options, { consistentRead: true });
    return work(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: sql.includes('COUNT(*)') ? [{ total }] : rows };
    });
  },
} };
const { offlineSnapshot } = require('../lib/offline-library');
const row = (id, notes = '') => ({ id, title: id, url: `https://example.com/${id}`, status: 'saved',
  tags: '["study"]', notes, save_reason: 'Read later', pinned: 1, date: '2026-10-05',
  created_at: new Date('2026-10-05T00:00:00Z'), updated_at: new Date('2026-10-05T01:00:00Z'),
  password_hash: 'secret', revision: '999', reading_position: { ratio: 1 } });

it('snapshot uses one consistent transaction, active predicate and stable bounded order', async () => {
  rows = [row('one')]; total = 1; calls.length = 0;
  const result = await offlineSnapshot('owner');
  assert.equal(result.userId, 'owner'); assert.equal(result.schemaVersion, 1);
  assert.equal(result.complete, true); assert.equal(result.total, 1);
  assert.ok(Number.isFinite(Date.parse(result.downloadedAt)));
  assert.equal(calls.length, 2);
  for (const { sql } of calls) assert.match(sql, /deleted_at IS NULL AND status <> 'archived'/);
  assert.match(calls[1].sql, /ORDER BY updated_at DESC, id ASC LIMIT 2000/);
  assert.deepEqual(Object.keys(result.links[0]).sort(), [
    'id', 'title', 'url', 'status', 'tags', 'notes', 'saveReason', 'pinned', 'date', 'createdAt', 'updatedAt',
  ].sort());
  assert.equal(result.links[0].pinned, true); assert.deepEqual(result.links[0].tags, ['study']);
  assert.equal(rows[0].tags, '["study"]');
});

it('empty snapshot and complete 2000-row snapshot retain exact counts', async () => {
  rows = []; total = 0;
  assert.deepEqual((await offlineSnapshot('owner')).links, []);
  assert.equal((await offlineSnapshot('owner')).complete, true);
  rows = Array.from({ length: 2000 }, (_, index) => row(String(index))); total = 2000;
  assert.equal((await offlineSnapshot('owner')).complete, true);
  total = 2001;
  const result = await offlineSnapshot('owner');
  assert.equal(result.links.length, 2000); assert.equal(result.complete, false); assert.equal(result.total, 2001);
});

it('UTF-8 size cap includes envelope and keeps a contiguous newest prefix', async () => {
  rows = [row('one', '界'.repeat(4_500_000)), row('two', '界'.repeat(4_500_000)), row('three')]; total = 3;
  const result = await offlineSnapshot('owner');
  assert.equal(result.complete, false); assert.deepEqual(result.links.map(link => link.id), ['one']);
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 25 * 1024 * 1024);
  rows = [row('huge', '界'.repeat(9_000_000))]; total = 1;
  assert.deepEqual((await offlineSnapshot('owner')).links, []);
});

it('bad tags fall back to empty arrays and date/null fields stay serializable', async () => {
  rows = [{ ...row('one'), tags: '{', notes: null, save_reason: null, created_at: null, updated_at: null }]; total = 1;
  const link = (await offlineSnapshot('owner')).links[0];
  assert.deepEqual(link.tags, []); assert.equal(link.notes, ''); assert.equal(link.saveReason, '');
  assert.equal(link.createdAt, null); assert.equal(link.updatedAt, null);
  rows = [{ ...row('one'), tags: 'null' }, { ...row('two'), tags: ['a'] }]; total = 2;
  const result = await offlineSnapshot('owner');
  assert.deepEqual(result.links[0].tags, []); assert.deepEqual(result.links[1].tags, ['a']);
  assert.notEqual(result.links[1].tags, rows[1].tags);
});
