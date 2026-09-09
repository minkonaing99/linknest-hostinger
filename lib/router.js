'use strict';

const http = require('http');
const { URL } = require('url');
const { isApiPath } = require('./utils');
const { requireAuth } = require('./auth');
const { sendJson } = require('./http');
const { CORS_ORIGIN } = require('./config');
const { handle: authHandle, PUBLIC_PATHS } = require('./routes/auth');
const { handle: metaHandle }    = require('./routes/meta');
const { handle: importHandle }  = require('./routes/import');
const { handle: linksHandle }   = require('./routes/links');
const { handle: tokensHandle }  = require('./routes/tokens');
const { handle: staticHandle }  = require('./routes/static');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function routeRequest(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  // CORS preflight for cross-origin API calls (browser extension uses Bearer auth)
  if (CORS_ORIGIN && isApiPath(reqUrl.pathname)) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  if (req.method === 'GET' && reqUrl.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

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
}

const server = http.createServer((req, res) => {
  routeRequest(req, res).catch(error => {
    console.error('Unhandled request error:', error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, 500, { error: 'Internal server error' });
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

module.exports = { server };
