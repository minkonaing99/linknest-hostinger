'use strict';

const fs = require('fs');
const path = require('path');
const { sendJson, sendRedirect, sendFile, SECURITY_HEADERS } = require('../http');
const { getAuthenticatedUser, requireAuth, destroySession } = require('../auth');
const { PUBLIC_DIR, VIEWS_DIR, PROTECTED_PAGES, PUBLIC_PAGES } = require('../config');

async function handle(req, res, reqUrl) {
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET', ...SECURITY_HEADERS });
    res.end();
    return true;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/logout') {
    await destroySession(req, res);
    sendRedirect(res, '/login.html');
    return true;
  }

  if (req.method === 'GET' && PROTECTED_PAGES.has(reqUrl.pathname)) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/login.html') {
    const auth = await getAuthenticatedUser(req);
    if (auth) {
      sendRedirect(res, '/browse.html');
      return true;
    }
  }

  if (req.method === 'GET' && reqUrl.pathname === '/sw.js') {
    const swPath = path.join(PUBLIC_DIR, 'sw.js');
    fs.readFile(swPath, (err, data) => {
      if (err) { sendJson(res, 404, { error: 'Not found' }); return; }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'Service-Worker-Allowed': '/',
        ...SECURITY_HEADERS,
      });
      res.end(data);
    });
    return true;
  }

  const serverPage = PROTECTED_PAGES.has(reqUrl.pathname) || reqUrl.pathname === '/login.html';
  const root = serverPage ? VIEWS_DIR : PUBLIC_DIR;
  const requested = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const safePath  = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath  = path.join(root, safePath);
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }

  if (!PUBLIC_PAGES.has(reqUrl.pathname) && !PROTECTED_PAGES.has(reqUrl.pathname) && reqUrl.pathname.endsWith('.html')) {
    const auth = await requireAuth(req, res);
    if (!auth) return true;
  }

  sendFile(req, res, filePath);
  return true;
}

module.exports = { handle };
