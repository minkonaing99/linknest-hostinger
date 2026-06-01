'use strict';

const http = require('http');
const { URL } = require('url');
const { isApiPath } = require('./utils');
const { requireAuth } = require('./auth');
const { sendJson } = require('./http');
const { handle: authHandle, PUBLIC_PATHS } = require('./routes/auth');
const { handle: metaHandle }    = require('./routes/meta');
const { handle: importHandle }  = require('./routes/import');
const { handle: linksHandle }   = require('./routes/links');
const { handle: tokensHandle }  = require('./routes/tokens');
const { handle: staticHandle }  = require('./routes/static');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (await authHandle(req, res, reqUrl)) return;

  if (isApiPath(reqUrl.pathname) && !PUBLIC_PATHS.has(reqUrl.pathname)) {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    // read-scoped API tokens may not use write endpoints
    if (auth.scope === 'read' && WRITE_METHODS.has(req.method)) {
      sendJson(res, 403, { error: 'This API token is read-only' });
      return;
    }
    req._auth = auth;
  }

  if (await metaHandle(req, res, reqUrl))    return;
  if (await tokensHandle(req, res, reqUrl))  return;
  if (await importHandle(req, res, reqUrl))  return;
  if (await linksHandle(req, res, reqUrl))   return;
  await staticHandle(req, res, reqUrl);
});

module.exports = { server };
