'use strict';

const { sendJson, sendText, parseBody } = require('../http');
const { ensurePlainObject } = require('../utils');
const { importLinks, parseBookmarksHtml, readAllLinksForExport } = require('../links');

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

async function handleExport(req, res) {
  try {
    const links = await readAllLinksForExport();
    sendText(res, 200, JSON.stringify(links, null, 2) + '\n', 'application/json; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="links-export.json"',
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleImport(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req));
    const links = Array.isArray(body.links) ? body.links : [];
    if (links.length > 5000) {
      sendJson(res, 400, { error: 'Import batch cannot exceed 5000 items' });
      return;
    }
    const result = await importLinks(links);
    sendJson(res, 200, { ok: true, ...result });
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
  if (m === 'POST' && is(p, '/api/links/import', '/api/v1/links/import'))
    return handleImport(req, res), true;
  if (m === 'POST' && is(p, '/api/links/import-bookmarks', '/api/v1/links/import-bookmarks'))
    return handleImportBookmarks(req, res), true;

  return false;
}

module.exports = { handle };
