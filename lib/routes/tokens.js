'use strict';

const { sendJson, parseBody } = require('../http');
const { ensurePlainObject, validationError } = require('../utils');
const { createApiToken, listApiTokens, revokeApiToken } = require('../auth');

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

function tokenId(pathname) {
  for (const prefix of ['/api/tokens/', '/api/v1/tokens/']) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    if (!rest || rest.includes('/')) continue;
    return decodeURIComponent(rest);
  }
  return null;
}

async function handleCreate(req, res) {
  try {
    const auth = req._auth;
    if (!auth) { sendJson(res, 401, { error: 'Authentication required' }); return; }
    const body = ensurePlainObject(await parseBody(req));
    const name = String(body.name || '').trim();
    if (!name) throw validationError('name is required');
    if (name.length > 100) throw validationError('name must be 100 characters or fewer');
    const scope = String(body.scope || 'write').trim();
    if (!['read', 'write'].includes(scope)) throw validationError('scope must be read or write');
    const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)).toISOString() : null;
    const rawToken = await createApiToken(auth.user, name, scope, expiresAt);
    sendJson(res, 201, { ok: true, token: rawToken, name, scope });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleList(req, res) {
  try {
    const auth = req._auth;
    if (!auth) { sendJson(res, 401, { error: 'Authentication required' }); return; }
    const tokens = await listApiTokens(auth.user.id);
    sendJson(res, 200, { tokens });
  } catch (error) {
    sendJson(res, error.statusCode || 500, error.payload || { error: error.message });
  }
}

async function handleRevoke(req, res, id) {
  try {
    const auth = req._auth;
    if (!auth) { sendJson(res, 401, { error: 'Authentication required' }); return; }
    const revoked = await revokeApiToken(id, auth.user.id);
    if (!revoked) { sendJson(res, 404, { error: 'Token not found or already revoked' }); return; }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, error.statusCode || 500, error.payload || { error: error.message });
  }
}

async function handle(req, res, reqUrl) {
  const p = reqUrl.pathname;
  const m = req.method;
  const id = tokenId(p);

  if (m === 'GET'    && is(p, '/api/tokens', '/api/v1/tokens')) return handleList(req, res),       true;
  if (m === 'POST'   && is(p, '/api/tokens', '/api/v1/tokens')) return handleCreate(req, res),     true;
  if (m === 'DELETE' && id)                                      return handleRevoke(req, res, id), true;

  return false;
}

module.exports = { handle };
