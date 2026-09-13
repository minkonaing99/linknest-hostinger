'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000';

const test = require('node:test');
const assert = require('node:assert/strict');

const authPath = require.resolve('../lib/auth');
const httpPath = require.resolve('../lib/http');
const staticPath = require.resolve('../lib/routes/static');

function loadStaticRoute(authenticated, sentFiles) {
  delete require.cache[staticPath];
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
    getAuthenticatedUser: async () => null,
    destroySession: async () => {},
    requireAuth: async (_req, res) => {
      if (authenticated) return { user: { id: 'user-1' } };
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return null;
    },
  } };
  require.cache[httpPath] = { id: httpPath, filename: httpPath, loaded: true, exports: {
    SECURITY_HEADERS: {},
    sendJson: () => {},
    sendRedirect: () => {},
    sendFile: (_req, res, file) => { sentFiles.push(file); res.end(); },
  } };
  return require('../lib/routes/static').handle;
}

function response() {
  return { status: null, headers: null, ended: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end() { this.ended = true; },
  };
}

test('rejects unauthenticated protected HTML before reading its file', async () => {
  const sentFiles = [], res = response();
  const handle = loadStaticRoute(false, sentFiles);
  await handle({ method: 'GET' }, res, new URL('https://example.com/settings.html'));
  assert.equal(res.status, 302);
  assert.equal(res.headers.Location, '/login.html');
  assert.deepEqual(sentFiles, []);
});

for (const method of ['HEAD', 'POST']) {
  test(`rejects ${method} static requests without reading protected HTML`, async () => {
    const sentFiles = [], res = response();
    const handle = loadStaticRoute(false, sentFiles);
    await handle({ method }, res, new URL('https://example.com/settings.html'));
    assert.equal(res.status, 405);
    assert.equal(res.headers.Allow, 'GET');
    assert.deepEqual(sentFiles, []);
  });
}

test('serves authenticated protected HTML from private views', async () => {
  const sentFiles = [], res = response();
  const handle = loadStaticRoute(true, sentFiles);
  await handle({ method: 'GET' }, res, new URL('https://example.com/settings.html'));
  assert.match(sentFiles[0], /views\/settings\.html$/);
});

test('serves public login HTML through Node from private views', async () => {
  const sentFiles = [], res = response();
  const handle = loadStaticRoute(false, sentFiles);
  await handle({ method: 'GET' }, res, new URL('https://example.com/login.html'));
  assert.match(sentFiles[0], /views\/login\.html$/);
});
