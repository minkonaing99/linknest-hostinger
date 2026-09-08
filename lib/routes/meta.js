'use strict';

const { sendJson } = require('../http');
const { parsePositiveInt } = require('../utils');
const { query } = require('../db');
const { readTagCounts, fetchTitleForUrl } = require('../links');

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function rate(meaningful, eligible) {
  return eligible ? Math.round((meaningful / eligible) * 100) : null;
}

async function handleStats(req, res, now = new Date()) {
  try {
    const currentStart = daysAgo(now, 44);
    const currentEnd = daysAgo(now, 14);
    const previousStart = daysAgo(now, 74);
    const previousEnd = currentStart;
    const statsRes = await query(`
      SELECT
        SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END)                         AS total,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'unread' THEN 1 ELSE 0 END)   AS unread,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'saved' THEN 1 ELSE 0 END)    AS saved,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'useful' THEN 1 ELSE 0 END)   AS useful,
        SUM(CASE WHEN deleted_at IS NULL AND status = 'archived' THEN 1 ELSE 0 END) AS archived,
        SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS current_eligible,
        SUM(CASE WHEN created_at >= ? AND created_at < ?
          AND first_meaningful_at >= DATE_ADD(created_at, INTERVAL 1 DAY)
          THEN 1 ELSE 0 END) AS current_meaningful,
        SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS previous_eligible,
        SUM(CASE WHEN created_at >= ? AND created_at < ?
          AND first_meaningful_at >= DATE_ADD(created_at, INTERVAL 1 DAY)
          THEN 1 ELSE 0 END) AS previous_meaningful
      FROM links
    `, [
      currentStart, currentEnd, currentStart, currentEnd,
      previousStart, previousEnd, previousStart, previousEnd,
    ]);
    const r = statsRes.rows[0];
    const current = {
      eligible: Number(r.current_eligible || 0),
      meaningful: Number(r.current_meaningful || 0),
    };
    const previous = {
      eligible: Number(r.previous_eligible || 0),
      meaningful: Number(r.previous_meaningful || 0),
    };
    current.rate = rate(current.meaningful, current.eligible);
    previous.rate = rate(previous.meaningful, previous.eligible);
    sendJson(res, 200, {
      total:    Number(r.total    || 0),
      unread:   Number(r.unread   || 0),
      saved:    Number(r.saved    || 0),
      useful:   Number(r.useful   || 0),
      archived: Number(r.archived || 0),
      revisit: {
        windowDays: 30,
        minimumAgeDays: 14,
        current,
        previous,
        percentagePointChange: current.rate === null || previous.rate === null
          ? null
          : current.rate - previous.rate,
        targetRate: previous.rate === null ? null : Math.min(previous.rate + 20, 100),
        buildingBaseline: previous.eligible === 0,
      },
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

module.exports = { handle, handleStats };
