'use strict';

const { sendJson } = require('../http');
const { readLinkSuggestions } = require('../link-suggestions');

async function handle(req, res, reqUrl) {
  if (req.method !== 'GET') return false;
  const match = reqUrl.pathname.match(/^\/api\/(?:v1\/)?links\/([^/]+)\/suggestions$/);
  if (!match) return false;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const suggestions = await readLinkSuggestions(decodeURIComponent(match[1]));
    sendJson(res, 200, { suggestions }, headers);
  } catch (error) {
    const status = error instanceof URIError ? 400 : (error.statusCode || 500);
    sendJson(res, status, { error: status >= 500 ? 'Could not load suggested connections.'
      : (error instanceof URIError ? 'Invalid link ID' : error.message) }, headers);
  }
  return true;
}

module.exports = { handle };
