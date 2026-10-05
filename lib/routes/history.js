'use strict';

const { sendJson } = require('../http');
const { validationError } = require('../utils');
const { readLinkHistory } = require('../link-history');

async function handle(req, res, reqUrl) {
  if (req.method !== 'GET') return false;
  const match = reqUrl.pathname.match(/^\/api\/(?:v1\/)?links\/([^/]+)\/history$/);
  if (!match) return false;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    for (const key of reqUrl.searchParams.keys()) {
      if (!['limit', 'cursor'].includes(key) || reqUrl.searchParams.getAll(key).length !== 1) {
        throw validationError('Invalid history query');
      }
    }
    const result = await readLinkHistory(decodeURIComponent(match[1]), {
      limit: reqUrl.searchParams.get('limit') ?? '20', cursor: reqUrl.searchParams.get('cursor') ?? undefined,
    });
    sendJson(res, 200, result, headers);
  } catch (error) {
    const status = error instanceof URIError ? 400 : (error.statusCode || 500);
    sendJson(res, status, { error: status >= 500 ? 'Could not load link history.'
      : (error instanceof URIError ? 'Invalid link ID' : error.message) }, headers);
  }
  return true;
}

module.exports = { handle };
