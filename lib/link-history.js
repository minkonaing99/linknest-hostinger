'use strict';

const { query } = require('./db');
const { makeId, validationError } = require('./utils');
const TYPES = new Set(['saved', 'imported', 'note_updated', 'marked_useful', 'status_changed',
  'snoozed', 'archived', 'restored', 'useful_review_completed', 'save_reason_updated', 'details_updated', 'action_undone']);
const FIELDS = ['url', 'title', 'status', 'tags', 'pinned', 'date', 'remindAt', 'notes', 'saveReason', 'deletedAt'];
const STATUSES = new Set(['saved', 'unread', 'useful', 'archived']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function canonicalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw validationError('History timestamp must be a canonical ISO date');
  }
  return value;
}

function validateMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).some(key => !['changedFields', 'fromStatus', 'toStatus', 'remindAt'].includes(key))) {
    throw validationError('Invalid history metadata');
  }
  if (!Array.isArray(raw.changedFields) || raw.changedFields.length > FIELDS.length
    || raw.changedFields.some(field => !FIELDS.includes(field))
    || new Set(raw.changedFields).size !== raw.changedFields.length) throw validationError('Invalid history fields');
  const metadata = { changedFields: [...raw.changedFields] };
  for (const key of ['fromStatus', 'toStatus']) {
    if (raw[key] !== undefined) {
      if (!STATUSES.has(raw[key])) throw validationError('Invalid history status');
      metadata[key] = raw[key];
    }
  }
  if (raw.remindAt !== undefined) metadata.remindAt = raw.remindAt === null ? null : canonicalDate(raw.remindAt);
  return metadata;
}

function validateHistory(items) {
  if (!Array.isArray(items)) throw validationError('History must be an array');
  const seen = new Set();
  return items.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['id', 'type', 'occurredAt', 'metadata'].includes(key))
      || typeof item.id !== 'string' || !UUID.test(item.id) || seen.has(item.id)
      || !TYPES.has(item.type)) throw validationError('Invalid or duplicate history event');
    seen.add(item.id);
    return { id: item.id, type: item.type, occurredAt: canonicalDate(item.occurredAt), metadata: validateMetadata(item.metadata) };
  });
}

function historyChanges(before = {}, after = {}, kind) {
  if (kind === 'saved' || kind === 'imported') return { type: kind, metadata: { changedFields: [] } };
  const changedFields = FIELDS.filter(field => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
  if (!changedFields.length && !kind) return null;
  let type = kind;
  if (!type) {
    if (changedFields.includes('deletedAt')) type = after.deletedAt ? 'archived' : 'restored';
    else if (changedFields.includes('status')) type = after.status === 'archived' ? 'archived'
      : (after.status === 'useful' ? 'marked_useful' : 'status_changed');
    else if (changedFields.includes('remindAt')) type = 'snoozed';
    else if (changedFields.includes('notes')) type = 'note_updated';
    else if (changedFields.includes('saveReason')) type = 'save_reason_updated';
    else type = 'details_updated';
  }
  const metadata = { changedFields };
  if (changedFields.includes('status')) Object.assign(metadata, { fromStatus: before.status, toStatus: after.status });
  if (changedFields.includes('remindAt')) metadata.remindAt = after.remindAt || null;
  return { type, metadata };
}

async function recordHistory(transactionQuery, { linkId, actor, type, occurredAt = new Date(), metadata = { changedFields: [] } }) {
  if (!TYPES.has(type)) throw validationError('Invalid history type');
  const actorId = actor?.user?.id || (typeof actor === 'string' ? actor : null);
  await transactionQuery(
    'INSERT INTO link_events (id, link_id, actor_id, type, occurred_at, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    [makeId(), linkId, actorId, type, new Date(occurredAt), JSON.stringify(validateMetadata(metadata))]
  );
}

async function restoreHistory(transactionQuery, linkId, items, actor) {
  const events = validateHistory(items);
  for (const event of events) {
    await transactionQuery(
      'INSERT INTO link_events (id, link_id, actor_id, type, occurred_at, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      [event.id, linkId, actor?.user?.id || (typeof actor === 'string' ? actor : null), event.type,
        new Date(event.occurredAt), JSON.stringify(event.metadata)]
    );
  }
}

function rowToEvent(row) {
  const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
  return validateHistory([{ id: row.id, type: row.type, occurredAt: new Date(row.occurred_at).toISOString(), metadata }])[0];
}

function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw validationError('Invalid history cursor');
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('Noncanonical');
    const pair = JSON.parse(decoded.toString('utf8'));
    if (!Array.isArray(pair) || pair.length !== 2 || !UUID.test(pair[1])) throw new Error('Invalid pair');
    return [canonicalDate(pair[0]), pair[1]];
  } catch { throw validationError('Invalid history cursor'); }
}

async function readLinkHistory(id, { limit = '20', cursor } = {}) {
  if (typeof id !== 'string' || !id || id.length > 36) throw validationError('Invalid link ID');
  if (!/^\d{1,3}$/.test(String(limit)) || Number(limit) < 1 || Number(limit) > 100) throw validationError('History limit must be 1 to 100');
  const pair = cursor === undefined ? null : decodeCursor(cursor);
  const source = await query('SELECT id FROM links WHERE id=?', [id]);
  if (!source.rows.length) throw Object.assign(new Error('Link not found'), { statusCode: 404 });
  const result = await query(
    `SELECT id, type, occurred_at, metadata FROM link_events WHERE link_id=?
     ${pair ? 'AND (occurred_at < ? OR (occurred_at = ? AND BINARY id < BINARY ?))' : ''}
     ORDER BY occurred_at DESC, BINARY id DESC LIMIT ?`,
    [id, ...(pair ? [new Date(pair[0]), new Date(pair[0]), pair[1]] : []), Number(limit) + 1]
  );
  const events = result.rows.slice(0, Number(limit)).map(rowToEvent);
  const last = events.at(-1);
  return { events, nextCursor: result.rows.length > Number(limit) && last
    ? Buffer.from(JSON.stringify([last.occurredAt, last.id])).toString('base64url') : null };
}

async function readHistoryForExport(transactionQuery = query) {
  const result = await transactionQuery('SELECT link_id, id, type, occurred_at, metadata FROM link_events ORDER BY occurred_at DESC, BINARY id DESC');
  const history = new Map();
  for (const row of result.rows) {
    if (!history.has(row.link_id)) history.set(row.link_id, []);
    history.get(row.link_id).push(rowToEvent(row));
  }
  return history;
}

module.exports = { historyChanges, recordHistory, validateHistory, restoreHistory, readLinkHistory, readHistoryForExport };
