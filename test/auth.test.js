'use strict';

process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-00000000000000000000000000000';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Mock bcryptjs: compare(plain, hash) === true iff plain === hash
const bcryptPath = require.resolve('bcryptjs');
require.cache[bcryptPath] = {
  id: bcryptPath, filename: bcryptPath, loaded: true,
  exports: {
    compare: async (plain, hash) => plain === hash,
    hash: async (plain) => plain,
  },
};

// Stable DB mock with swappable implementation
let currentImpl = async () => ({ rows: [], rowCount: 0 });
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: (...args) => currentImpl(...args),
    connectDb: async () => {},
    closeDb: async () => {},
    ensureAdminUser: async () => {},
  },
};

const {
  authenticateUser, createSession, destroySession,
  getAuthenticatedUser,
  issueTokenPair, revokeRefreshToken, findValidRefreshToken,
} = require('../lib/auth');

// Queue-based mock: consumes results in order
function seq(...results) {
  let i = 0;
  currentImpl = async () => (i < results.length ? results[i++] : { rows: [], rowCount: 0 });
}

function makeReq(headers = {}) {
  return { headers, url: '/api/test', method: 'GET', socket: { remoteAddress: '127.0.0.1' } };
}

function makeRes() {
  const headers = {};
  return {
    headers,
    status: null,
    setHeader(name, val) { headers[name] = val; },
    writeHead(status, hdrs) { this.status = status; Object.assign(headers, hdrs || {}); },
    end() {},
  };
}

const USER_ROW = {
  id: 'user-1',
  username: 'admin',
  password_hash: 'secret',   // bcrypt mock: compare('secret', 'secret') === true
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const USER_SELECT_ROW = {
  id: 'user-1',
  username: 'admin',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const SESSION_ROW = {
  token: 'hashed-token',
  user_id: 'user-1',
  username: 'admin',
  created_at: '2026-01-01T00:00:00.000Z',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};

// ---

describe('authenticateUser', () => {
  it('returns user on correct credentials', async () => {
    seq({ rows: [USER_ROW], rowCount: 1 });
    const user = await authenticateUser('admin', 'secret');
    assert.ok(user);
    assert.equal(user.username, 'admin');
    assert.equal(user.id, 'user-1');
  });

  it('returns null on wrong password', async () => {
    seq({ rows: [USER_ROW], rowCount: 1 });
    const user = await authenticateUser('admin', 'wrong');
    assert.equal(user, null);
  });

  it('returns null on unknown user', async () => {
    seq({ rows: [], rowCount: 0 });
    const user = await authenticateUser('nobody', 'secret');
    assert.equal(user, null);
  });
});

describe('createSession', () => {
  it('sets Set-Cookie header with session name', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 1 });
    const res = makeRes();
    await createSession(res, { id: 'user-1', username: 'admin' });
    const cookie = res.headers['Set-Cookie'] || '';
    assert.ok(cookie.includes('linknest_session='), 'should set session cookie');
    assert.ok(cookie.includes('HttpOnly'), 'should be HttpOnly');
  });
});

describe('destroySession', () => {
  it('clears cookie when no session token in request', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 0 });
    const req = makeReq();
    const res = makeRes();
    await destroySession(req, res);
    const cookie = res.headers['Set-Cookie'] || '';
    assert.ok(cookie.startsWith('linknest_session=;'), 'should clear cookie');
  });

  it('deletes session from DB when token present in cookie', async () => {
    const calls = [];
    currentImpl = async (...args) => { calls.push(args[0]); return { rows: [], rowCount: 1 }; };
    const req = makeReq({ cookie: 'linknest_session=sometoken' });
    const res = makeRes();
    await destroySession(req, res);
    assert.ok(calls.some(sql => sql.includes('DELETE')), 'should DELETE session from DB');
  });
});

describe('getAuthenticatedUser — cookie session', () => {
  it('returns user for valid unexpired session', async () => {
    seq(
      { rows: [SESSION_ROW], rowCount: 1 },
      { rows: [USER_SELECT_ROW], rowCount: 1 },
    );
    const req = makeReq({ cookie: 'linknest_session=anytoken' });
    const auth = await getAuthenticatedUser(req);
    assert.ok(auth);
    assert.equal(auth.method, 'cookie');
    assert.equal(auth.user.username, 'admin');
  });

  it('returns null for expired session and deletes it', async () => {
    const expiredSession = { ...SESSION_ROW, expires_at: '2020-01-01T00:00:00.000Z' };
    seq(
      { rows: [expiredSession], rowCount: 1 },
      { rows: [], rowCount: 1 },  // DELETE expired
    );
    const req = makeReq({ cookie: 'linknest_session=anytoken' });
    const auth = await getAuthenticatedUser(req);
    assert.equal(auth, null);
  });

  it('returns null when session not found in DB', async () => {
    seq({ rows: [], rowCount: 0 });
    const req = makeReq({ cookie: 'linknest_session=ghost' });
    const auth = await getAuthenticatedUser(req);
    assert.equal(auth, null);
  });

  it('returns null when no cookie header', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 0 });
    const auth = await getAuthenticatedUser(makeReq({}));
    assert.equal(auth, null);
  });
});

describe('getAuthenticatedUser — bearer JWT', () => {
  it('returns user for valid access token', async () => {
    // Issue a real access token (INSERT refresh_token to DB)
    currentImpl = async () => ({ rows: [], rowCount: 1 });
    const { accessToken } = await issueTokenPair({ id: 'user-1', username: 'admin' });

    // getAuthenticatedUser calls getApiTokenUser first (api_tokens JOIN query → empty),
    // then getBearerUser (users SELECT → user row)
    seq(
      { rows: [], rowCount: 0 },              // api_tokens JOIN: no match
      { rows: [USER_SELECT_ROW], rowCount: 1 }, // users SELECT for bearer
    );
    const req = makeReq({ authorization: `Bearer ${accessToken}` });
    const auth = await getAuthenticatedUser(req);
    assert.ok(auth);
    assert.equal(auth.method, 'bearer');
    assert.equal(auth.user.id, 'user-1');
  });

  it('returns null for tampered JWT signature', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 0 });
    const req = makeReq({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.tampered' });
    const auth = await getAuthenticatedUser(req);
    assert.equal(auth, null);
  });

  it('returns null when no Authorization header', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 0 });
    const auth = await getAuthenticatedUser(makeReq({}));
    assert.equal(auth, null);
  });
});

describe('issueTokenPair', () => {
  it('returns accessToken, refreshToken, tokenType, and safe user shape', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 1 });
    const result = await issueTokenPair({ id: 'user-1', username: 'admin' });
    assert.equal(typeof result.accessToken, 'string');
    assert.equal(typeof result.refreshToken, 'string');
    assert.equal(result.tokenType, 'Bearer');
    assert.equal(typeof result.accessTokenExpiresIn, 'number');
    assert.ok(result.user.id === 'user-1');
    assert.ok(!result.user.passwordHash, 'passwordHash must not be exposed');
  });
});

describe('revokeRefreshToken', () => {
  it('returns true when token was revoked', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 1 });
    assert.equal(await revokeRefreshToken('some-raw-token'), true);
  });

  it('returns false when token not found', async () => {
    currentImpl = async () => ({ rows: [], rowCount: 0 });
    assert.equal(await revokeRefreshToken('nonexistent'), false);
  });

  it('returns false for null token', async () => {
    assert.equal(await revokeRefreshToken(null), false);
  });
});

describe('findValidRefreshToken', () => {
  it('returns token data for valid non-expired non-revoked token', async () => {
    const row = {
      token: 'hashed', user_id: 'user-1', username: 'admin',
      revoked_at: null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    seq({ rows: [row], rowCount: 1 });
    const result = await findValidRefreshToken('raw-token');
    assert.ok(result);
    assert.equal(result.userId, 'user-1');
    assert.equal(result.username, 'admin');
  });

  it('returns null for revoked token', async () => {
    const row = {
      token: 'hashed', user_id: 'user-1', username: 'admin',
      revoked_at: '2026-01-01T00:00:00.000Z',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    seq({ rows: [row], rowCount: 1 });
    assert.equal(await findValidRefreshToken('raw-token'), null);
  });

  it('returns null for expired token and deletes it', async () => {
    const row = {
      token: 'hashed', user_id: 'user-1', username: 'admin',
      revoked_at: null,
      expires_at: '2020-01-01T00:00:00.000Z',
    };
    seq(
      { rows: [row], rowCount: 1 },
      { rows: [], rowCount: 1 },  // DELETE expired
    );
    assert.equal(await findValidRefreshToken('raw-token'), null);
  });

  it('returns null when token not in DB', async () => {
    seq({ rows: [], rowCount: 0 });
    assert.equal(await findValidRefreshToken('raw-token'), null);
  });

  it('returns null for null token without DB call', async () => {
    const calls = [];
    currentImpl = async (...a) => { calls.push(a); return { rows: [], rowCount: 0 }; };
    assert.equal(await findValidRefreshToken(null), null);
    assert.equal(calls.length, 0, 'should not query DB for null token');
  });
});
