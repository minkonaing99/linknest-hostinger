'use strict';

const { sendJson, parseBody } = require('../http');
const { ensurePlainObject, publicUser } = require('../utils');
const {
  authenticateUser, createSession, destroySession,
  getAuthenticatedUser, issueTokenPair,
  revokeRefreshToken, findValidRefreshToken, findUserById,
} = require('../auth');
const { getClientIp, checkLoginRateLimit, recordFailedLogin, clearLoginAttempts } = require('../ratelimit');

const PUBLIC_PATHS = new Set([
  '/api/login',         '/api/v1/login',
  '/api/logout',        '/api/v1/logout',
  '/api/auth/token',    '/api/v1/auth/token',
  '/api/auth/refresh',  '/api/v1/auth/refresh',
  '/api/auth/logout',   '/api/v1/auth/logout',
  '/api/me',            '/api/v1/me',
]);

function is(pathname, ...candidates) {
  return candidates.includes(pathname);
}

async function handleLogin(req, res) {
  const ip = getClientIp(req);
  const rateCheck = checkLoginRateLimit(ip);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter));
    sendJson(res, 429, { error: 'Too many login attempts. Please try again later.' });
    return;
  }
  try {
    const body = await parseBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      sendJson(res, 400, { error: 'Username and password are required' });
      return;
    }
    const user = await authenticateUser(username, password);
    if (!user) {
      recordFailedLogin(ip);
      sendJson(res, 401, { error: 'Invalid username or password' });
      return;
    }
    clearLoginAttempts(ip);
    await createSession(res, user);
    sendJson(res, 200, { ok: true, user: publicUser(user) });
  } catch {
    sendJson(res, 400, { error: 'Bad request' });
  }
}

async function handleToken(req, res) {
  const ip = getClientIp(req);
  const rateCheck = checkLoginRateLimit(ip);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter));
    sendJson(res, 429, { error: 'Too many login attempts. Please try again later.' });
    return;
  }
  try {
    const body = await parseBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      sendJson(res, 400, { error: 'Username and password are required' });
      return;
    }
    const user = await authenticateUser(username, password);
    if (!user) {
      recordFailedLogin(ip);
      sendJson(res, 401, { error: 'Invalid username or password' });
      return;
    }
    clearLoginAttempts(ip);
    const tokens = await issueTokenPair(user);
    sendJson(res, 200, { ok: true, ...tokens });
  } catch {
    sendJson(res, 400, { error: 'Bad request' });
  }
}

async function handleRefresh(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req));
    const refreshToken = String(body.refreshToken || '').trim();
    if (!refreshToken) {
      sendJson(res, 400, { error: 'refreshToken is required' });
      return;
    }
    const storedToken = await findValidRefreshToken(refreshToken);
    if (!storedToken) {
      sendJson(res, 401, { error: 'Invalid or expired refresh token' });
      return;
    }
    const user = await findUserById(storedToken.userId, storedToken.username);
    if (!user) {
      sendJson(res, 401, { error: 'Invalid refresh token user' });
      return;
    }
    await revokeRefreshToken(refreshToken);
    const tokens = await issueTokenPair(user);
    sendJson(res, 200, { ok: true, ...tokens });
  } catch (error) {
    sendJson(res, error.statusCode || 400, error.payload || { error: error.message });
  }
}

async function handleAuthLogout(req, res) {
  try {
    const body = ensurePlainObject(await parseBody(req));
    const revoked = await revokeRefreshToken(String(body.refreshToken || '').trim());
    sendJson(res, 200, { ok: true, revoked });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

async function handleCookieLogout(req, res) {
  await destroySession(req, res);
  sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    sendJson(res, 401, { error: 'Authentication required' }, { 'Set-Cookie': '' });
    return;
  }
  sendJson(res, 200, { user: auth.user, authMethod: auth.method });
}

async function handle(req, res, reqUrl) {
  const p = reqUrl.pathname;
  const m = req.method;

  if (m === 'POST' && is(p, '/api/login', '/api/v1/login'))
    return handleLogin(req, res), true;
  if (m === 'POST' && is(p, '/api/auth/token', '/api/v1/auth/token'))
    return handleToken(req, res), true;
  if (m === 'POST' && is(p, '/api/auth/refresh', '/api/v1/auth/refresh'))
    return handleRefresh(req, res), true;
  if (m === 'POST' && is(p, '/api/auth/logout', '/api/v1/auth/logout'))
    return handleAuthLogout(req, res), true;
  if (m === 'POST' && is(p, '/api/logout', '/api/v1/logout'))
    return handleCookieLogout(req, res), true;
  if (m === 'GET' && is(p, '/api/me', '/api/v1/me'))
    return handleMe(req, res), true;

  return false;
}

module.exports = { handle, PUBLIC_PATHS };
