# PLAN — Link Nest

## Implementation Plan

### Phase 1 — Foundation (Complete)

**Goal:** Working single-user link manager with full CRUD, auth, and hosted deployment.

**Tasks:**
1. MySQL schema: users, links, sessions, refresh_tokens
2. Node HTTP server with custom router
3. Cookie session auth + bcrypt login
4. Bearer JWT + refresh token flow
5. Link CRUD API (create, read, update, soft-delete)
6. URL normalization (tracking params, trailing slash, query sort)
7. SSRF guard on title fetch
8. Static file serving with auth guard
9. Browse page: search, filter, sort
10. Editor page: create/edit link
11. Archive page: soft-deleted links
12. Rate limiting on auth endpoints
13. Import / export JSON
14. Deploy to Hostinger

**Deliverables:** Fully functional self-hosted link manager
**Status:** Done

---

### Phase 2 — Hardening + Extensions (Complete)

**Goal:** API tokens, browser extension, test coverage, retention metrics.

**Tasks:**
1. `last_opened_at`, `opened_count`, `remind_at` columns (migration 002)
2. Scoped API tokens table (migration 003) + CRUD routes
3. Browser extension (Manifest V3, one-click save)
4. Backend test suite: auth, links, utils, SSRF (153 tests, 0 failures)
5. Route-level auth tests

**Deliverables:** Extension shipped; full backend test coverage
**Status:** Done

---

### Phase 3 — Feature Expansion (Backlog)

**Goal:** Notes, saved views, richer metadata, better dedup.

**Tasks:**
1. Notes field on links (DB column, editor textarea, browse preview, search, export) — 3-4 days
2. Saved views — store filter presets, UI for save/load — 2-3 days
3. Richer metadata: description, favicon, thumbnail, content type — 3-4 days
4. Protocol normalization (http → https dedup) — 1 day (run `scripts/renormalize_urls.js` audit first; high risk on existing stored URLs)
5. Fuzzy duplicate detection by host + title similarity (Jaro-Winkler, cap 200 rows/host) — 2-3 days
6. Duplicate merge/review UI — 2 days

**Deliverables:** Notes + saved views shipped; metadata + dedup experimental
**Estimated effort:** ~14-17 days total
**Status:** Backlog

---

### Phase 4 — Polish + Growth (Future)

**Goal:** iOS integration, remind-at notifications, public link pages.

**Tasks:**
1. iOS Shortcut / Share Sheet integration
2. Remind-at notification delivery (email or push — mechanism TBD)
3. Multi-account / team sharing (requires user registration UI)
4. Full-text search (title + notes)
5. Public read-only link pages

**Deliverables:** TBD
**Status:** Future

---

## Milestone Table

| Milestone | Description | Target Date | Status |
|-----------|-------------|-------------|--------|
| v0.1.0 | Core CRUD + auth + browse | 2026-04-14 | Done |
| v0.2.0 | API tokens + extension + tests | 2026-06-01 | Done |
| v0.3.0 | Notes + saved views | TBD | Backlog |
| v0.4.0 | Richer metadata + dedup | TBD | Future |
| v1.0.0 | Stable public release | TBD | Future |

## Risks + Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Hostinger MariaDB quirks (JSON ops) | High | Medium | All JSON queries tested against MariaDB 11.8; use `JSON_CONTAINS` not `->` |
| Single process crash loses in-flight requests | Medium | Low | Stateless design; client retries; Hostinger auto-restart |
| URL dedup misses variants | Medium | Low | `normalizeUrl` handles common cases; fuzzy dedup in Phase 3 |
| Browser extension review delays | Low | Medium | Extension submitted early; parallel web UI development |
| Node.js version mismatch on Hostinger | Low | High | Pin version in Hostinger app settings; test locally on same version |

## Done Criteria

- **Phase complete** when all tasks checked and tests passing
- **Feature complete** when: creates, reads, updates, soft-deletes work; search and filter correct; auth flows working; 80%+ test coverage maintained
- **Ship-ready** when: no CRITICAL/HIGH from security-reviewer; all 153+ tests passing; manual smoke test on prod URL

---

## In Progress

- (none — both Phase 1 and Phase 2 complete)

## Backlog

- [ ] Notes field on links (Phase 3, task 1)
- [ ] Saved views / persistent filter presets (Phase 3, task 2)
- [ ] Richer metadata: description, favicon, thumbnail (Phase 3, task 3)
- [ ] Protocol normalization http → https (Phase 3, task 4)
- [ ] Fuzzy duplicate detection (Phase 3, task 5)
- [ ] Duplicate merge UI (Phase 3, task 6)
- [ ] iOS Shortcut integration (Phase 4, task 1)
- [ ] Remind-at notification delivery (Phase 4, task 2)

## Done

- [x] Initial schema + CRUD + auth
- [x] URL normalization + SSRF guard
- [x] Browse, archive, editor pages
- [x] Import/export
- [x] Rate limiting
- [x] Retention columns (last_opened_at, opened_count, remind_at)
- [x] Scoped API tokens
- [x] Browser extension
- [x] Backend test suite (153 tests)
- [x] Remove stats cards from home page
- [x] Fix archive page 0 results bug
- [x] Replace alert/confirm with toast
- [x] Fix URL-as-title detection
- [x] Auto-fetch title on blank/URL title

> Keep updated. Claude reads this before starting work.
