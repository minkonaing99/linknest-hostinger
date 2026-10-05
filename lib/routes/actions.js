'use strict';

const { parseBody, sendJson } = require('../http');
const { performLinkAction, undoLinkAction } = require('../link-actions');
const { validationError } = require('../utils');

async function handle(req, res, reqUrl) {
  if (req.method !== 'POST') return false;
  const create = /^\/api\/(?:v1\/)?links\/actions$/.test(reqUrl.pathname);
  const undo = reqUrl.pathname.match(/^\/api\/(?:v1\/)?actions\/([^/]+)\/undo$/);
  if (!create && !undo) return false;
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    let body;
    try { body = await parseBody(req, 128_000); }
    catch { throw validationError('Invalid action JSON'); }
    if (undo && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) {
      throw validationError('Undo does not accept previous link values');
    }
    const result = create ? await performLinkAction(body, req._auth)
      : await undoLinkAction(decodeURIComponent(undo[1]), req._auth);
    sendJson(res, 200, result, headers);
  } catch (cause) {
    const status = cause instanceof URIError ? 400 : (cause.statusCode || 500);
    sendJson(res, status, { error: status >= 500 ? 'Could not change this action.'
      : cause instanceof URIError ? 'Invalid action ID' : cause.message }, headers);
  }
  return true;
}

module.exports = { handle };
