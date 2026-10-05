'use strict';

const { query } = require('./db');
const { normalizeUrl, ensurePlainObject, validationError } = require('./utils');

function canonicalReadingUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)
      || !/^https?:\/\//i.test(value)) throw new Error();
    const parsed = new URL(value);
    if (parsed.username || parsed.password) throw new Error();
    return normalizeUrl(value);
  } catch { throw validationError('url must be one HTTP/HTTPS URL without credentials, at most 2,048 characters'); }
}

function validateReadingPosition(input, now = new Date()) {
  const body = ensurePlainObject(input);
  const url = canonicalReadingUrl(body.url);
  for (const [field, minimum, maximum] of [['ratio', 0, 1], ['offset', -100000, 100000], ['scrollHeight', 0, 100000000]]) {
    if (!Number.isFinite(body[field]) || body[field] < minimum || body[field] > maximum) {
      throw validationError(`${field} must be a finite number between ${minimum} and ${maximum}`);
    }
  }
  if (typeof body.anchor !== 'string' || body.anchor.length > 200 || /[\x00-\x1f\x7f]/.test(body.anchor)) {
    throw validationError('anchor must be plain heading text, at most 200 characters');
  }
  return { url, ratio: body.ratio, offset: body.offset, anchor: body.anchor,
    scrollHeight: body.scrollHeight, savedAt: now.toISOString() };
}

function importedReadingPosition(raw, url) {
  if (raw == null) return null;
  if (typeof raw.savedAt !== 'string' || !Number.isFinite(Date.parse(raw.savedAt))
    || new Date(raw.savedAt).toISOString() !== raw.savedAt) throw validationError('Invalid reading position savedAt');
  const position = validateReadingPosition(raw, new Date(raw.savedAt));
  if (position.url !== canonicalReadingUrl(url)) throw validationError('Reading position URL does not match link');
  return position;
}

function decodeReadingPosition(raw, url) {
  try { return importedReadingPosition(typeof raw === 'string' ? JSON.parse(raw) : raw, url); }
  catch { return null; }
}

function validId(id) {
  if (typeof id !== 'string' || !id || id.length > 36) {
    throw validationError('Invalid link ID');
  }
  return id;
}

async function lookupReadingLink(rawUrl) {
  const url = canonicalReadingUrl(rawUrl);
  const result = await query('SELECT id, url FROM links WHERE BINARY url=BINARY ? AND deleted_at IS NULL LIMIT 1', [url]);
  return result.rows[0] ? { id: result.rows[0].id, url: result.rows[0].url } : null;
}

async function activeReadingLink(id, rawUrl) {
  const url = canonicalReadingUrl(rawUrl);
  const result = await query('SELECT url, reading_position FROM links WHERE id=? AND deleted_at IS NULL', [validId(id)]);
  if (!result.rows.length) throw Object.assign(new Error('Link not found or archived. Save or restore it first.'), { statusCode: 404 });
  if (result.rows[0].url !== url) throw Object.assign(new Error('Link URL changed. Reopen the saved article.'), { statusCode: 409 });
  return result.rows[0];
}

async function readReadingPosition(id, rawUrl) {
  const row = await activeReadingLink(id, rawUrl);
  return decodeReadingPosition(row.reading_position, row.url);
}

async function saveReadingPosition(id, input, now = new Date()) {
  const position = validateReadingPosition(input, now);
  const result = await query('UPDATE links SET reading_position=? WHERE id=? AND BINARY url=BINARY ? AND deleted_at IS NULL',
    [JSON.stringify(position), validId(id), position.url]);
  if (!result.rowCount) await activeReadingLink(id, position.url);
  return position;
}

module.exports = { canonicalReadingUrl, validateReadingPosition, importedReadingPosition, decodeReadingPosition,
  lookupReadingLink, readReadingPosition, saveReadingPosition };
