const { query } = require('./db');
const { LIST_LIMIT_DEFAULT } = require('./config');
const {
  sanitizeEntry, normalizeStoredEntry,
  normalizeStatus, normalizeUrl, deriveHost, assertPublicUrl, jaroWinkler,
} = require('./utils');
const { fetchTitle } = require('./title');

function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return [];
}

function rowToLink(row) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    host: row.host,
    status: row.status,
    tags: parseTags(row.tags),
    pinned: Boolean(row.pinned),
    date: row.date,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    lastOpenedAt: row.last_opened_at ? new Date(row.last_opened_at).toISOString() : null,
    openedCount: Number(row.opened_count) || 0,
    remindAt: row.remind_at ? new Date(row.remind_at).toISOString() : null,
  };
}

async function fetchTitleForUrl(rawUrl) {
  const cleanedUrl = normalizeUrl(rawUrl);
  await assertPublicUrl(cleanedUrl);
  const host = deriveHost(cleanedUrl);
  const { title, needsManualEntry } = await fetchTitle(cleanedUrl, host);
  return { title: needsManualEntry ? '' : (title || cleanedUrl), url: cleanedUrl, host, needsManualEntry };
}

function parseBookmarksHtml(html) {
  const links = [];
  const regex = /<a\b([^>]*)>([^<]*)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const rawTitle = match[2].trim();
    const hrefMatch = attrs.match(/href="([^"]+)"/i);
    if (!hrefMatch) continue;
    const url = hrefMatch[1].trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    try { new URL(url); } catch { continue; }
    let date = new Date().toISOString().slice(0, 10);
    const dateMatch = attrs.match(/add_date="(\d+)"/i);
    if (dateMatch) {
      const d = new Date(Number(dateMatch[1]) * 1000);
      if (!isNaN(d.getTime()) && d.getFullYear() > 1990) {
        date = d.toISOString().slice(0, 10);
      }
    }
    links.push({ url, title: rawTitle || url, date, status: 'saved', tags: [] });
  }
  return links;
}

async function readLinks(queryOptions = {}) {
  const opts = {
    whereClause: 'deleted_at IS NULL',
    params: [],
    orderClause: 'pinned DESC, updated_at DESC, created_at DESC, id ASC',
    limit: LIST_LIMIT_DEFAULT,
    skip: 0,
    page: 1,
    ...queryOptions,
  };

  const [dataRes, countRes] = await Promise.all([
    query(
      `SELECT * FROM links WHERE ${opts.whereClause} ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`,
      [...opts.params, opts.limit, opts.skip]
    ),
    query(`SELECT COUNT(*) AS count FROM links WHERE ${opts.whereClause}`, opts.params),
  ]);

  const total = Number(countRes.rows[0].count);
  return {
    links: dataRes.rows.map(row => normalizeStoredEntry(rowToLink(row))),
    total,
    page: opts.page,
    limit: opts.limit,
    pages: total ? Math.ceil(total / opts.limit) : 0,
  };
}

async function readLink(id) {
  const res = await query('SELECT * FROM links WHERE id = ?', [id]);
  if (res.rows.length === 0) {
    throw Object.assign(new Error('Link not found'), { statusCode: 404, payload: { error: 'Link not found' } });
  }
  return normalizeStoredEntry(rowToLink(res.rows[0]));
}

async function readAllLinksForExport() {
  const res = await query('SELECT * FROM links ORDER BY updated_at DESC');
  return res.rows.map(row => normalizeStoredEntry(rowToLink(row)));
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.75;
const DUPLICATE_HOST_SCAN_LIMIT = 200;

async function findDuplicateCandidates(url, title) {
  const host = deriveHost(url);
  if (!host) return [];
  const res = await query(
    'SELECT id, url, title FROM links WHERE host = ? AND deleted_at IS NULL AND url != ? LIMIT ?',
    [host, url, DUPLICATE_HOST_SCAN_LIMIT]
  );
  const candidates = [];
  for (const row of res.rows) {
    const similarity = jaroWinkler(title || url, row.title || row.url);
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      candidates.push({ id: row.id, url: row.url, title: row.title, similarity: Math.round(similarity * 100) / 100 });
    }
  }
  return candidates.sort((a, b) => b.similarity - a.similarity);
}

async function createLink(input) {
  const entry = sanitizeEntry(input);
  const existing = await query(
    'SELECT id, url, deleted_at FROM links WHERE url = ?',
    [entry.url]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const error = new Error('This link already exists');
    error.statusCode = 409;
    error.payload = {
      error: row.deleted_at ? 'This link already exists but is archived' : 'This link already exists',
      url: entry.url,
      id: row.id,
      archived: Boolean(row.deleted_at),
    };
    throw error;
  }
  await query(
    `INSERT INTO links (id, url, title, host, status, tags, pinned, date, created_at, updated_at, deleted_at, remind_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.url, entry.title, entry.host, entry.status, JSON.stringify(entry.tags),
     entry.pinned ? 1 : 0, entry.date, entry.createdAt, entry.updatedAt, entry.deletedAt, entry.remindAt]
  );
  const saved = normalizeStoredEntry(entry);
  const duplicateCandidates = await findDuplicateCandidates(entry.url, entry.title);
  return { entry: saved, duplicateCandidates };
}

async function importLinks(items) {
  let imported = 0;
  for (const raw of items) {
    try {
      const entry = sanitizeEntry(raw);
      const result = await query(
        `INSERT IGNORE INTO links (id, url, title, host, status, tags, pinned, date, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entry.id, entry.url, entry.title, entry.host, entry.status, JSON.stringify(entry.tags),
         entry.pinned ? 1 : 0, entry.date, entry.createdAt, entry.updatedAt, entry.deletedAt]
      );
      if (result.rowCount > 0) imported++;
    } catch {}
  }
  const countRes = await query('SELECT COUNT(*) AS count FROM links WHERE deleted_at IS NULL');
  return { imported, total: Number(countRes.rows[0].count) };
}

async function updateLink(id, body) {
  const currentRes = await query('SELECT * FROM links WHERE id = ?', [id]);
  if (currentRes.rows.length === 0) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }
  const current = normalizeStoredEntry(rowToLink(currentRes.rows[0]));
  const entry = sanitizeEntry({ ...current, ...body, id }, { existing: current });

  const dupRes = await query(
    'SELECT id FROM links WHERE url = ? AND id != ?',
    [entry.url, id]
  );
  if (dupRes.rows.length > 0) {
    const error = new Error('Another link already uses this URL');
    error.statusCode = 409;
    error.payload = { error: 'Another link already uses this URL' };
    throw error;
  }

  await query(
    `UPDATE links
     SET url=?, title=?, host=?, status=?, tags=?, pinned=?,
         date=?, created_at=?, updated_at=?, deleted_at=?, remind_at=?
     WHERE id=?`,
    [entry.url, entry.title, entry.host, entry.status, JSON.stringify(entry.tags),
     entry.pinned ? 1 : 0, entry.date, entry.createdAt, entry.updatedAt, entry.deletedAt, entry.remindAt, id]
  );
  return normalizeStoredEntry(entry);
}

async function deleteLink(id, options = {}) {
  const currentRes = await query('SELECT id FROM links WHERE id = ?', [id]);
  if (currentRes.rows.length === 0) {
    const error = new Error('Link not found');
    error.statusCode = 404;
    error.payload = { error: 'Link not found' };
    throw error;
  }

  if (options.hardDelete) {
    await query('DELETE FROM links WHERE id = ?', [id]);
  } else {
    const deletedAt = new Date().toISOString();
    await query(
      `UPDATE links SET deleted_at=?, updated_at=?, status='archived', pinned=0 WHERE id=?`,
      [deletedAt, deletedAt, id]
    );
  }

  const countRes = await query('SELECT COUNT(*) AS count FROM links WHERE deleted_at IS NULL');
  return { total: Number(countRes.rows[0].count) };
}

async function restoreLink(id) {
  const currentRes = await query('SELECT * FROM links WHERE id = ?', [id]);
  if (currentRes.rows.length === 0) {
    throw Object.assign(new Error('Link not found'), {
      statusCode: 404,
      payload: { error: 'Link not found' },
    });
  }
  const current = normalizeStoredEntry(rowToLink(currentRes.rows[0]));
  if (!current.deletedAt) return current;

  const restoredAt = new Date().toISOString();
  const newStatus = current.status === 'archived' ? 'saved' : normalizeStatus(current.status || 'saved');
  await query(
    'UPDATE links SET deleted_at=NULL, updated_at=?, status=? WHERE id=?',
    [restoredAt, newStatus, id]
  );
  return normalizeStoredEntry({ ...current, deletedAt: null, updatedAt: restoredAt, status: newStatus });
}

async function openLink(id) {
  const currentRes = await query('SELECT id FROM links WHERE id = ? AND deleted_at IS NULL', [id]);
  if (currentRes.rows.length === 0) {
    throw Object.assign(new Error('Link not found'), { statusCode: 404, payload: { error: 'Link not found' } });
  }
  const now = new Date().toISOString();
  await query(
    'UPDATE links SET last_opened_at=?, opened_count=opened_count+1, updated_at=? WHERE id=?',
    [now, now, id]
  );
  return readLink(id);
}

async function readTagCounts(limit = 20) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
  const res = await query(
    `SELECT t.tag, COUNT(*) AS count
     FROM links
     CROSS JOIN JSON_TABLE(tags, '$[*]' COLUMNS (tag VARCHAR(200) PATH '$')) AS t
     WHERE deleted_at IS NULL
     GROUP BY t.tag
     ORDER BY count DESC
     LIMIT ?`,
    [safeLimit]
  );
  return res.rows.map(r => ({ tag: r.tag, count: Number(r.count) }));
}

async function bulkUpdateStatus(ids, status) {
  if (!Array.isArray(ids) || ids.length === 0) {
    const error = new Error('ids must be a non-empty array');
    error.statusCode = 400;
    error.payload = { error: 'ids must be a non-empty array' };
    throw error;
  }
  if (ids.length > 200) {
    const error = new Error('Cannot update more than 200 links at once');
    error.statusCode = 400;
    error.payload = { error: 'Cannot update more than 200 links at once' };
    throw error;
  }
  const normalized = normalizeStatus(status);
  const updatedAt = new Date().toISOString();
  const result = await query(
    'UPDATE links SET status=?, updated_at=? WHERE id IN (?) AND deleted_at IS NULL',
    [normalized, updatedAt, ids]
  );
  return { updated: result.rowCount };
}

module.exports = {
  fetchTitleForUrl, parseBookmarksHtml,
  readLink, readLinks, readAllLinksForExport,
  createLink, importLinks, updateLink, deleteLink, restoreLink,
  readTagCounts, bulkUpdateStatus, openLink, findDuplicateCandidates,
};
