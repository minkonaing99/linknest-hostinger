'use strict';

const { sendJson } = require('../http');
const { parsePositiveInt } = require('../utils');
const { query } = require('../db');
const { readTagCounts, fetchTitleForUrl } = require('../links');

const DAY_MS = 24 * 60 * 60 * 1000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const STATS_SQL = `
  SELECT
    SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS total,
    SUM(CASE WHEN deleted_at IS NULL AND status = 'unread' THEN 1 ELSE 0 END) AS unread,
    SUM(CASE WHEN deleted_at IS NULL AND status = 'saved' THEN 1 ELSE 0 END) AS saved,
    SUM(CASE WHEN deleted_at IS NULL AND status = 'useful' THEN 1 ELSE 0 END) AS useful,
    SUM(CASE WHEN deleted_at IS NULL AND status = 'archived' THEN 1 ELSE 0 END) AS archived,
    SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS current_eligible,
    SUM(CASE WHEN created_at >= ? AND created_at < ?
      AND first_meaningful_at >= DATE_ADD(created_at, INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS current_meaningful,
    SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS previous_eligible,
    SUM(CASE WHEN created_at >= ? AND created_at < ?
      AND first_meaningful_at >= DATE_ADD(created_at, INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS previous_meaningful,
    SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS weekly_saved,
    SUM(CASE WHEN first_meaningful_at >= ? AND first_meaningful_at < ?
      AND first_meaningful_at >= DATE_ADD(created_at, INTERVAL 1 DAY) THEN 1 ELSE 0 END) AS weekly_reviewed,
    SUM(CASE WHEN first_useful_at >= ? AND first_useful_at < ?
      THEN 1 ELSE 0 END) AS weekly_useful
  FROM links`;
const OLDEST_UNRESOLVED_SQL = `SELECT id, title, created_at FROM links
  WHERE deleted_at IS NULL
    AND status IN ('saved', 'unread')
    AND host NOT IN ('youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com')
    AND (first_meaningful_at IS NULL
      OR first_meaningful_at < DATE_ADD(created_at, INTERVAL 1 DAY))
    AND created_at <= ?
  ORDER BY created_at ASC, id ASC LIMIT 1`;

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * DAY_MS);
}

function rate(meaningful, eligible) {
  return eligible ? Math.round((meaningful / eligible) * 100) : null;
}

function thailandWeekBounds(now) {
  const local = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
    - BANGKOK_OFFSET_MS;
  return { start: new Date(today - 6 * DAY_MS), end: new Date(today + DAY_MS) };
}

function cohort(row, prefix) {
  const result = {
    eligible: Number(row[`${prefix}_eligible`] || 0),
    meaningful: Number(row[`${prefix}_meaningful`] || 0),
  };
  return { ...result, rate: rate(result.meaningful, result.eligible) };
}

function oldestUnresolved(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    title: String(row.title || 'Untitled link'),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function handleStats(req, res, now = new Date()) {
  try {
    const currentStart = daysAgo(now, 44);
    const currentEnd = daysAgo(now, 14);
    const previousStart = daysAgo(now, 74);
    const previousEnd = currentStart;
    const week = thailandWeekBounds(now);
    const [statsRes, oldestRes] = await Promise.all([
      query(STATS_SQL, [
        currentStart, currentEnd, currentStart, currentEnd,
        previousStart, previousEnd, previousStart, previousEnd,
        week.start, week.end, week.start, week.end, week.start, week.end,
      ]),
      query(OLDEST_UNRESOLVED_SQL, [daysAgo(now, 14)]),
    ]);
    const r = statsRes.rows[0];
    const current = cohort(r, 'current');
    const previous = cohort(r, 'previous');
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
      weekly: {
        windowDays: 7,
        timeZone: 'Asia/Bangkok',
        start: week.start.toISOString(),
        end: week.end.toISOString(),
        saved: Number(r.weekly_saved || 0),
        reviewed: Number(r.weekly_reviewed || 0),
        usefulDecisions: Number(r.weekly_useful || 0),
        revisitPercentage: current.rate,
        oldestUnresolved: oldestUnresolved(oldestRes.rows[0]),
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
