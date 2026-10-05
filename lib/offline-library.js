'use strict';

const { withTransaction } = require('./db');
const MAX_BYTES = 25 * 1024 * 1024;
const ACTIVE_LINKS = "deleted_at IS NULL AND status <> 'archived'";

function offlineLink(row) {
  let tags = row.tags;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch { tags = []; }
  }
  return {
    id: row.id, title: row.title, url: row.url, status: row.status,
    tags: Array.isArray(tags) ? [...tags] : [], notes: row.notes || '', saveReason: row.save_reason || '',
    pinned: Boolean(row.pinned), date: row.date,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function offlineSnapshot(userId) {
  return withTransaction(async transactionQuery => {
    const counted = await transactionQuery(`SELECT COUNT(*) AS total FROM links WHERE ${ACTIVE_LINKS}`);
    const selected = await transactionQuery(`SELECT id, title, url, status, tags, notes, save_reason,
      pinned, date, created_at, updated_at FROM links WHERE ${ACTIVE_LINKS}
      ORDER BY updated_at DESC, id ASC LIMIT 2000`);
    const snapshot = { schemaVersion: 1, userId, links: [], total: Number(counted.rows[0].total),
      complete: false, downloadedAt: new Date().toISOString() };
    let bytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
    const links = [];
    for (const row of selected.rows) {
      const link = offlineLink(row);
      const added = Buffer.byteLength(JSON.stringify(link), 'utf8') + (links.length ? 1 : 0);
      if (bytes + added > MAX_BYTES) break;
      bytes += added;
      links.push(link);
    }
    return { ...snapshot, links, complete: links.length === snapshot.total };
  }, { consistentRead: true });
}

module.exports = { offlineSnapshot };
