'use strict';

const { sendJson } = require('../http');
const { parsePositiveInt } = require('../utils');
const { query } = require('../db');
const { readTagCounts, fetchTitleForUrl } = require('../links');

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

async function handleStats(req, res) {
  try {
    const statsRes = await query(`
      SELECT
        SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END)                         AS total,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'unread' THEN 1 ELSE 0 END)   AS unread,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'saved' THEN 1 ELSE 0 END)    AS saved,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'useful' THEN 1 ELSE 0 END)   AS useful,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'archived' THEN 1 ELSE 0 END) AS archived
      FROM links
    `);
    const r = statsRes.rows[0];
    sendJson(res, 200, {
      total:    Number(r.total    || 0),
      unread:   Number(r.unread   || 0),
      saved:    Number(r.saved    || 0),
      useful:   Number(r.useful   || 0),
      archived: Number(r.archived || 0),
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleTags(req, res, reqUrl) {
  try {
    const limit = parsePositiveInt(reqUrl.searchParams.get('limit'), 20, 1, 50);
    const tags = await readTagCounts(limit);
    sendJson(res, 200, { tags });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function handleFetchTitle(req, res, reqUrl) {
  try {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      sendJson(res, 400, { error: 'url query parameter is required' });
      return;
    }
    const metadata = await fetchTitleForUrl(targetUrl);
    sendJson(res, 200, metadata);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handle(req, res, reqUrl) {
  const p = reqUrl.pathname;
  const m = req.method;

  if (m === 'GET' && is(p, '/api/stats', '/api/v1/stats'))
    return handleStats(req, res), true;
  if (m === 'GET' && is(p, '/api/tags', '/api/v1/tags'))
    return handleTags(req, res, reqUrl), true;
  if (m === 'GET' && is(p, '/api/fetch-title', '/api/v1/fetch-title'))
    return handleFetchTitle(req, res, reqUrl), true;

  return false;
}

module.exports = { handle };
