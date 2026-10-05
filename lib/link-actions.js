'use strict';

const { createHash } = require('node:crypto');
const { withTransaction } = require('./db');
const { updateLinkInTransaction, deleteLinkInTransaction, rowToLink } = require('./links');
const { recordHistory } = require('./link-history');
const { makeId, normalizeStoredEntry, validationError } = require('./utils');
const { ENTRY_NOTES_MAX_LENGTH } = require('./config');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['saved', 'unread', 'useful', 'archived']);
const BASE_FIELDS = ['status', 'first_meaningful_at', 'first_useful_at'];
const PUBLIC_FIELDS = { status: 'status', deleted_at: 'deletedAt', pinned: 'pinned', notes: 'notes' };
const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const entry = row => normalizeStoredEntry(rowToLink(row));

function actorId(actor) {
  const id = actor?.user?.id;
  if (typeof id !== 'string' || !id || id.length > 36) throw error('Authentication required', 401);
  return id;
}

function validateAction(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['requestId', 'kind', 'ids', 'status', 'takeaway'].includes(key))) throw validationError('Invalid action');
  if (!['archive', 'status'].includes(body.kind)) throw validationError('Invalid action kind');
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200
    || body.ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 36)
    || new Set(body.ids).size !== body.ids.length) throw validationError('Use 1 to 200 distinct link IDs');
  if (body.requestId !== undefined && (typeof body.requestId !== 'string' || !UUID.test(body.requestId))) throw validationError('Invalid request ID');
  if (body.kind === 'status' ? !STATUSES.has(body.status) : body.status !== undefined) throw validationError('Invalid action status');
  if (body.takeaway !== undefined && (body.kind !== 'status' || body.status !== 'useful' || body.ids.length !== 1
    || typeof body.takeaway !== 'string' || !body.takeaway.trim() || body.takeaway.trim().length > ENTRY_NOTES_MAX_LENGTH)) {
    throw validationError('Takeaway requires one useful link and valid notes');
  }
  return { ...body, ids: [...body.ids].sort(), requestId: body.requestId?.toLowerCase(), takeaway: body.takeaway?.trim() };
}

async function cleanup(query) {
  await query('DELETE FROM link_actions WHERE created_at < DATE_SUB(NOW(3), INTERVAL 1 DAY) ORDER BY created_at LIMIT 100');
}

async function cleanupExpiredActions() {
  return withTransaction(cleanup);
}

async function reserveAction(query, body, owner) {
  const id = makeId(), now = new Date(), expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  const fingerprint = createHash('sha256').update(JSON.stringify({ kind: body.kind, ids: body.ids,
    status: body.status, takeaway: body.takeaway })).digest('hex');
  try {
    await query(`INSERT INTO link_actions (id, actor_id, request_id, fingerprint, kind, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, owner, body.requestId || null, fingerprint, body.kind, now, expiresAt]);
    return { id, expiresAt };
  } catch (cause) {
    if (cause.code !== 'ER_DUP_ENTRY' || !body.requestId) throw cause;
    const result = await query('SELECT * FROM link_actions WHERE actor_id=? AND request_id=? FOR UPDATE', [owner, body.requestId]);
    const prior = result.rows[0];
    if (prior && new Date(prior.created_at).getTime() <= Date.now() - 86400000) throw error('Action receipt has expired', 410);
    if (!prior || prior.fingerprint !== fingerprint) throw error('Request ID already used for another action', 409);
    return { result: json(prior.result_json) };
  }
}

async function lockLinks(query, ids) {
  const result = await query('SELECT *, CAST(revision AS CHAR) AS revision FROM links WHERE id IN (?) ORDER BY id FOR UPDATE', [ids]);
  if (result.rows.length !== ids.length) throw error('Link not found', 404);
  return result.rows;
}

function snapshot(before, kind, notes, milestones) {
  const fields = [...(milestones ? BASE_FIELDS : ['status']), ...(kind === 'archive' ? ['deleted_at', 'pinned'] : []), ...(notes ? ['notes'] : [])];
  return Object.fromEntries(fields.map(field => [field, before[field] ?? null]));
}

async function storeItem(query, action, before, after, kind, notes, milestones = true) {
  await query('INSERT INTO link_action_items (action_id, link_id, before_values, after_revision) VALUES (?, ?, ?, ?)',
    [action.id, before.id, JSON.stringify(snapshot(before, kind, notes, milestones)), String(after.revision)]);
}

async function finishAction(query, action, entries) {
  const result = { entries, updated: entries.length, action: entries.length
    ? { id: action.id, undoExpiresAt: action.expiresAt.toISOString() } : null };
  await query('UPDATE link_actions SET result_json=? WHERE id=?', [JSON.stringify(result), action.id]);
  return result;
}

function notesForAction(row, body) {
  if (body.takeaway === undefined) return undefined;
  const notes = row.notes ? `${row.notes}\n\n${body.takeaway}` : body.takeaway;
  if (notes.length > ENTRY_NOTES_MAX_LENGTH) throw validationError(`Merged notes must be ${ENTRY_NOTES_MAX_LENGTH} characters or fewer`);
  return notes;
}

async function performLinkAction(input, actor) {
  const owner = actorId(actor), body = validateAction(input);
  return withTransaction(async query => {
    await cleanup(query);
    const action = await reserveAction(query, body, owner);
    if ('result' in action) return action.result;
    const rows = await lockLinks(query, body.ids);
    if (body.kind === 'status' && rows.some(row => row.deleted_at)) throw error('Archived links cannot change status', 409);
    const prepared = rows.map(row => ({ row, notes: notesForAction(row, body) }));
    const entries = [];
    for (const { row, notes } of prepared) {
      if (body.kind === 'archive' ? Boolean(row.deleted_at) : row.status === body.status && notes === undefined) continue;
      if (body.kind === 'archive') await deleteLinkInTransaction(query, row.id, {}, actor);
      else await updateLinkInTransaction(query, row.id, { status: body.status, ...(notes === undefined ? {} : { notes }) }, actor);
      const after = (await lockLinks(query, [row.id]))[0];
      await storeItem(query, action, row, after, body.kind, notes !== undefined);
      entries.push(entry(after));
    }
    return finishAction(query, action, entries);
  });
}

async function restoreItem(query, item, current, actor) {
  const values = json(item.before_values), fields = Object.keys(values), now = new Date();
  await query(`UPDATE links SET ${fields.map(field => `${field}=?`).join(', ')}, updated_at=?, revision=revision+1 WHERE id=?`,
    [...fields.map(field => ['deleted_at', 'first_meaningful_at', 'first_useful_at'].includes(field)
      && values[field] !== null ? new Date(values[field]) : values[field]), now, item.link_id]);
  const restored = (await lockLinks(query, [item.link_id]))[0];
  const changedFields = fields.filter(field => PUBLIC_FIELDS[field]
    && JSON.stringify(current[field] ?? null) !== JSON.stringify(values[field])).map(field => PUBLIC_FIELDS[field]);
  await recordHistory(query, { linkId: item.link_id, actor, type: 'action_undone', occurredAt: now,
    metadata: { changedFields, ...(current.status !== restored.status ? { fromStatus: current.status, toStatus: restored.status } : {}) } });
  return entry(restored);
}

async function undoLinkAction(id, actor) {
  const owner = actorId(actor);
  if (typeof id !== 'string' || !UUID.test(id)) throw validationError('Invalid action ID');
  return withTransaction(async query => {
    await cleanup(query);
    const action = (await query('SELECT * FROM link_actions WHERE id=? AND actor_id=? FOR UPDATE', [id, owner])).rows[0];
    if (!action) throw error('Action not found', 404);
    if (new Date(action.created_at).getTime() <= Date.now() - 86400000) throw error('Action receipt has expired', 410);
    if (action.undone_at) return json(action.undo_result);
    if (new Date(action.expires_at).getTime() <= Date.now()) throw error('Undo has expired', 410);
    const items = (await query('SELECT *, CAST(after_revision AS CHAR) AS after_revision FROM link_action_items WHERE action_id=? ORDER BY link_id', [id])).rows;
    if (!items.length) throw error('Action has no changes to undo', 409);
    let rows;
    try { rows = await lockLinks(query, items.map(item => item.link_id)); }
    catch (cause) { if (cause.statusCode === 404) throw error('A link changed or was deleted after this action', 409); throw cause; }
    const byId = new Map(rows.map(row => [row.id, row]));
    if (items.some(item => String(byId.get(item.link_id).revision) !== String(item.after_revision))) {
      throw error('A link changed after this action. Undo cannot replace newer changes.', 409);
    }
    const entries = [];
    for (const item of items) entries.push(await restoreItem(query, item, byId.get(item.link_id), actor));
    const result = { entries, updated: entries.length, action: null };
    await query('UPDATE link_actions SET undone_at=?, undo_result=? WHERE id=?', [new Date(), JSON.stringify(result), id]);
    return result;
  });
}

async function performEditorStatusUpdate(id, body, actor) {
  const owner = actorId(actor);
  if (typeof id !== 'string' || !id.trim() || id.length > 36) throw validationError('Invalid link ID');
  if (!body || !STATUSES.has(body.status)) throw validationError('Invalid status');
  return withTransaction(async query => {
    await cleanup(query);
    const before = (await lockLinks(query, [id]))[0];
    const saved = await updateLinkInTransaction(query, id, body, actor);
    if (before.status === body.status) return { entry: saved, action: null };
    const action = await reserveAction(query, { kind: 'status', ids: [id], status: body.status }, owner);
    const after = (await lockLinks(query, [id]))[0];
    await storeItem(query, action, before, after, 'status', body.status === 'useful' && before.notes !== after.notes, body.status === 'useful');
    const result = await finishAction(query, action, [entry(after)]);
    return { entry: result.entries[0], action: result.action };
  });
}

module.exports = { performLinkAction, undoLinkAction, performEditorStatusUpdate, cleanupExpiredActions };
