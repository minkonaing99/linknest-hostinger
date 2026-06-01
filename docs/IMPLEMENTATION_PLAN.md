# Implementation Plan: Duplicate Detection, Auth Tests, Scoped Tokens, Browser Extension

Created: 2026-06-01

## Branch

`feat/dup-detect-auth-tests-api-tokens-extension`

---

## Phase 1 — Backend Tests

No new deps. Same `require.cache` mock pattern as `test/links.test.js`.

### 1.1 `test/auth.test.js`

| Function | Cases |
|---|---|
| `authenticateUser` | correct password, wrong password, unknown user |
| `createSession` / `getCookieSessionUser` | valid session, expired session, missing cookie |
| `destroySession` | clears cookie, deletes DB row |
| `getBearerUser` | valid JWT, expired JWT, tampered signature |
| `issueTokenPair` | returns access + refresh tokens |
| `revokeRefreshToken` | marks revoked_at, returns false on unknown token |
| `findValidRefreshToken` | valid, revoked, expired |

### 1.2 `test/routes/auth.test.js`

Spin up `http.createServer` with auth route handler; fire real HTTP requests. Cover login, logout, token, refresh, `/api/me`.

### 1.3 `test/utils.ssrf.test.js`

Mock `dns.promises.lookup` via `require.cache`. Cover `assertPublicUrl`: private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, ::1), reserved ranges, valid public IP.

---

## Phase 2 — Better Duplicate Detection

### 2.1 Extend `normalizeUrl` in `lib/utils.js`

- `http://` → `https://` (protocol canonicalization)
- Strip `m.`, `mobile.`, `amp.` subdomains

### 2.2 `findDuplicateCandidates(url, title)` in `lib/links.js`

- Query non-deleted links by `host`
- Filter by Jaro-Winkler title similarity (implemented in `lib/utils.js`, ~30 lines, no package)
- Return candidates with `{ id, url, title, similarity }` sorted desc, threshold > 0.75
- Cap to 200 rows per host

### 2.3 New API endpoint

```
GET /api/links/duplicates?url=<url>&title=<title>
```

### 2.4 Duplicate handling in create flow

- `POST /api/links` response includes `duplicateCandidates` when candidates exist (not a 409)
- Editor page: inline warning panel if `duplicateCandidates` non-empty
- Browse page: `GET /api/links/scan-duplicates` returns all candidate pairs; "Scan duplicates" button

**Risk**: Jaro-Winkler on large library can be slow. Cap + async.

---

## Phase 3 — Scoped API Tokens

### 3.1 `mysql/003_api_tokens.sql`

```sql
CREATE TABLE api_tokens (
  id           VARCHAR(36)  NOT NULL PRIMARY KEY,
  user_id      VARCHAR(36)  NOT NULL,
  name         VARCHAR(100) NOT NULL,
  token_hash   VARCHAR(64)  NOT NULL UNIQUE,
  scope        VARCHAR(10)  NOT NULL DEFAULT 'write',
  created_at   DATETIME(3)  NOT NULL,
  last_used_at DATETIME(3)  NULL,
  expires_at   DATETIME(3)  NULL,
  revoked_at   DATETIME(3)  NULL,
  INDEX idx_api_tokens_user (user_id)
);
```

Raw token shown once on creation, only SHA-256 hash stored.

### 3.2 Auth layer (`lib/auth.js`)

- Add `getApiTokenUser(req)` — checks Bearer token against `api_tokens` table, updates `last_used_at`
- Add `getApiTokenScope(req)` — returns `'read'` | `'write'` | `null`
- Update `getAuthenticatedUser` to try API token first

### 3.3 Scope enforcement (`lib/router.js`)

Write endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) reject `read`-scoped tokens with 403.

### 3.4 `lib/routes/tokens.js`

```
POST   /api/tokens        create; returns raw token once
GET    /api/tokens        list (metadata only, no raw token)
DELETE /api/tokens/:id    revoke
```

### 3.5 Settings UI

`public/settings.html` + `public/js/settings.js`:
- List tokens (name, scope, created, last used)
- Create form (name + scope)
- Revoke button
- One-time modal showing raw token on creation

---

## Phase 4 — Browser Extension

Directory: `extension/`. Plain JS, Manifest V3, no build step.

### Files

```
extension/
  manifest.json        MV3, permissions: activeTab, storage
  popup.html
  popup.js             reads tab URL+title, POSTs to Link Nest
  settings.html
  settings.js          stores server URL + API token in chrome.storage.local
  icons/               reuse existing logo (16, 48, 128px)
```

### Flow

1. Settings: enter Link Nest URL + paste write-scoped API token
2. Popup: pre-fills URL + title from active tab; user edits title/tags; click Save
3. `POST <serverUrl>/api/links` with `Authorization: Bearer <token>`
4. Success shows title + browse link; errors shown inline

### CORS change (`lib/http.js`)

Add `OPTIONS` pre-flight handler + `Access-Control-Allow-Origin` for `/api/links POST`.
Add `CORS_ORIGIN` env var (default `*`, document trade-off).

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `http→https` normalization breaks existing stored URLs | HIGH | Run `scripts/renormalize_urls.js` audit first; change is opt-in |
| Jaro-Winkler perf on large library | MEDIUM | Cap 200 rows/host |
| CORS wildcard on API | LOW | Auth-gated; document it |
| Extension MV3 service worker limits | LOW | No persistent state needed |

---

## File Change Map

| File | Change |
|---|---|
| `lib/utils.js` | `normalizeUrl` extensions + Jaro-Winkler |
| `lib/links.js` | `findDuplicateCandidates`, updated `createLink`, scan handler |
| `lib/auth.js` | `getApiTokenUser`, `getApiTokenScope`, updated `getAuthenticatedUser` |
| `lib/router.js` | scope enforcement, tokens route |
| `lib/routes/links.js` | duplicate endpoints |
| `lib/routes/tokens.js` | new file |
| `lib/http.js` | CORS OPTIONS |
| `mysql/003_api_tokens.sql` | new migration |
| `public/settings.html` + `public/js/settings.js` | new files |
| `public/editor.html` + `public/js/editor.js` | duplicate warning |
| `public/browse.html` + `public/js/browse.js` | scan button |
| `test/auth.test.js` | new file |
| `test/routes/auth.test.js` | new file |
| `test/utils.ssrf.test.js` | new file |
| `extension/*` | new directory |
| `docs/FEATURES.md` | move done items |
| `docs/API.md` | document new endpoints |

## Status

| Phase | Status |
|---|---|
| 1 — Backend Tests | Done (2026-06-01) — 153/153 pass |
| 2 — Duplicate Detection | Done (2026-06-01) — 169/169 pass |
| 3 — Scoped API Tokens | Done (2026-06-01) — 169/169 pass |
| 4 — Browser Extension | Done (2026-06-01) |
