'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000000';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Mock bcryptjs before anything loads
const bcryptPath = require.resolve('bcryptjs');
require.cache[bcryptPath] = {
  id: bcryptPath, filename: bcryptPath, loaded: true,
  exports: {
    compare: async (plain, hash) => plain === hash,
    hash: async (plain) => plain,
  },
};

// Stable DB mock
let currentImpl = async () => ({ rows: [], rowCount: 0 });
const dbPath = require.resolve('../../lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: (...args) => currentImpl(...args),
    connectDb: async () => {},
    closeDb: async () => {},
    ensureAdminUser: async () => {},
  },
};

const { handle } = require('../../lib/routes/auth');
const { URL } = require('url');

// Queue-based mock
function seq(...results) {
  let i = 0;
  currentImpl = async () => (i < results.length ? results[i++] : { rows: [], rowCount: 0 });
}

const USER_ROW = {
  id: 'user-1',
  username: 'admin',
  password_hash: 'secret',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const USER_SELECT_ROW = {
  id: 'user-1',
  username: 'admin',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// Minimal HTTP server wrapping only the auth route handler
let server;
let port;

before(() => new Promise((resolve) => {
  server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost`);
    const handled = await handle(req, res, reqUrl);
    if (!handled) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve();
  });
}));

after(() => new Promise((resolve) => server.close(resolve)));

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---

describe('POST /api/login', () => {
  it('returns 200 and sets session cookie on valid credentials', async () => {
    seq(
      { rows: [USER_ROW], rowCount: 1 },  // authenticateUser SELECT
      { rows: [], rowCount: 1 },           // createSession INSERT
    );
    const res = await request('POST', '/api/login', { username: 'admin', password: 'secret' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.user.id);
    assert.ok(!res.body.user.passwordHash, 'passwordHash must not be in response');
    assert.ok(res.headers['set-cookie'], 'should set session cookie');
  });

  it('returns 401 on wrong password', async () => {
    seq({ rows: [USER_ROW], rowCount: 1 });
    const res = await request('POST', '/api/login', { username: 'admin', password: 'wrong' });
    assert.equal(res.status, 401);
  });

  it('returns 401 on unknown user', async () => {
    seq({ rows: [], rowCount: 0 });
    const res = await request('POST', '/api/login', { username: 'nobody', password: 'any' });
    assert.equal(res.status, 401);
  });

  it('returns 400 when username missing', async () => {
    const res = await request('POST', '/api/login', { password: 'secret' });
    assert.equal(res.status, 400);
  });

  it('returns 400 when password missing', async () => {
    const res = await request('POST', '/api/login', { username: 'admin' });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/auth/token', () => {
  it('returns 200 with access and refresh tokens on valid credentials', async () => {
    seq(
      { rows: [USER_ROW], rowCount: 1 },  // authenticateUser
      { rows: [], rowCount: 1 },           // createRefreshToken INSERT
    );
    const res = await request('POST', '/api/auth/token', { username: 'admin', password: 'secret' });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.ok(res.body.refreshToken);
    assert.equal(res.body.tokenType, 'Bearer');
  });

  it('returns 401 on invalid credentials', async () => {
    seq({ rows: [USER_ROW], rowCount: 1 });
    const res = await request('POST', '/api/auth/token', { username: 'admin', password: 'wrong' });
    assert.equal(res.status, 401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('returns 200 with new token pair for valid refresh token', async () => {
    const validRow = {
      token: 'hashed', user_id: 'user-1', username: 'admin',
      revoked_at: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    seq(
      { rows: [validRow], rowCount: 1 },       // findValidRefreshToken SELECT
      { rows: [USER_SELECT_ROW], rowCount: 1 }, // findUserById SELECT
      { rows: [], rowCount: 1 },                // revokeRefreshToken UPDATE
      { rows: [], rowCount: 1 },                // createRefreshToken INSERT (issueTokenPair)
    );
    const res = await request('POST', '/api/auth/refresh', { refreshToken: 'raw-token' });
    assert.equal(res.status, 200);
    assert.ok(res.body.accessToken);
    assert.ok(res.body.refreshToken);
  });

  it('returns 401 for invalid refresh token', async () => {
    seq({ rows: [], rowCount: 0 });
    const res = await request('POST', '/api/auth/refresh', { refreshToken: 'bad-token' });
    assert.equal(res.status, 401);
  });

  it('returns 400 when refreshToken field missing', async () => {
    const res = await request('POST', '/api/auth/refresh', {});
    assert.equal(res.status, 400);
  });
});

describe('POST /api/logout', () => {
  it('returns 200 and clears session cookie', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 0 });
    const res = await request('POST', '/api/logout', {});
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200 and revokes the refresh token', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 1 });
    const res = await request('POST', '/api/auth/logout', { refreshToken: 'some-token' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.revoked, true);
  });
});

describe('GET /api/me', () => {
  it('returns 401 when not authenticated', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 0 });
    const res = await request('GET', '/api/me');
    assert.equal(res.status, 401);
  });

  it('returns 200 with user when authenticated via bearer', async () => {
    // Issue a real access token first
    currentImpl = async () => ({ rows: [], rowCount: 1 });
    const { default: authModule } = await (async () => {
      const m = require('../../lib/auth');
      return { default: m };
    })();
    const { accessToken } = await authModule.issueTokenPair({ id: 'user-1', username: 'admin' });

    seq({ rows: [USER_SELECT_ROW], rowCount: 1 });
    const res = await request('GET', '/api/me', null, { authorization: `Bearer ${accessToken}` });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, 'user-1');
    assert.ok(res.body.authMethod);
  });
});
