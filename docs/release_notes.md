# Release notes

## v3.2 - Offline library access - 2026-10-05

- Settings offers explicit Download library, Refresh download, Remove download, and optional browser persistent storage. Show last successful download, link count, and partial scope. The public offline library view searches downloaded title, URL, tags, notes, and save reason, with a status filter.
- Read-only downloads exclude article bodies and archived/deleted links. A consistent snapshot endpoint under both API prefixes returns up to 2,000 recently updated links and 25 MiB of UTF-8 JSON, including its envelope. Refresh replaces the entire snapshot; failed fetches or quota/transaction failures keep the old download.
- IndexedDB v2 preserves capture drafts and adds separate library and metadata stores. Owner/generation guards reject late downloads and stale writes. Blocked upgrades explain how to retry; version changes close connections.
- Logout, online 401, and verified account changes clear downloads, visible notes, and protected navigation caches across tabs. A pending-cleanup marker prevents failed storage cleanup from exposing old downloads when storage becomes accessible again. Storage failure does not prevent online login/logout or successful navigation.
- Captures belong to their verified account. Legacy/unowned and other-account drafts stay hidden behind generic Claim after sign in controls; only matching-owner drafts sync automatically. Expected-user headers reject cookie/account races before server reads/writes. Clearing the library preserves captures.
- API requests remain network-only. Protected offline capture shells require matching local identity; the public offline library shell is available after offline restart. Download opt-in explains that remote session expiry cannot revoke local notes while disconnected.

Deployment: deploy backend, all page script lists, new public assets, and service
worker v35 together over HTTPS (or localhost for development). No dependency,
SQL, or migration was added or executed for this feature. Earlier features still
require their applicable manual SQL when absent. Keep the shared IndexedDB v2
opener during rollback; do not downgrade the opener to v1 or remove unsynced
captures. Disable the library interface if rolling back without compatible
storage/authentication cleanup.

Validation: all 474 tests pass. Overall coverage is 90.50% lines, 86.85% branches,
and 91.38% functions. Snapshot domain coverage is 100% on all three measures;
snapshot routes have 100% lines/functions and 87.50% branches. Offline UI,
shared storage, capture queue, and service worker exceed 80% on all three
measures. Quota/commit rollback, blocked upgrades, eviction, owner/generation
races, safe rendering, and storage failures during authentication/navigation
are covered by runnable behavior tests. Code and security review findings were
fixed. Real-browser smoke could not run:
no browser integration was available and Computer Use denied Safari access.
Native IndexedDB/service-worker behavior, mobile layout, cross-tab logout,
offline restart, and live MySQL snapshot consistency remain deployment checks;
automated verification uses DOM, transaction/state, and worker mocks. No
production data was accessed during the attempted disposable browser fixture.

## v3.2 - Toast Undo for archive/status - 2026-10-05

- Archive/status controls in the library, review, command search, YouTube actions, and bulk selection offer Undo in a 15-second toast. Hover/focus pauses dismissal, bounded by the server's 10-minute undo expiry. Editor status handles survive navigation through per-tab metadata.
- Undo restores exact status/archive-owned values, pin state and relevant review milestones, plus a compound useful takeaway. Other editor details remain saved. Later link mutations block undo; a conflicting or missing bulk member restores nothing.
- Actions, snapshots, mutations and history share one transaction. Request IDs make matching action retries return the original result; changed payloads conflict. Repeated undo does not repeat changes or events. Lost action replies retry once with the same payload.
- Useful prompts no longer merge notes before the status write. Undo updates timestamps/revisions and appends Action undone without qualifying as a new review decision. Successful undo reloads canonical page data.
- Internal revisions include notes, pins, open tracking, reading position, restore and relationship changes. They and temporary action storage stay out of JSON backups; durable Action undone events remain portable.
- Bounded cleanup removes at most 100 receipts older than 24 hours at startup, each minute, and during action requests. Their snapshots cascade; durable history remains. Toast metadata clears on login/logout/authentication failure.

Deployment: back up the database, then manually apply only the new `revision`
ALTER and `link_actions`/`link_action_items` CREATE queries in
[db-changes.sql](db-changes.sql). Do not reapply earlier ALTERs when columns exist.
Deploy backend and web assets/service-worker v34 together. No SQL or migration
was executed during implementation; no dependency was added. Older application
versions do not increment revisions: expire/remove all temporary actions before
rollback or re-enabling Undo, retain additive schema and durable history.

This slice implements toast Undo, without a recent-action panel or redo stack.
Standalone note edits, ordinary restore and permanent deletion are outside its
scope. Real-browser and disposable-MySQL concurrency/rollback smoke checks remain
pending; automated domain integration and DOM checks use transaction/state mocks.

Validation: all 429 tests pass. Overall coverage is 89.16% lines, 86.66% branches,
and 91.36% functions. The action module has 100% lines/functions and 91.55%
branches; action routes have 100% lines/functions and 96.55% branches. Toast UI
coverage is 99.15% lines, 84.85% branches, and 100% functions. Code and security
review found no remaining defects.

## v3.2 - Review history - 2026-10-05

- Expand History in the editor to load 20 newest events at a time, with Bangkok timestamps, Load more, and retry. New captures hide the section until saved.
- Record saves, imports, notes/reasons, status/useful decisions, reminders, archives/restores, useful-review completions, and detail edits. Compound edits produce one summary; note and reason text versions are never retained.
- Same-connection transactions lock affected rows and commit mutations with their events. Existing review milestones remain unchanged. No-op edits, repeated archive/restore, opening, and reading-position saves produce no event.
- Authenticated read tokens can read history under both API prefixes, including archived links. History starts when enabled; existing links receive no fabricated past events. Permanent deletion cascades events.
- Complete JSON version 3 backups include all history per link from a repeatable-read snapshot. Validated imports restore IDs and times atomically for new links, attribute events to the current importer, and append Imported. Duplicate links skip their histories; conflicts roll back and count invalid. Legacy arrays/version 2 remain compatible.

Deployment: back up the database, then manually apply the new
`CREATE TABLE IF NOT EXISTS link_events` query in [db-changes.sql](db-changes.sql).
Do not reapply earlier ALTER queries when their columns already exist. Deploy
backend and web assets/service worker v33 together after the table exists.
Fresh-install schema includes the table. No SQL, migration, or new dependency
was executed or added during implementation. Rollback restores prior application
files and retains the additive table; writes during rollback will not record history.

Merge-note retries remain separate appends, and useful-review completion records
each successful call. Undo/request-ID deduplication is the next feature. Real-browser
and disposable-MySQL transaction/concurrency/restore smoke checks remain pending;
automated persistence and DOM verification use mocks.

Validation: all 398 tests pass. Overall coverage is 88.30% lines, 85.94% branches,
and 90.13% functions. History reader and route have 100% lines/functions; history
UI has 100% lines/functions and 88.89% branches. DB helper coverage is 96.47%
lines, 91.30% branches, and 100% functions. Code and security review findings
were resolved, including complete histories above 5,000 events and linear export
grouping.

## v3.2 - Related-link suggestions - 2026-10-05

- The editor shows up to five suggested connections with shared-tag or similar-title reasons, based on saved values.
- Matching reads at most 200 active candidates, excludes existing connections, and uses deterministic ranking. Host alone and URL fallback titles cannot qualify.
- Connect uses the existing explicit relationship action. Skip for now lasts for the current editor session. Loading failures offer retry without blocking manual search.
- Read-scoped authenticated requests support both API prefixes. No remote fetches, automatic connections, schema changes, or dependencies are added.
- Request guards preserve connections across late responses; pending controls prevent duplicate clicks, and focus restores after rendering. Long reasons wrap on narrow screens.

Deployment: deploy backend, editor HTML, JavaScript, CSS, and service worker
cache v32 together. No new SQL is needed. Earlier save-reason and reading-position
columns still require manual setup when absent; see [db-changes.sql](db-changes.sql).
Rollback restores those application files together without changing data.
Automated ranking, limits, authorization, DOM safety, confirmation, retries,
keyboard focus, races, and manual relationship regression checks pass. Real-browser
and disposable-MySQL smoke checks remain pending.

Validation: all 368 tests pass. Overall coverage is 86.47% lines, 84.18% branches,
and 87.88% functions. The suggestion reader and route have 100% line/function
coverage; editor relationship controls have 100% lines, 82.98% branches, and
92.59% functions. Code and security review findings were resolved.

## v3.2 - Reading position - 2026-10-05

- Extension 1.2.0 adds explicit Save position and Resume reading for saved
  articles in the current tab. Clipboard/manual capture URLs do not change the
  target tab. No automatic scroll tracking or article-body capture is added.
- Resume restores a unique nearby heading's viewport offset, or uses scroll
  ratio when the heading is missing/ambiguous. Changed geometry reports an
  approximate position. Browser pages, extension stores, PDFs, recognized
  embedded readers, and virtualized feeds are outside the supported flow.
- Authenticated exact canonical lookup and reading-position GET/PUT support both
  API prefixes. PUT requires write scope; URL changes and soft archive block stale
  writes. Position saves leave review status, timestamps, and open counts unchanged.
- One nullable `links.reading_position` JSON field stores the latest position.
  Canonical URL edits clear it atomically; archive retains it; hard delete removes
  it. Complete JSON version 2 backups and validated imports retain positions.

Deployment: back up the database and manually apply only the new
`reading_position` ALTER query from [db-changes.sql](db-changes.sql) if the column
is absent. Earlier installations may also need the save-reason query; do not
reapply a column that already exists. Deploy the backend after the column is
present, then reload the unpacked extension and accept its added `scripting`
permission. No migration or database query was executed during implementation.

Rollback can retain the additive column and saved data. Older code ignores it;
disable reading controls until the compatible backend is restored. No web cache
or runtime dependency changes are needed. Real Chromium save/reopen/resume and
disposable-MySQL smoke checks remain pending; automated persistence uses mocks.

Validation: all 350 tests pass. Measured coverage is 85.30% lines, 83.84%
branches, and 86.90% functions. The reading-position domain and route modules
have 100% coverage; the extension reading script has 100% lines/functions and
93.68% branches. Tests cover geometry, stale navigation, credential separation,
URL-edit clearing, legacy IDs, malformed backups, authorization, and shared
popup controls. Code and security review findings were fixed before delivery.

## v3.2 - Extension clipboard capture - 2026-10-05

- Extension 1.1.0 adds Paste and save for one copied HTTP/HTTPS URL, retaining
  popup tags, notes, and save reason. No clipboard read occurs on popup load.
- Optional clipboard permission is requested only from a fresh explicit retry
  click. The URL field accepts manual paste when clipboard access is denied or
  unavailable.
- Different copied or manually edited URLs clear the active tab's title.
  Metadata lookup has a five-second timeout and falls back to the copied URL.
- Capture URLs reject credentials, whitespace, unsafe protocols, and input over
  2,048 characters. Failed requests and duplicates restore both save controls.
- No dependencies, database changes, SQL queries, or web cache changes were added.

Reload the unpacked extension from Chrome's extension management page to apply
the popup and optional-permission manifest changes. Test a copied URL from a
different tab, permission retry/denial, manual paste, and duplicate recovery.
Real-browser smoke testing remains pending because Chrome automation was
unavailable during implementation.

Validation: all 328 tests pass. Measured coverage is 84.55% lines, 82.43%
branches, and 85.38% functions. The popup has 100% line/function coverage and
98.82% branch coverage, including clipboard permission, timeout, and retry flows.

## v3.2 - Selective Markdown export

- Browse now offers Export current view and Export selected. Current view
  includes all matching pages, search/tag/status/YouTube filters, and sort order.
- Review and useful-revisit views export exactly their remaining visible links.
- Markdown includes tags, save reasons, and notes using safe text escaping.
- Selected exports support 1-200 distinct IDs; missing records produce an error
  without a partial download. Filtered exports support up to 5,000 matching links
  and request narrower filters above that limit.
- Download feedback reports the scope and exact server count. Failed requests
  produce an inline error, and pending downloads cannot be started twice.
- Existing unscoped Markdown, complete JSON backups, and CSV exports remain
  available. No database changes or dependencies were added for this feature.

Deploy backend and web assets together. The service-worker cache changes from
v30 to v31. The earlier save-reason feature still requires its documented column
if it has not yet been applied; this export slice adds no SQL.

See [API.md](API.md) for scoped request parameters and limits.

Validation: all 315 tests pass. Backend coverage is 83.72% lines, 81.17%
branches, and 84.32% functions; the scoped export reader has 100% coverage.
Browser-script tests cover filters, download feedback, stale searches, and
completed review sessions. A real-browser smoke check remains pending because
the browser integration was unavailable during implementation.

## v3.2 - Save reasons - 2026-10-05

### Added

- Optional plain-text save reason, separate from notes, in the editor, expandable
  Quick Add control, and browser extension popup.
- Original capture intent displayed on home review cards and library rows.
- Save-reason search, offline capture/recovery/sync, JSON backup/import, and safe
  Markdown export. CSV keeps its existing five-column format.
- Server validation: strings only, trimmed, maximum 500 UTF-16 code units.
  Existing clients and records without a reason default to empty text.

Editing a reason does not count as a meaningful revisit. Omitted reasons in
partial updates are preserved; an explicit empty string clears the reason.
Restoring or merging an existing duplicate never overwrites its save reason.
Review-history events will be added with the future history feature.

### Deployment

1. Back up the database and apply [db-changes.sql](db-changes.sql) manually once
   to an existing installation before starting the new backend.
2. Deploy the application and reload the unpacked browser extension to load its
   updated popup. The web service-worker cache changes from v29 to v30.
3. Verify capture, editing, search, review visibility, and JSON export/import.

The SQL file contains queries only. No database query or migration was executed
during implementation. [full-db.sql](full-db.sql)'s CREATE TABLE definition now
includes the field; existing installations should use the targeted SQL above.
Do not reapply the ALTER statement if the column already exists.

Application rollback can retain the additive column and its data. Older app
versions ignore save reasons. Complete JSON backups retain reasons; CSV does not.

### Validation

- 299 automated tests pass, including capture/edit payloads, review rendering,
  offline queue/sync, extension payloads, route validation, persistence, and exports.
- Reported repository coverage: 83.20% lines, 79.23% branches, 83.70% functions.
  The changed domain and validation modules exceed 80% on all three measures.
- Code/security review reported no findings. SQL was inspected, not executed.
- Real-browser smoke testing could not run because the browser integration was
  unavailable. Browser-script behavior is covered through Node VM tests; verify
  real browser, phone layout, and extension flows during deployment.

See [API.md](API.md) for the field contract and
[V3.2_IMPLEMENTATION_PLAN.md](V3.2_IMPLEMENTATION_PLAN.md) for remaining work.
