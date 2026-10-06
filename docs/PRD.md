# PRD - Product Requirements + App Flow

Last updated: 2026-10-06 (v3.2)

Sources: [PRODUCT.md](PRODUCT.md) (product register), [FEATURES.md](FEATURES.md)
(shipped capabilities), [FUTURE_PLAN.md](FUTURE_PLAN.md) (deferred work),
[DATA_FLOW.md](DATA_FLOW.md) (request-level flows).

## Product Requirements

### Problem statement

Saved links pile up in browser bookmarks, notes apps, and chat threads and are
never looked at again. Link Nest is a private personal knowledge inbox: capture
fast, then return later and make a decision about each link.

### Goals + success metrics

| Goal | Metric |
| --- | --- |
| Capture is effortless | A link is saved from a URL alone (title fetched server-side) in under 5 s from any entry point |
| Links get a real revisit | Rising share of eligible links (14+ days old) with a meaningful action (`firstMeaningfulAt`): note change, useful decision, or archive |
| Review ends in a decision | Each review queue item leaves the queue only after archive, useful, note, or snooze |
| Mistakes are cheap | Archive/status changes undoable for 15 s (server expiry 10 min) |
| Works away from the network | Captures queue offline; downloaded library is searchable offline |

Opening or snoozing a link is not a meaningful action. The weekly summary on
Home compares against a 30-day baseline.

### Target users

- **Owner (single user):** captures on phone and desktop, sessions are short,
  reviews a few links at a time. Only persona; the app is private and
  single-user by design.
- **Integrations acting for the owner:** iPhone Shortcut, browser extension,
  scripts - authenticated with scoped API tokens.

### Features

**Core (shipped, MVP)**
- URL-only capture with server title fetch, favicon, YouTube thumbnail
- Status model `unread` / `saved` / `useful` / `archived`, plus pin and soft delete
- Tags, plain-text notes, separate 500-char save reason, reminder date
- Browse: search, filter, sort, tag chips, bulk actions, YouTube tab
- Five-link review queue, useful-revisit queue (30 days), stale filter (90 days)
- Duplicate detection (canonical URL, host, title similarity) with explicit resolution
- Cookie-session login; scoped API tokens; bearer + refresh tokens for clients
- Import/export: JSON (versioned backup), CSV, Markdown, browser bookmarks

**Extended (shipped in v3.2)**
- Toast Undo for archive/status (single and bulk)
- Per-link review history (20 per page)
- Selective Markdown export (selection or current view)
- Extension: current tab, Paste and save, context-menu selection, reading position
- Related-link suggestions + manual relationships
- Account-bound offline library (2,000 links / 25 MiB) and offline capture queue

**Out of scope** (see [FUTURE_PLAN.md](FUTURE_PLAN.md#explicitly-deferred))
- AI summaries / auto-tagging, recommendation scoring
- Collections, folders, saved views beyond the review queue
- Rich-text notes, external notifications
- Native iOS app, collaboration, multi-user, gamification

### User stories

- As the owner, I want to paste only a URL, so that capture never stalls on typing a title.
- As the owner, I want to note why I saved a link, so that I remember its purpose at review time.
- As the owner, I want a short review queue that requires a decision, so that links stop piling up.
- As the owner, I want to undo an accidental archive, so that fast triage is safe.
- As the owner, I want to save the current tab or a copied URL from the extension, so that I never leave the page I am reading.
- As the owner, I want to search my library offline, so that saved knowledge is available on a plane.
- As the owner, I want portable JSON/CSV/Markdown exports, so that my data is never locked in.

### Constraints

- Platform: Node.js >= 20 on Hostinger, MySQL/MariaDB on the same host.
- Three runtime dependencies only (`bcryptjs`, `dotenv`, `mysql2`); no frontend framework or build step.
- DB changes are applied manually in phpMyAdmin from [new-changes-db.sql](new-changes-db.sql); no migration runner.
- Service worker and offline storage require HTTPS (or localhost).
- Single user; no multi-tenant isolation beyond per-user tokens/sessions.

### Open questions / assumptions

- Real-browser smoke (IndexedDB, service worker, cross-tab logout) and live-MySQL concurrency checks for v3.2 are still pending (see [release_notes.md](release_notes.md)).
- `package.json` version (`0.2.0`) does not match the product version (v3.2).
- Assumes one owner account created from `LINKNEST_ADMIN_*` env vars on first start.

## App Flow

### Entry points

| Entry | Path |
| --- | --- |
| Web app | `/` (Home), `/browse.html`, `/editor.html`, `/archive.html`, `/settings.html` |
| Login | `/login.html` |
| Installed PWA + Android/ChromeOS share target | prefilled `/editor.html` |
| Browser extension | popup (current tab / Paste and save), context menu (selection as note) |
| iPhone/iPad Shortcut | `POST /api/links` with API token ([IPHONE_SHORTCUT.md](IPHONE_SHORTCUT.md)) |
| Offline | `/offline.html`, `/offline-library.html` |
| Scripts | `scripts/import_links.py`, `scripts/renormalize_urls.js` |

### Core flows

**1. First run / onboarding**
1. Server starts, connects to MySQL, creates the admin user from env if missing.
2. Owner opens `/` and is redirected to `/login.html`.
3. Login sets an HttpOnly session cookie; local identity is remembered for offline guards.
4. Optional: Settings > create API token for the extension or Shortcut.

**2. Capture**
1. Owner pastes a URL on Home (or uses extension / Shortcut / share target).
2. Client fetches the title (`/api/fetch-title`), then checks duplicates.
3. Exact or possible duplicate: offer Open existing, Merge note, Restore archived, Save separately.
4. Save creates the link (`saved` event in history); five recent links confirm it.
5. Offline: capture is queued in IndexedDB and synced when online, owned by the verified account.

**3. Review**
1. Home shows a five-link queue (due reminders first, then oldest eligible).
2. Each card shows save reason; actions: archive, useful (optional takeaway), note, snooze, open.
3. Keyboard (Left/Right/Up/N/O) and swipe gestures map to the same actions.
4. Completion screen after the last item; Undo toast available after archive/status.

**4. Browse + manage**
1. Browse lists active links with search, status/tag filters, sort, quick filters (due, stale, 90-day).
2. Status dot cycles status inline; bulk select changes status, deletes, or exports Markdown.
3. Editor edits all fields, shows history, related links, and suggestions.
4. Archive page restores or permanently deletes archived links.

**5. Settings**
1. Manage API tokens (create read/write, revoke).
2. Import (preview first) and export.
3. Download / refresh / remove the offline library; optional persistent storage.

### Navigation

Three-item segmented nav (Home, Browse with unread badge, Add Link). Settings and Archive are secondary
links. Command search opens anywhere with `/`, `Cmd+K`, or `Ctrl+K`.

### Auth gating

| Public | Protected (session redirect to login) |
| --- | --- |
| `/login.html`, `/offline.html`, `/offline-library.html`, static assets, `/api/health`, `/api/login`, `/api/auth/token`, `/api/auth/refresh` | `/`, `/browse.html`, `/editor.html`, `/archive.html`, `/settings.html`, all other `/api/*` |

Read-scoped API tokens get `403` on write methods. A mismatched
`X-LinkNest-User-ID` header returns `409` (account changed).

### State transitions

| Screen | Loading | Empty | Error | Success |
| --- | --- | --- | --- | --- |
| Home | skeleton rows | "nothing to review" + capture prompt | inline toast | queue / completion screen |
| Browse | skeleton rows | filter-aware empty state | toast, retry | list with counts |
| Editor | field placeholders | new-link form | field validation messages | toast, history refresh |
| Offline library | reading IndexedDB | "download in Settings" prompt | storage/quota message | read-only list |

### Edge cases

- **Offline:** navigation served from SW shell; API calls are network-only; captures queue.
- **Expired session:** online `401` clears offline data and protected caches, then redirects to login; pending captures survive.
- **Account change:** different verified user clears downloads; other-account drafts hidden behind Claim after sign in.
- **Undo conflict:** any later mutation on a link blocks the whole undo; nothing partial is restored.
- **Quota / eviction:** failed download keeps the previous snapshot; storage failure never blocks login/logout.
- **Duplicates on import:** skipped with summary; valid rows import in batches.
