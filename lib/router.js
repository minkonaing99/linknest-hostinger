'use strict';

const http = require('http');
const { URL } = require('url');
const { isApiPath } = require('./utils');
const { requireAuth } = require('./auth');
const { handle: authHandle, PUBLIC_PATHS } = require('./routes/auth');
const { handle: metaHandle }   = require('./routes/meta');
const { handle: importHandle } = require('./routes/import');
const { handle: linksHandle }  = require('./routes/links');
const { handle: staticHandle } = require('./routes/static');

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (await authHandle(req, res, reqUrl)) return;

  if (isApiPath(reqUrl.pathname) && !PUBLIC_PATHS.has(reqUrl.pathname)) {
    if (!await requireAuth(req, res)) return;
  }

  if (await metaHandle(req, res, reqUrl))   return;
  if (await importHandle(req, res, reqUrl)) return;
  if (await linksHandle(req, res, reqUrl))  return;
  await staticHandle(req, res, reqUrl);
});

module.exports = { server };
