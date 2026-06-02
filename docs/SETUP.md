# SETUP — Link Nest

## Prerequisites

- Node.js (check Hostinger app settings for version; 18+ recommended)
- MySQL / MariaDB 11.8+ (Hostinger) or local MySQL 8+
- Python 3 (optional — for `scripts/import_links.py`)

## Install Steps

```bash
# 1. Clone
git clone <repo-url> link-nest
cd link-nest

# 2. Install deps (exactly three: bcryptjs, dotenv, mysql2)
npm install

# 3. Copy and fill env vars
cp .env.example .env
# Edit .env — see env vars section below

# 4. Apply DB migrations (via phpMyAdmin or mysql CLI)
mysql -u <user> -p <dbname> < database/001_initial.sql
mysql -u <user> -p <dbname> < database/002_retention.sql
mysql -u <user> -p <dbname> < database/003_api_tokens.sql

# 5. Start server
node server.js
# → http://localhost:3080
```

No build step. No hot-reload. Restart manually on code changes.

## Env Vars

| Variable | Required | Notes |
|----------|----------|-------|
| `DB_HOST` | Yes | e.g. `localhost` or Hostinger DB host |
| `DB_PORT` | Yes | typically `3306` |
| `DB_USER` | Yes | DB username |
| `DB_PASSWORD` | Yes | DB password |
| `DB_NAME` | Yes | database name (e.g. `u580993728_linknest`) |
| `JWT_SECRET` | Yes | min 32 chars; generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `LINKNEST_ADMIN_USERNAME` | Yes | auto-upserted at startup |
| `LINKNEST_ADMIN_PASSWORD` | Yes | auto-upserted at startup |
| `COOKIE_SECURE` | No | set `false` for local HTTP dev; `true` in production |
| `TRUSTED_PROXY` | No | set `true` only behind a reverse proxy (for correct IP rate limiting) |

## Common Errors + Fixes

| Error | Fix |
|-------|-----|
| `Error: JWT_SECRET must be at least 32 characters` | Generate and set `JWT_SECRET` in `.env` |
| `ER_NO_SUCH_TABLE: 'links'` | Run all migrations in `database/` order |
| `ECONNREFUSED` on DB | Check `DB_HOST`, `DB_PORT`, and that MySQL is running |
| iOS/extension save fails with 403 | Check API token scope — must be `write` |
| Rate limit on login in dev | Restart server to reset in-memory rate limiter |
| `ER_PARSE_ERROR` on tag query | Do not use `->` JSON operator — use `JSON_CONTAINS` (MariaDB 11.8 requirement) |

---

## Testing

**Framework:** `node:test` (built-in, zero deps)
**Runner:** `npm test` → `node --test`
**Coverage target:** 80%+
**Current:** 153 tests, 0 failures

### Test Types

| Type | Location | What it covers |
|------|----------|----------------|
| Unit | `test/utils.test.js` | `normalizeUrl`, `sanitizeEntry`, `parseLinkListQuery`, `buildSort` |
| Unit | `test/utils.ssrf.test.js` | `assertPublicUrl` SSRF guard |
| Integration | `test/links.test.js` | All DB ops in `lib/links.js` (mocked DB) |
| Integration | `test/auth.test.js` | Session, JWT, refresh token, API token flows |
| Route | `test/routes/auth.test.js` | Auth route handlers end-to-end |

### Run Tests

```bash
npm test                                               # all tests
node --test test/links.test.js                         # single file
node --test --test-name-pattern "normalizeUrl"         # by name pattern
```

### Mock Strategy

DB is injected into `require.cache` before loading `lib/links.js`:

```js
const dbPath = require.resolve('../lib/db');
require.cache[dbPath] = {
  exports: { query: mockFn, connectDb: async () => {}, closeDb: async () => {} }
};
```

Tests must set env vars before `lib/config.js` loads:

```js
process.env.DB_USER = 'test';
process.env.DB_NAME = 'test';
process.env.JWT_SECRET = 'a'.repeat(32);
```

### TDD Workflow

1. Write failing test (RED)
2. Run `npm test` — confirm failure
3. Write minimal implementation (GREEN)
4. Run `npm test` — confirm pass
5. Refactor (IMPROVE)
6. Verify coverage ≥ 80%

### Write New Tests

Add to `test/` or `test/routes/`. Follow existing mock pattern. No external test deps.

---

## Changelog

### [0.2.0] — 2026-06-01

#### Added
- Scoped API tokens (DB table, CRUD routes, Bearer auth)
- Browser extension (Manifest V3)
- Backend test suite: 153 tests across auth, links, utils, SSRF, routes

#### Fixed
- Archive page always returned 0 results (deleted_at filter bug)
- Replace all `alert()`/`confirm()` with toast notifications
- Treat URL-shaped title as missing — trigger auto-fetch
- Auto-fetch title in `createLink` when client sends blank or URL-as-title
- Remove stats cards from home page
- Mobile input zoom fix (font-size ≥ 16px)

### [0.1.0] — 2026-04-14

#### Added
- Initial release: link CRUD, cookie session auth, JWT + refresh token flow
- URL normalization with tracking param stripping
- SSRF guard on title fetch
- Browse, archive, editor, login, settings pages
- Import / export JSON
- Rate limiting on auth endpoints
- Hostinger MariaDB deployment
