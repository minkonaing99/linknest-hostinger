'use strict';

const { sendJson, parseBody } = require('../http');
const { lookupReadingLink, readReadingPosition, saveReadingPosition } = require('../reading-position');

async function handle(req, res, reqUrl) {
  const prefix = ['/api/links/', '/api/v1/links/'].find(value => reqUrl.pathname.startsWith(value));
  if (!prefix) return false;
  const suffix = reqUrl.pathname.slice(prefix.length);
  const parts = suffix.split('/');
  const lookup = suffix === 'lookup' && req.method === 'GET';
  const position = parts.length === 2 && parts[1] === 'reading-position' && ['GET', 'PUT'].includes(req.method);
  if (!lookup && !position) return false;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const id = position ? decodeURIComponent(parts[0]) : null;
    const body = lookup ? { entry: await lookupReadingLink(reqUrl.searchParams.get('url')) }
      : { position: req.method === 'GET' ? await readReadingPosition(id, reqUrl.searchParams.get('url'))
        : await saveReadingPosition(id, await parseBody(req)) };
    sendJson(res, 200, body, headers);
  } catch (error) {
    const status = error instanceof URIError ? 400 : (error.statusCode || 500);
    sendJson(res, status, { error: status >= 500 ? 'Could not access reading position.'
      : (error instanceof URIError ? 'Invalid link ID' : error.message) }, headers);
  }
  return true;
}

module.exports = { handle };
