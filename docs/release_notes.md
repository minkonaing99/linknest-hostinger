# Release notes

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
