'use strict';

const { sendJson, sendText, parseBody } = require('../http');
const { ensurePlainObject } = require('../utils');
const {
  importLinks, importRelationships, parseBookmarksHtml, previewImportLinks, previewImportRelationships,
  readAllLinksForExport, readAllRelationshipsForExport,
} = require('../links');
const { ENTRY_TITLE_MAX_LENGTH, ENTRY_NOTES_MAX_LENGTH } = require('../config');

const CSV_HEADERS = ['title', 'url', 'notes', 'status', 'date'];
const CSV_STATUSES = new Set(['saved', 'unread', 'useful', 'archived']);

function protectCsvCell(value) {
  const text = String(value || '');
  if (text.startsWith("'")) return `'${text}`;
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function toCsv(links) {
  const rows = [CSV_HEADERS, ...links.map(link => [
    protectCsvCell(link.title), link.url, protectCsvCell(link.notes), link.status, link.date,
  ])];
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function parseCsvRows(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ''; closed = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false; closed = true; continue;
    }
    if (closed && ![',', '\r', '\n'].includes(char)) throw new Error('Unexpected text after quoted field');
    if (char === '"') {
      if (field) throw new Error('Unexpected quote in unquoted field');
      quoted = true; continue;
    }
    if (char === ',') { pushField(); continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      pushRow(); continue;
    }
    field += char;
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (field || row.length) pushRow();
  return rows.filter(fields => fields.some(value => value !== ''));
}

function parseCsv(input) {
  const rows = parseCsvRows(input);
  if (!rows.length || rows[0].join(',') !== CSV_HEADERS.join(',')) {
    throw new Error(`CSV header must be ${CSV_HEADERS.join(',')}`);
  }
  if (rows.length - 1 > 5000) throw new Error('Import batch cannot exceed 5000 items');
  return rows.slice(1).map((fields, index) => parseCsvRecord(fields, index + 2));
}

function parseCsvRecord(fields, rowNumber) {
    if (fields.length !== CSV_HEADERS.length) throw new Error(`CSV row ${rowNumber} must have 5 columns`);
    const [rawTitle, url, rawNotes, status, date] = fields;
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { throw new Error(`CSV row ${rowNumber} has an invalid URL`); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error(`CSV row ${rowNumber} has an invalid URL`);
    if (!CSV_STATUSES.has(status)) throw new Error(`CSV row ${rowNumber} has an invalid status`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`CSV row ${rowNumber} has an invalid date`);
    const unprotect = value => value.startsWith("''") || /^'\s*[=+\-@]/.test(value) ? value.slice(1) : value;
    const title = unprotect(rawTitle), notes = unprotect(rawNotes);
    if (title.length > ENTRY_TITLE_MAX_LENGTH) throw new Error(`CSV row ${rowNumber} title is too long`);
    if (notes.length > ENTRY_NOTES_MAX_LENGTH) throw new Error(`CSV row ${rowNumber} notes are too long`);
    return { title, url, notes, status, date };
}

function parseImportSource(format, data) {
  if (!['json', 'csv', 'bookmarks', 'batch'].includes(format)) throw new Error('Unsupported import format');
  if (format === 'json') {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    const items = Array.isArray(parsed) ? parsed : parsed?.links;
    if (!Array.isArray(items)) throw new Error('JSON import must be an array or contain a links array');
    const relationships = Array.isArray(parsed?.relationships) ? parsed.relationships : [];
    return { items, invalid: [], relationships };
  }
  const text = String(data || '');
  if (format === 'csv') {
    const rows = parseCsvRows(text);
    if (!rows.length || rows[0].join(',') !== CSV_HEADERS.join(',')) {
      throw new Error(`CSV header must be ${CSV_HEADERS.join(',')}`);
    }
    const items = [], invalid = [];
    rows.slice(1).forEach((fields, offset) => {
      try { items.push({ ...parseCsvRecord(fields, offset + 2), _importIndex: offset + 1 }); }
      catch (error) { invalid.push({ index: offset + 1, state: 'invalid', input: {}, error: error.message }); }
    });
    return { items, invalid, relationships: [] };
  }
  if (format === 'bookmarks') {
    const items = [], invalid = [];
    const anchors = text.match(/<a\b[^>]*>[^<]*<\/a>/gi) || [];
    anchors.forEach((anchor, index) => {
      const parsed = parseBookmarksHtml(anchor);
      if (parsed.length) items.push({ ...parsed[0], _importIndex: index + 1 });
      else invalid.push({ index: index + 1, state: 'invalid', input: {}, error: 'Bookmark has no valid HTTP or HTTPS URL' });
    });
    return { items, invalid, relationships: [] };
  }
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return { items: lines.map((line, index) => {
    const parts = line.split('|');
    return { url: (parts.shift() || '').trim(), title: parts.join('|').trim(), _importIndex: index + 1 };
  }), invalid: [], relationships: [] };
}

function escapeMarkdown(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]{}])/g, '\\$1');
}

function markdownUrl(value) {
  const raw = String(value || '');
  try {
    const parsed = new URL(raw);
    if (['http:', 'https:'].includes(parsed.protocol) && !/[\r\n]/.test(raw)) return `<${parsed.toString()}>`;
  } catch {}
  return escapeMarkdown(raw);
}

function toMarkdown(links) {
  const sections = links.map(link => {
    const lines = [`## ${escapeMarkdown(link.title || link.url)}`, '', `- URL: ${markdownUrl(link.url)}`,
      `- Status: ${link.status}`, `- Saved: ${link.date}`];
    if (link.notes) lines.push('', '### Note', '', ...String(link.notes).split(/\r?\n/).map(line => `    ${escapeMarkdown(line)}`));
    return lines.join('\n');
  });
  return `# Link Nest Export\n\n${sections.join('\n\n')}\n`;
}

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

async function handleExport(req, res) {
  try {
    const [links, relationships] = await Promise.all([
      readAllLinksForExport(), readAllRelationshipsForExport(),
    ]);
    const backup = { version: 2, exportedAt: new Date().toISOString(), links, relationships };
    sendText(res, 200, JSON.stringify(backup, null, 2) + '\n', 'application/json; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="links-export.json"',
      'Cache-Control': 'private, no-store',
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handlePortableExport(req, res, format) {
  try {
    const links = await readAllLinksForExport();
    const csv = format === 'csv';
    sendText(res, 200, csv ? toCsv(links) : toMarkdown(links),
      csv ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8', {
        'Content-Disposition': `attachment; filename="links-export.${format}"`,
        'Cache-Control': 'private, no-store',
      });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleCsvImport(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req));
    const links = parseCsv(body.csv);
    const result = await importLinks(links);
    sendJson(res, 200, { ok: true, ...result, parsed: links.length });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleImportPreview(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req, 128_000_000));
    const source = parseImportSource(String(body.format || ''), body.data);
    const links = await previewImportLinks(source.items, source.invalid);
    const relationships = previewImportRelationships(source.relationships);
    sendJson(res, 200, { ...links, ...relationships });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleImport(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req));
    const links = Array.isArray(body.links) ? body.links : [];
    const relationships = Array.isArray(body.relationships) ? body.relationships : [];
    if (links.length > 5000) {
      sendJson(res, 400, { error: 'Import batch cannot exceed 5000 items' });
      return;
    }
    const result = await importLinks(links);
    const relationshipResult = await importRelationships(relationships);
    sendJson(res, 200, { ok: true, ...result, relationships: relationshipResult });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleImportBookmarks(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req));
    const html = String(body.html || '');
    if (!html) {
      sendJson(res, 400, { error: 'html field is required' });
      return;
    }
    const bookmarks = parseBookmarksHtml(html);
    if (!bookmarks.length) {
      sendJson(res, 400, { error: 'No valid bookmarks found in the file' });
      return;
    }
    const result = await importLinks(bookmarks);
    sendJson(res, 200, { ok: true, ...result, parsed: bookmarks.length });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handle(req, res, reqUrl) {
  const p = reqUrl.pathname;
  const m = req.method;

  if (m === 'GET' && is(p, '/api/links/export', '/api/v1/links/export'))
    return handleExport(req, res), true;
  if (m === 'GET' && is(p, '/api/links/export.csv', '/api/v1/links/export.csv'))
    return handlePortableExport(req, res, 'csv'), true;
  if (m === 'GET' && is(p, '/api/links/export.md', '/api/v1/links/export.md'))
    return handlePortableExport(req, res, 'md'), true;
  if (m === 'POST' && is(p, '/api/links/import', '/api/v1/links/import'))
    return handleImport(req, res), true;
  if (m === 'POST' && is(p, '/api/links/import-preview', '/api/v1/links/import-preview'))
    return handleImportPreview(req, res), true;
  if (m === 'POST' && is(p, '/api/links/import-csv', '/api/v1/links/import-csv'))
    return handleCsvImport(req, res), true;
  if (m === 'POST' && is(p, '/api/links/import-bookmarks', '/api/v1/links/import-bookmarks'))
    return handleImportBookmarks(req, res), true;

  return false;
}

module.exports = { handle, toCsv, parseCsv, toMarkdown, parseImportSource };
