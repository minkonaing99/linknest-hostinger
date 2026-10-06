# TECH - Architecture + Decisions + Security

Last updated: 2026-10-06 (v3.2)

Detailed request-by-request flows: [DATA_FLOW.md](DATA_FLOW.md).

## Architecture

### Stack + rationale

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js >= 20, built-in `http` | No framework to upgrade; Hostinger Node hosting; built-in `node:test` |
| Database | MySQL / MariaDB 11.8 via `mysql2` | Provided by Hostinger on the same host; transactions for undo/history |
| Auth | `bcryptjs` + HMAC-SHA256 JWT (hand-rolled in `lib/auth.js`) | Pure JS, no native build on shared hosting |
| Config | `dotenv` | `.env` on the server, never committed |
| Frontend | Vanilla HTML/CSS/JS, multi-page | No build step; fast; served by the same process |
| Offline | Service worker (`public/sw.js`, cache `linknest-v35`) + IndexedDB v2 | PWA install, offline shell, capture queue, offline library |
| Extension | Manifest V3 (`extension/`) | Capture from any tab with a write-scoped token |

### Folder structure

```
server.js              entry: connect DB, ensure admin, start undo cleanup, listen
lib/
  config.js            env parsing, limits, protected/public pages
  db.js                mysql2 pool, query(), withTransaction(), ensureAdminUser()
  router.js            http server, CORS, auth gate, route dispatch
  http.js              parseBody, sendJson, security headers, compression
  auth.js              sessions, JWT access + refresh tokens, API tokens
  ratelimit.js         login rate limit per IP
  utils.js             validation, URL normalization, SSRF guard (assertPublicUrl)
  title.js             safe remote title fetch
  links.js             link domain + SQL (largest module)
  link-actions.js      undoable archive/status actions
  link-history.js      review history events
  link-suggestions.js  related-link suggestions (Jaro-Winkler + tags)
  link-export.js       Markdown/selected exports
  offline-library.js   offline snapshot
  reading-position.js  saved reading position
  routes/              one handler per area: auth, links, import, meta, tokens,
                       history, actions, suggestions, reading-position, offline, static
views/                 protected + login HTML pages
public/                css, js (per page + shared), img, sw.js, manifest, offline pages
extension/             browser extension (popup, settings, background, reading-position)
database/              original SQL files 001-003
docs/                  all documentation; full-db.sql, new-changes-db.sql
scripts/               import_links.py, renormalize_urls.js
test/                  node:test suites (49 files)
```

### Request lifecycle

```
Browser / extension / Shortcut
  -> lib/router.js
       CORS preflight (if CORS_ORIGIN, /api only)
       /api/health
       routes/auth (login, token, refresh, logout, me)
       requireAuth for /api/* (cookie session or Bearer access/API token)
       X-LinkNest-User-ID check -> 409 on account mismatch
       read-scope token + write method -> 403
       routes/meta, tokens, import, reading-position, suggestions,
       history, actions, offline, links
       routes/static (protected pages redirect to login when no session)
  -> lib/<domain>.js -> lib/db.js query()/withTransaction() -> MySQL
  -> sendJson (private, no-store for API)
```

### Technical goals + non-functional requirements

| Area | Target |
| --- | --- |
| Latency | API p95 < 300 ms for list/read on a few thousand links |
| Payload limits | JSON body 2 MB default, 128 KB for actions, 128 MB for import |
| List paging | default 50, max 200 |
| Offline snapshot | max 2,000 links, 25 MiB |
| Timeouts | request 30 s, headers 15 s, keep-alive 5 s |
| Availability | single process on Hostinger; no SLA beyond host |
| Security level | private single-user app exposed on the internet |
| Quality | tests 474/474, coverage ~90% lines (v3.2) |

### Constraints

- Shared Hosting: no root access, no background workers beyond the Node process.
- No migrations: schema changes are hand-applied SQL ([new-changes-db.sql](new-changes-db.sql)).
- HTTPS required for service worker, IndexedDB persistence, and secure cookies.
- Undo cleanup runs in-process every 60 s (max 100 receipts older than 24 h).

### Integration points

| Integration | Auth | Contract |
| --- | --- | --- |
| Browser extension | Bearer write-scoped API token, CORS via `CORS_ORIGIN` | `/api/links`, `/api/links/duplicates`, reading-position routes |
| iPhone Shortcut | Bearer API token | `POST /api/links` ([IPHONE_SHORTCUT.md](IPHONE_SHORTCUT.md)) |
| Mobile/external clients | `/api/auth/token` access (15 min) + refresh (30 d, rotated) | All `/api/v1/*` |
| Remote sites (title fetch) | none, outbound | HTTP GET through SSRF guard, redirect-aware |

### Scalability

Vertical only. One Node process and one MySQL pool. Static assets get
compressed with brotli or gzip (`lib/http.js`). The service worker caches the app
shell. API responses are not cached. Fine for one user with tens of thousands of links.

### Deployment

- Target: Hostinger Node.js hosting, MySQL on the same server (`DB_HOST=localhost`).
- Deploy backend, page scripts, public assets, and service-worker version together.
- Apply only the needed SQL in phpMyAdmin first, after a DB backup.
- Branches: `main`, release branches `v2.0`, `v3.0`, `v3.1`, `v3.2`; remote `production`.

### Observability

`console.log` / `console.error` to Hostinger app logs. Startup logs the port and auth modes.
Unhandled request errors log the stack and return a generic `500`. No metrics or alerting.

## Architecture Decision Records

## [2026-06-01] Plain Node `http` + MySQL, no framework
**Status:** Accepted
**Context:** Single-user app on Hostinger shared Node hosting, where MySQL is bundled. Few dependencies means fewer upgrades and fewer security issues.
**Decision:** Use the built-in `http` module with a hand-written router, `mysql2`, `bcryptjs`, and `dotenv` only. Use vanilla JS pages without a build step.
**Consequences:** Small, auditable surface and fast cold start. Routing, body parsing, security headers, and JWT are maintained in-house and need tests. No ORM, so SQL lives in the domain modules.

## [2026-06-01] Manual SQL instead of migrations
**Status:** Accepted
**Context:** Changes go to the Hostinger database through phpMyAdmin, and the owner wants control over each change.
**Decision:** Keep the full schema in `docs/full-db.sql` and incremental changes in `docs/new-changes-db.sql`. Do not run migrations from the app.
**Consequences:** Deploys need a manual step plus release-note instructions. Every change must be additive and safe on live tables.

## [2026-10-05] Server-side undo with revisions
**Status:** Accepted
**Context:** Fast triage needs safe reversal across tabs and retries.
**Decision:** Add a `links.revision` counter plus `link_actions` / `link_action_items` snapshots. Each undo receipt expires after 10 minutes and uses a request ID for idempotency. Undo fails as a whole if any link changed after the action.
**Consequences:** Every link mutation must bump `revision`, and older app versions don't. Before a rollback, expire all pending actions.

## [2026-10-05] Account-bound offline storage
**Status:** Accepted
**Context:** A downloaded library and queued captures on a shared device could leak across accounts.
**Decision:** IndexedDB v2 stores data per verified owner, guarded by owner/generation checks. Logout, online 401, and account changes clear downloads but keep pending captures.
**Consequences:** Extra client complexity. Do not downgrade the IndexedDB opener to v1.

## Security

### Auth + authorization

- Web: random session token in an HttpOnly cookie (`AUTH_COOKIE_NAME`), `Secure` unless `COOKIE_SECURE=false`, TTL `AUTH_SESSION_TTL_DAYS`.
- Clients: HMAC-SHA256 access JWT (`ACCESS_TOKEN_TTL_MINUTES`, default 15) plus a rotated refresh token (`REFRESH_TOKEN_TTL_DAYS`). Refresh tokens can be revoked.
- API tokens: only a SHA-256 hash is stored, the raw value is shown once. Scope is `read` or `write`, with optional expiry and revocation.
- Passwords: bcrypt. `JWT_SECRET` must be at least 32 characters or startup fails.
- Login rate limit: 10 attempts per 15 min per IP, then a 15 min lockout. `X-Forwarded-For` is honored only with `TRUSTED_PROXY=true`.

### Input validation

- All bodies go through `parseBody` with size caps, and `ensurePlainObject` rejects anything that isn't a plain object.
- Field limits: title 300, notes 10,000, save reason 500, tag 50, at most 20 tags.
- URLs: only `http`/`https`, normalized (tracking params, AMP/mobile hosts, slashes, query order).
- Undo action bodies accept an exact key whitelist. History metadata is validated against a fixed type set.
- CSV export guards against formula injection by prefixing `=`, `+`, `-`, `@` with `'`.

### Secrets

Secrets come only from `.env` (see [SETUP.md](SETUP.md#environment-variables)). `.env*` is gitignored except
`.env.example`. Never put DB passwords or tokens in client JS or the extension package.

### Attack surfaces + mitigations

| Surface | Mitigation |
| --- | --- |
| Server-side fetch (title) | `assertPublicUrl` blocks private/reserved IPs and checks each redirect |
| XSS | CSP `default-src 'self'; script-src 'self'`, `escapeHtml` in renderers |
| Clickjacking / sniffing / downgrade | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, HSTS 1 year, strict referrer policy |
| CSRF | `SameSite=Lax` session cookie. Cross-origin calls need Bearer auth with an explicit `CORS_ORIGIN` |
| Brute force | login rate limit + lockout |
| Path traversal | static handler resolves paths and rejects anything outside `public/` |
| Slowloris | 30 s socket timeout, header limits, `clientError` 400 |
| Cross-account offline data | owner-bound IndexedDB, `X-LinkNest-User-ID` 409 check, cleanup marker |
| Token leakage | hashed API tokens, read-only scope, revocation |

### Dependency audit

Run `npm audit` before each release, and use `npm outdated` to check upgrades. Keep the dependency
count at three unless a new one is clearly worth it.
