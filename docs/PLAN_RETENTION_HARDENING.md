# Link Nest — Retention + Hardening Plan

Last updated: 2026-06-01

## Goals

Two parallel workstreams, implemented in sequence:

1. **Revisit/retention** — `lastOpenedAt`, `remindAt`, stale-link surfacing. Turns Link Nest from a link graveyard into a workflow tool.
2. **Backend hardening** — split `router.js`, add tests, strengthen URL normalization, fix doc/reality drift.

## Decisions locked in

- MySQL is the real database. `supabase/` folder deleted. README and ROADMAP updated to reflect MySQL.
- Tests use `node:test` (zero new deps, ships with Node 18+).
- `normalizeUrl` does NOT strip leading `www.` — avoids false-positive dedupes.
- Revisit UI v1 = two hardcoded filter buttons on Browse + `remindAt` date input in editor. No dedicated page. No notifications.

## Reality check (found during planning)

- README claimed Supabase/Postgres but code uses MySQL (`mysql2`, `?` placeholders, `JSON_TABLE`, `INSERT IGNORE`). `supabase/migrations/` was empty.
- `GET /api/links/:id` already exists at `lib/router.js:274-281` via `readLink`. Roadmap item was partially complete. Editor may still bulk-load — verify and fix if so.

---

## Phase A — Foundation

Goal: tests are green, URL normalization is tightened, dead code is removed, editor uses single-fetch.

### A1 — Wire test runner

- Add `"test": "node --test"` to `package.json` scripts.
- Create `test/` directory with initial smoke test file.
- No new dependencies.

### A2 — Write unit tests (lib/utils.js)

Target coverage for:

- `normalizeUrl` — strips tracking params, clears hash, URL round-trips
- `normalizeStatus` — known and unknown values
- `normalizeTags` — deduplication, trimming, limits
- `sanitizeEntry` — valid input, missing URL, bad URL, date validation, tag limits
- `parseLinkListQuery` — query params to WHERE clause, sort, pagination
- `parseBooleanFlag`, `parsePositiveInt`

### A3 — Write integration tests (lib/links.js)

Use a dedicated test database (env var `TEST_DB_URL`). Cover:

- `createLink` — success, duplicate URL, normalized URL stored
- `readLink` — found, not found
- `readLinks` — filters, pagination
- `updateLink` — field changes, URL collision check
- `deleteLink` — soft delete, hard delete
- `restoreLink`
- `bulkUpdateStatus`
- `readTagCounts`

### A4 — Verify GET /api/links/:id

- Confirm `GET /api/links/:id` works end-to-end.
- Check if `public/js/editor.js` loads the full link list to find one item. If yes, switch it to `GET /api/links/:id`.
- Write a route-level test for the endpoint.
- Close this item in ROADMAP.md.

### A5 — Strengthen normalizeUrl

Extend `lib/utils.js → normalizeUrl`:

- Lowercase hostname (`url.hostname = url.hostname.toLowerCase()`)
- Strip trailing `/` from path when path is not root (e.g. `/foo/` → `/foo`)
- Sort `searchParams` alphabetically after stripping noisy params
- Add to the noisy-params blocklist: `mc_cid`, `_ga`, `yclid`, `dclid`, `msclkid`, `twclid`, `ttclid`, `ref_url`, `sccid`

Do NOT strip leading `www.`.

Update tests to cover each new rule.

### A6 — Re-normalize existing rows

Create `scripts/renormalize_urls.js`:

- Reads all rows from `links`.
- Runs each `url` through the updated `normalizeUrl`.
- Detects rows where the normalized form conflicts with another existing row (duplicate candidates).
- Prints a report: changed rows, duplicate candidates. Does NOT auto-update or auto-merge.
- Operator runs manually and reviews output before deciding to apply.

### A7 — Delete supabase/ and fix docs

- Delete `supabase/` directory.
- Update `README.md`: remove Supabase/Postgres references, replace with MySQL.
- Update `docs/ROADMAP.md`: mark `GET /api/links/:id` as done, note MySQL as the real DB.

---

## Phase B — Router split

Goal: `lib/router.js` (one 345-line mega-handler) becomes a thin dispatcher. Each route group lives in its own file. Tests stay green throughout.

### B1 — Extract auth routes → lib/routes/auth.js

Routes moved:

- `POST /api/login` and `/api/v1/login`
- `POST /api/auth/token` and `/api/v1/auth/token`
- `POST /api/auth/refresh` and `/api/v1/auth/refresh`
- `POST /api/auth/logout` and `/api/v1/auth/logout`
- `POST /api/logout` and `/api/v1/logout`
- `GET /api/me` and `/api/v1/me`

Each module exports a `handle(req, res, ctx)` function or an array of route descriptors — decide on the interface before starting B1 and keep it consistent across all modules.

Run tests after this commit.

### B2 — Extract link routes → lib/routes/links.js

Routes moved:

- `GET /api/links` (list)
- `GET /api/links/:id`
- `POST /api/links` (create)
- `PUT /api/links/:id`
- `DELETE /api/links/:id`
- `POST /api/links/restore/:id`
- `PATCH /api/links/bulk`

Run tests after this commit.

### B3 — Extract meta routes → lib/routes/meta.js

Routes moved:

- `GET /api/stats`
- `GET /api/tags`
- `GET /api/fetch-title`

Run tests after this commit.

### B4 — Extract import/export routes → lib/routes/import.js

Routes moved:

- `POST /api/links/import`
- `POST /api/links/import-bookmarks`
- `GET /api/links/export`

Run tests after this commit.

### B5 — Extract static/page serving → lib/routes/static.js

Logic moved:

- `/logout` page redirect
- Protected page auth guard
- Login redirect for authenticated users
- `sw.js` serving with no-store headers
- Fallback static file serving with path traversal guard

Run tests after this commit.

### B6 — Simplify lib/router.js

After all extractions, `lib/router.js` should only:

- Import all route modules
- Dispatch to the correct module in order
- Export `{ server }`

Target: under 50 lines.

---

## Phase C — Revisit/retention

Goal: track when links are opened, let users set reminders, and surface stale/due links in Browse.

### C1 — Database migration

File: `mysql/002_retention.sql`

```sql
ALTER TABLE links
  ADD COLUMN last_opened_at DATETIME(3) NULL        AFTER deleted_at,
  ADD COLUMN opened_count   INT         NOT NULL DEFAULT 0 AFTER last_opened_at,
  ADD COLUMN remind_at      DATETIME(3) NULL        AFTER opened_count;

CREATE INDEX idx_links_remind_at      ON links (remind_at);
CREATE INDEX idx_links_last_opened_at ON links (last_opened_at);
```

### C2 — Round-trip new fields

Update `lib/links.js`:

- `rowToLink` — map `last_opened_at`, `opened_count`, `remind_at`
- `createLink` — include new columns in INSERT (all default values)
- `updateLink` — include new columns in UPDATE; accept `remindAt` from body
- `normalizeStoredEntry` in `lib/utils.js` — include `lastOpenedAt`, `openedCount`, `remindAt`
- `sanitizeEntry` in `lib/utils.js` — parse and validate `remindAt` as nullable ISO datetime

Export/import must round-trip these fields too.

### C3 — POST /api/links/:id/opened

New endpoint in `lib/routes/links.js`:

```
POST /api/links/:id/opened
```

- Requires auth.
- Sets `last_opened_at = NOW()`.
- Increments `opened_count` by 1.
- Returns `{ ok: true, entry }`.
- Does not change any other fields.

Add to `docs/API.md`.

### C4 — Query filter support

Extend `parseLinkListQuery` in `lib/utils.js` to accept:

- `remindBefore` — ISO datetime string. Filters to rows where `remind_at <= remindBefore` and `remind_at IS NOT NULL`.
- `staleBefore` — ISO datetime string. Filters to rows where `last_opened_at < staleBefore` OR (`last_opened_at IS NULL` AND `created_at < staleBefore`).
- `neverOpened` — boolean. Filters to rows where `opened_count = 0`.

Write tests for each new branch.

### C5 — Frontend: track opens

In `public/js/browse.js`:

- Each link row gets a click handler on the title anchor that fires `POST /api/links/:id/opened` (fire-and-forget, no error UI needed).
- Does not block navigation — the link opens normally.

### C6 — Frontend: reminder date in editor

In `public/js/editor.js` and `public/editor.html`:

- Add a "Remind me" date input field (`<input type="date">`) bound to `remindAt`.
- Show current value when editing.
- Submit with the rest of the form via `PUT /api/links/:id`.
- Optional: show a small indicator in Browse rows that have a future `remindAt`.

### C7 — Frontend: filter buttons on Browse

In `public/js/browse.js` and `public/browse.html`:

Add two hardcoded filter buttons in the filter bar:

- **Due to revisit** — calls `GET /api/links?remindBefore=<now-iso>`. Shows links whose reminder is due.
- **Stale unread (30d)** — calls `GET /api/links?status=unread&staleBefore=<30-days-ago-iso>`. Shows unread links not opened in 30 days.

These are not saved views — they are hardcoded shortcuts. Clearing the filter returns to the normal browse view.

### C8 — Tests

Add test coverage for:

- `parseLinkListQuery` with `remindBefore`, `staleBefore`, `neverOpened`
- `sanitizeEntry` with `remindAt` (valid, null, invalid format)
- `POST /api/links/:id/opened` — increments count, sets timestamp
- `normalizeStoredEntry` with new fields

### C9 — Update docs

- `docs/API.md`: document `POST /api/links/:id/opened`, new query params, new link fields.
- `docs/ROADMAP.md`: move retention items to "done" section.
- This file: mark phases complete as each ships.

---

## What is explicitly out of scope

- Saved views (separate P0 item in ROADMAP).
- Notes field (P0 item, separate effort).
- Reminder notifications (email/push — requires a scheduler, out of scope for v1).
- Frontend framework — stays vanilla JS.
- Build step — `server.js` must remain directly runnable with `node`.
- Multi-user, sharing, AI features.

---

## Status

| Phase | Status |
|-------|--------|
| A — Foundation | Done (2026-06-01) |
| B — Router split | Done (2026-06-01) |
| C — Revisit/retention | Done (2026-06-01) |

## Phase C completion notes

- `mysql/002_retention.sql` — adds `last_opened_at`, `opened_count`, `remind_at` to `links` table, with indexes.
- `lib/links.js` — `rowToLink` maps 3 new fields; `createLink` and `updateLink` include `remind_at` in SQL; `openLink` sets `last_opened_at` and increments `opened_count`.
- `lib/routes/links.js` — `openedId()` parser + `handleOpened` handler + `POST /:id/opened` route added.
- `lib/utils.js` — `sanitizeEntry` validates `remindAt`; `normalizeStoredEntry` exposes all 3 fields; `parseLinkListQuery` supports `remindBefore`, `staleBefore`, `neverOpened` with correct SQL conditions.
- `public/editor.html` + `public/js/editor.js` — "Remind me" date input added; round-trips with save/load.
- `public/browse.html` + `public/js/browse.js` — "Due to revisit" and "Stale unread (30d)" toggle buttons added; title click fires fire-and-forget open tracking.
- Tests: 99/99 GREEN — 11 new tests cover all new paths.

## Phase B completion notes

- `lib/router.js` reduced to 28 lines — pure dispatcher.
- Five route modules extracted: `lib/routes/{auth,meta,import,links,static}.js` (155/74/71/139/61 lines).
- Dispatcher order: auth → [blanket API auth check] → meta → import → links → static. Import comes before links to prevent `GET /api/links/export` being swallowed by the `:id` wildcard.
- `lib/routes/auth.js` exports `PUBLIC_PATHS` set so the dispatcher can skip the blanket auth check for public routes (login, token, refresh, logout, me).
- All 88 tests still pass — no lib/utils.js or lib/links.js changes.

## Phase A completion notes

- `npm test` wired via `node --test` (zero new deps).
- 88 tests pass: 20 suites covering `lib/utils.js` (normalizeUrl, sanitizeEntry, parseLinkListQuery, etc.) and `lib/links.js` (all CRUD operations via mocked DB, parseBookmarksHtml).
- `normalizeUrl` strengthened: strips `mc_cid`, `_ga`, `msclkid`, `dclid`, `yclid`, `twclid`, `ttclid`, `sccid`, `ref_url`; strips trailing slash from non-root paths; sorts remaining params for canonical form.
- `GET /api/links/:id` confirmed done — editor already uses it (`public/js/editor.js:62`).
- `scripts/renormalize_urls.js` created — run against live DB to audit URL changes and report duplicate candidates before applying.
- `supabase/` folder deleted. README and ROADMAP corrected to MySQL.
- ROADMAP item "Add a dedicated single-link API" marked done.
