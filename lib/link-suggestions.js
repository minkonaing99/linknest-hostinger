'use strict';

const { query } = require('./db');
const { normalizeTags, jaroWinkler, validationError } = require('./utils');
const { ENTRY_TAGS_MAX_COUNT, ENTRY_TAG_MAX_LENGTH } = require('./config');

function tagsFromRow(raw) {
  let tags = raw;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch { return []; }
  }
  return Array.isArray(tags) ? normalizeTags(tags.filter(tag => typeof tag === 'string'))
    .filter(tag => tag.length <= ENTRY_TAG_MAX_LENGTH).slice(0, ENTRY_TAGS_MAX_COUNT) : [];
}

function titleForMatching(link) {
  const title = typeof link.title === 'string' ? link.title.trim().replace(/\s+/g, ' ').slice(0, 300) : '';
  return title === link.url || /^https?:\/\//i.test(title) ? '' : title;
}

function rankSuggestions(source, candidates) {
  const sourceTags = tagsFromRow(source.tags);
  const sourceTitle = titleForMatching(source);
  return candidates.slice(0, 200).map(link => {
    const tags = new Set(tagsFromRow(link.tags));
    const sharedTags = sourceTags.filter(tag => tags.has(tag)).sort();
    const title = titleForMatching(link);
    const similarity = sourceTitle && title ? jaroWinkler(sourceTitle, title) : 0;
    return { link: { id: link.id, title: link.title || link.url, url: link.url, host: link.host },
      sharedTags, similarity };
  }).filter(item => item.sharedTags.length || item.similarity >= 0.85)
    .sort((a, b) => b.sharedTags.length - a.sharedTags.length || b.similarity - a.similarity
      || (a.link.id < b.link.id ? -1 : (a.link.id > b.link.id ? 1 : 0)))
    .slice(0, 5).map(({ link, sharedTags, similarity }) => ({ link, sharedTags,
      titleSimilarity: Number(similarity.toFixed(3)),
      reason: sharedTags.length ? `Shares tags: ${sharedTags.join(', ')}` : 'Similar title' }));
}

async function readLinkSuggestions(id) {
  if (typeof id !== 'string' || !id || id.length > 36) throw validationError('Invalid link ID');
  const sourceResult = await query('SELECT id, title, url, host, tags FROM links WHERE id=? AND deleted_at IS NULL AND status<>\'archived\'', [id]);
  if (!sourceResult.rows.length) throw Object.assign(new Error('Link not found or archived'), { statusCode: 404 });
  const source = sourceResult.rows[0];
  const tags = tagsFromRow(source.tags);
  const host = typeof source.host === 'string' ? source.host : '';
  if (!tags.length && !host) return [];
  const predicates = tags.map(() => 'JSON_CONTAINS(l.tags, JSON_QUOTE(?))');
  const sharedCount = predicates.length ? predicates.join(' + ') : '0';
  const matching = [host ? 'l.host=?' : 'FALSE', ...predicates].join(' OR ');
  const result = await query(
    `SELECT l.id, l.title, l.url, l.host, l.tags, (${sharedCount}) AS shared_count
     FROM links l WHERE l.id<>? AND l.deleted_at IS NULL AND l.status<>'archived'
       AND (${matching})
       AND NOT EXISTS (SELECT 1 FROM link_relationships r
         WHERE (r.link_id_a=? AND r.link_id_b=l.id) OR (r.link_id_b=? AND r.link_id_a=l.id))
     ORDER BY shared_count DESC, BINARY l.id ASC LIMIT ?`,
    [...tags, id, ...(host ? [host] : []), ...tags, id, id, 200]
  );
  return rankSuggestions(source, result.rows);
}

module.exports = { readLinkSuggestions };
