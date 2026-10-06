# PLAN - Implementation Plan + Tasks

Last updated: 2026-10-06

Keep updated. Claude reads this before starting work.

History: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (v2 phases, done),
[V3.2_IMPLEMENTATION_PLAN.md](V3.2_IMPLEMENTATION_PLAN.md) (v3.2 acceptance
criteria and rollout), [ROADMAP.md](ROADMAP.md) (historical priorities).
Deferred ideas: [FUTURE_PLAN.md](FUTURE_PLAN.md).

**Current status:** Phase 3, v3.2 release verification. All eight v3.2 features
are in source on branch `v3.2`. Deployment checks are pending.

## Implementation Plan

### Phase 1 - Foundation (done)

**Goal:** a private, secure link library on Hostinger.
1. MySQL schema, admin bootstrap, cookie sessions, JWT + refresh tokens
2. Link CRUD, soft delete, restore, normalization, SSRF-safe title fetch
3. Browse / Home / Editor / Archive pages, PWA shell
4. Backend tests, duplicate detection, scoped API tokens, browser extension

**Deliverables:** v1.x-v2.0 shipped. **Effort:** done.
**Done when:** auth, CRUD, and import/export are covered by tests, and the app is deployed on Hostinger.

### Phase 2 - Revisit loop (done)

**Goal:** turn saving into meaningful revisits.
1. Notes, review queue, snooze, meaningful-revisit metrics, weekly summary
2. Useful revisit (30 d), 90-day stale filter, command search, YouTube workflow
3. Offline capture queue, share target, Markdown/CSV export, import preview

**Deliverables:** v3.0-v3.1. **Done when:** the review queue requires a decision and the metrics record `firstMeaningfulAt`.

### Phase 3 - v3.2 polish + launch (in progress)

**Goal:** eight focused improvements, verified in a real deployment.
1. Save reasons (done)
2. Selective Markdown export (done)
3. Extension clipboard capture (done)
4. Reading position (done)
5. Related-link suggestions (done)
6. Review history (done)
7. Toast Undo (done)
8. Offline library access (done)
9. Apply pending SQL on production (backup first)
10. Real-browser and live-MySQL smoke checks
11. Merge `v3.2` into `main` and deploy with service worker v35

**Deliverables:** v3.2 in production. **Effort:** TBD for steps 9-11.
**Done when:** the smoke checklist passes on HTTPS production, tests are green, and coverage is at least 80%.

### Milestones

| Milestone | Description | Target Date | Status |
|-----------|-------------|-------------|--------|
| v2.0 | Tests, duplicates, API tokens, extension | 2026-06-01 | Done |
| v3.0 / v3.1 | Revisit loop, offline capture, exports | 2026 | Done |
| v3.2 source complete | 8 features, 474 tests, ~90% coverage | 2026-10-05 | Done |
| v3.2 production | SQL applied, smoke checks, deploy | TBD | In progress |

### Dependencies

- Undo (7) depends on the `revision` column + `link_actions` tables, which depend on SQL being applied (9).
- Review history (6) depends on the `link_events` table, which also needs (9).
- Save reasons (1) and reading position (4) depend on the new `links` columns, which also need (9).
- Offline library (8) depends on service worker v35 + IndexedDB v2, which ship in the same deploy (11).
- Smoke checks (10) need a deployed HTTPS environment.

### Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Partial SQL apply on production | Medium | High | Back up first; apply only missing statements from [new-changes-db.sql](new-changes-db.sql) |
| Service worker / IndexedDB behaves differently in real browsers than in mocks | Medium | Medium | Manual smoke on Safari iOS + Chrome before announcing |
| Rollback to older app ignores `revision` | Low | High | Expire all undo actions before rollback; keep additive schema |
| Offline notes remain after remote session expiry | Low | Medium | Opt-in warning; cleared on next online 401 |
| `package.json` version drift (0.2.0 vs v3.2) | High | Low | Align on next release |

## Current Tasks

### In Progress

- [ ] Apply v3.2 SQL (`save_reason`, `reading_position`, `link_events`, `revision`, `link_actions`, `link_action_items`) on production after backup - owner, TBD
- [ ] Real-browser smoke: offline library, cross-tab logout, offline restart, Undo toast, extension clipboard/reading position - owner, TBD

### Backlog

- [ ] Live-MySQL concurrency/rollback check for Undo and offline snapshot consistency - owner, TBD
- [ ] Merge `v3.2` into `main`; deploy backend + assets + sw v35 together - owner, TBD
- [ ] Align `package.json` version with product version - owner, TBD
- [ ] Clean up `docs/change-db.sql` (one-line stub) or merge it into `new-changes-db.sql` - owner, TBD
- [ ] Install `tree_sitter_sql` for graphify so SQL files appear in the code graph (optional) - owner, TBD

### Done

- [x] All eight v3.2 features implemented, 474/474 tests passing - 2026-10-05
- [x] Project docs scaffolded (PRD, TECH, SCHEMA, DESIGN, PLAN, SETUP); API.md and README refreshed - 2026-10-06
