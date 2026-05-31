const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('./db');
const {
  JWT_SECRET, AUTH_COOKIE_NAME, AUTH_SESSION_TTL_DAYS, COOKIE_SECURE,
  ACCESS_TOKEN_TTL_MINUTES, REFRESH_TOKEN_TTL_DAYS,
} = require('./config');
const { makeSessionToken, isApiPath, publicUser } = require('./utils');
const { sendJson } = require('./http');

function rowToUser(row) {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(
    raw
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function makeCookie(token, expiresAt) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function signJwt(payload, expiresInSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const content = `${encodedHeader}.${encodedBody}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(content).digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${content}.${signature}`;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [encodedHeader, encodedBody, signature] = parts;
  const content = `${encodedHeader}.${encodedBody}`;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(content).digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) throw new Error('Invalid token signature');
  const payload = JSON.parse(base64UrlDecode(encodedBody));
  if (!payload.exp || Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error('Token expired');
  }
  return payload;
}

function extractBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim() || null;
}

async function authenticateUser(username, password) {
  const res = await query('SELECT * FROM users WHERE username = ?', [username]);
  if (res.rows.length === 0) return null;
  const user = rowToUser(res.rows[0]);
  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return null;
  return user;
}

async function createSession(res, user) {
  const token = makeSessionToken();
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO sessions (token, user_id, username, created_at, expires_at) VALUES (?, ?, ?, NOW(), ?)',
    [hashToken(token), user.id, user.username, expiresAt]
  );
  res.setHeader('Set-Cookie', makeCookie(token, expiresAt));
}

async function destroySession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (token) await query('DELETE FROM sessions WHERE token = ?', [hashToken(token)]);
  if (res) res.setHeader('Set-Cookie', clearCookie());
}

async function getCookieSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return null;
  const sessionRes = await query('SELECT * FROM sessions WHERE token = ?', [hashToken(token)]);
  if (sessionRes.rows.length === 0) return null;
  const session = sessionRes.rows[0];
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await query('DELETE FROM sessions WHERE token = ?', [hashToken(token)]);
    return null;
  }
  const userRes = await query(
    'SELECT id, username, created_at, updated_at FROM users WHERE id = ?',
    [session.user_id]
  );
  if (userRes.rows.length === 0) return null;
  return rowToUser(userRes.rows[0]);
}

async function getBearerUser(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const payload = verifyJwt(token);
    const res = await query(
      'SELECT id, username, created_at, updated_at FROM users WHERE id = ? AND username = ?',
      [payload.sub, payload.username]
    );
    if (res.rows.length === 0) return null;
    return rowToUser(res.rows[0]);
  } catch {
    return null;
  }
}

async function getAuthenticatedUser(req) {
  const bearerUser = await getBearerUser(req);
  if (bearerUser) return { user: bearerUser, method: 'bearer' };
  const sessionUser = await getCookieSessionUser(req);
  if (sessionUser) return { user: sessionUser, method: 'cookie' };
  return null;
}

async function requireAuth(req, res) {
  const auth = await getAuthenticatedUser(req);
  if (auth) return auth;
  const { URL } = require('url');
  if (isApiPath(new URL(req.url, `http://${req.headers.host}`).pathname)) {
    sendJson(res, 401, { error: 'Authentication required' }, { 'Set-Cookie': clearCookie() });
  } else {
    res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store', 'Set-Cookie': clearCookie() });
    res.end();
  }
  return null;
}

function createAccessToken(user) {
  return signJwt({ sub: user.id, username: user.username, type: 'access' }, ACCESS_TOKEN_TTL_MINUTES * 60);
}

function refreshTokenExpiryDate() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function createRefreshToken(user) {
  const rawToken = makeSessionToken();
  const expiresAt = refreshTokenExpiryDate();
  await query(
    'INSERT INTO refresh_tokens (token, user_id, username, created_at, expires_at, revoked_at) VALUES (?, ?, ?, NOW(), ?, NULL)',
    [hashToken(rawToken), user.id, user.username, expiresAt]
  );
  return { refreshToken: rawToken, expiresAt: expiresAt.toISOString() };
}

async function issueTokenPair(user) {
  const accessToken = createAccessToken(user);
  const refresh = await createRefreshToken(user);
  return {
    tokenType: 'Bearer',
    accessToken,
    accessTokenExpiresIn: ACCESS_TOKEN_TTL_MINUTES * 60,
    refreshToken: refresh.refreshToken,
    refreshTokenExpiresAt: refresh.expiresAt,
    user: publicUser(user),
  };
}

async function revokeRefreshToken(token) {
  if (!token) return false;
  const timestamp = new Date().toISOString();
  const result = await query(
    'UPDATE refresh_tokens SET revoked_at=? WHERE token=? AND revoked_at IS NULL',
    [timestamp, hashToken(token)]
  );
  return Boolean(result.rowCount);
}

async function findValidRefreshToken(token) {
  if (!token) return null;
  const res = await query('SELECT * FROM refresh_tokens WHERE token = ?', [hashToken(token)]);
  if (res.rows.length === 0) return null;
  const rt = res.rows[0];
  if (rt.revoked_at) return null;
  if (new Date(rt.expires_at).getTime() <= Date.now()) {
    await query('DELETE FROM refresh_tokens WHERE token = ?', [hashToken(token)]);
    return null;
  }
  return { userId: rt.user_id, username: rt.username };
}

async function findUserById(id, username) {
  const res = await query(
    'SELECT id, username, created_at, updated_at FROM users WHERE id = ? AND username = ?',
    [id, username]
  );
  if (res.rows.length === 0) return null;
  return rowToUser(res.rows[0]);
}

module.exports = {
  parseCookies, makeCookie, clearCookie,
  authenticateUser, createSession, destroySession,
  getAuthenticatedUser, requireAuth,
  issueTokenPair, revokeRefreshToken, findValidRefreshToken,
  findUserById,
};
