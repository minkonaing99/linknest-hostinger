# TECH — Link Nest

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js (no version pinned) | Zero-cost on shared hosting; native `http` module avoids framework overhead |
| HTTP | `node:http` (no Express) | Reduces dep surface; custom router is 28 lines |
| Auth | Hand-rolled HMAC-SHA256 JWT + bcrypt sessions | No JWT lib dep; bcryptjs for password hashing |
| Database | MariaDB 11.8 via `mysql2` pool | Hostinger constraint; `?` placeholders prevent SQL injection |
| Frontend | Plain HTML + vanilla JS | No build step, no bundler, instant deploys |
| Testing | `node:test` (built-in) | Zero test deps |
| Extension | Browser WebExtension (Manifest V3) | Chrome/Firefox compatible |

## Folder Structure

```
link-nest/
├── server.js              entry point — creates HTTP server, calls connectDb, starts listening
├── lib/
│   ├── router.js          thin dispatcher (28 lines) — routes by method+path prefix
│   ├── config.js          env var parsing + validation at startup
│   ├── db.js              query() wrapper over mysql2 pool; prunes expired tokens on startup
│   ├── http.js            sendJson, sendFile, parseBody, SECURITY_HEADERS; 2 MB body limit
│   ├── auth.js            cookie sessions + Bearer JWT + DB-backed refresh tokens + API tokens
│   ├── links.js           all DB ops against links table; rowToLink maps cols to camelCase
│   ├── utils.js           pure fns: normalizeUrl, sanitizeEntry, parseLinkListQuery, etc.
│   ├── ratelimit.js       in-memory rate limiter for auth endpoints
│   ├── title.js           fetch + parse <title> from URL; SSRF-guarded via assertPublicUrl
│   └── routes/
│       ├── auth.js        POST /api/login, /api/logout, /api/token, /api/refresh, GET /api/me
│       ├── links.js       CRUD + /api/links/:id/opened + bulk ops
│       ├── meta.js        GET /api/stats, /api/tags, /api/fetch-title
│       ├── import.js      POST /api/links/import, GET /api/links/export
│       ├── tokens.js      CRUD for scoped API tokens
│       ├── archive.js     archive-specific queries
│       └── static.js      page auth guard + static file serving
├── public/
│   ├── *.html             browse, archive, editor, login, settings, offline pages
│   ├── js/                one file per page: home, browse, archive, editor, login, settings, shared
│   └── css/styles.css
├── database/
│   ├── 001_initial.sql    users, links, sessions, refresh_tokens
│   ├── 002_retention.sql  last_opened_at, opened_count, remind_at
│   └── 003_api_tokens.sql api_tokens table
├── test/
│   ├── links.test.js
│   ├── auth.test.js
│   ├── utils.test.js
│   ├── utils.ssrf.test.js
│   └── routes/auth.test.js
├── extension/             browser extension (Manifest V3)
└── scripts/
    ├── import_links.py    bulk JSON import
    └── renormalize_urls.js audit URL normalization against live DB (read-only)
```

## Request Lifecycle

```
HTTP request
  → server.js (createServer callback)
  → lib/router.js
      → if PUBLIC_PATH: skip auth → route handler
      → else: lib/auth.js authenticateRequest()
          → try Cookie session (linknest_session)
          → try Bearer JWT
          → try API token (SHA-256 hash lookup)
          → 401 if none match
      → route handler (lib/routes/*)
          → lib/links.js / lib/auth.js (DB ops)
          → lib/http.js sendJson()
  → response with SECURITY_HEADERS
```

## Technical Goals

- p50 response < 50 ms for list/browse queries
- Zero external HTTP calls on the read path (title fetch is user-triggered only)
- Single process, no restarts under normal load
- All secrets env-var only — startup throws if missing

## Non-Functional Requirements

- **Security:** SSRF guard on title fetch; parameterized queries everywhere; HttpOnly cookies; security headers on every response; tokens hashed before storage
- **Availability:** No SLA; single-user tolerance for brief restart on deploy
- **Latency:** Shared hosting NVMe — DB queries < 20 ms typical
- **Scalability:** Single-user; no horizontal scale planned

## Integration Points

| Integration | Auth | Contract |
|-------------|------|----------|
| Browser extension | Scoped API token (Bearer) | `POST /api/links` — same as web API |
| iOS Shortcut | Scoped API token (Bearer) | `POST /api/links` |
| Bulk import script | Direct DB / JSON file | `scripts/import_links.py` |

## Deployment

- **Host:** Hostinger Business shared hosting (LiteSpeed, CloudLinux, NVMe)
- **DB:** MariaDB 11.8 on Hostinger — database `u580993728_linknest`
- **Process:** `node server.js` via Hostinger Node.js app runner
- **No containers, no CI/CD pipeline** — manual rsync deploy

## Observability

- Errors logged to stdout with stack traces
- No external monitoring — Hostinger dashboard for uptime
- Rate limit hits logged in-process

---

## Architecture Decision Records

### 2026-04-14 — No Express, custom router
**Status:** Accepted
**Context:** Project has ~7 route groups; adding Express adds a dep and magic middleware chain.
**Decision:** Hand-rolled 28-line router in `lib/router.js` dispatches by method + path prefix.
**Consequences:** No middleware ecosystem; body parsing, auth, rate limiting all explicit — easier to audit, harder to extend if route count grows significantly.

### 2026-04-14 — tags stored as longtext (not JSON column)
**Status:** Accepted
**Context:** Hostinger MariaDB does not support the `->` JSON operator reliably on `longtext`.
**Decision:** Store tags as a JSON-serialized array in a `longtext` column. Use `JSON_CONTAINS` and `JSON_TABLE` for queries.
**Consequences:** Cannot use `->` shorthand; all tag queries use `JSON_CONTAINS(tags, JSON_QUOTE(?))`. Works correctly on MariaDB 11.8.

### 2026-06-01 — CORS enabled for browser extension
**Status:** Accepted
**Context:** Browser extension makes cross-origin `POST /api/links` requests from `chrome-extension://` origin. Without CORS, browsers block the preflight.
**Decision:** Add `OPTIONS` preflight handler in `lib/http.js`. `CORS_ORIGIN` env var controls `Access-Control-Allow-Origin` (default `*`). All endpoints remain auth-gated so wildcard CORS does not bypass authorization.
**Consequences:** Wildcard origin requires documentation warning; users on shared hosting can restrict to specific origins via `CORS_ORIGIN`.

### 2026-06-01 — Scoped API tokens (separate table, SHA-256 hashed)
**Status:** Accepted
**Context:** Browser extension and iOS need long-lived credentials without exposing session cookies.
**Decision:** `api_tokens` table stores SHA-256(token). Raw token shown once on creation. Scope field (`read`/`write`) enforced per route.
**Consequences:** Tokens are irrecoverable if lost (user must rotate). Simpler than OAuth; appropriate for single-user self-hosted tool.

---

## Security

- **Auth:** bcrypt password hashing (bcryptjs); JWT signed with HMAC-SHA256; tokens hashed (SHA-256) before DB storage
- **Input validation:** `sanitizeEntry` called before every link write; `normalizeUrl` canonicalizes URLs; `validationError()` utility for 400 responses
- **SSRF:** `assertPublicUrl` in `lib/utils.js` DNS-resolves hostname and rejects RFC 1918 / loopback / link-local ranges before any outbound fetch
- **SQL injection:** `mysql2` parameterized queries (`?` placeholders) everywhere
- **XSS:** No server-side HTML rendering; API returns JSON only; frontend escapes via DOM APIs
- **Rate limiting:** `lib/ratelimit.js` on all auth endpoints (login, token, refresh)
- **Secrets:** `JWT_SECRET`, `DB_PASSWORD`, admin credentials — env vars only; startup throws if missing
- **Headers:** `SECURITY_HEADERS` in `lib/http.js` on every response (X-Content-Type-Options, X-Frame-Options, CSP, etc.)
