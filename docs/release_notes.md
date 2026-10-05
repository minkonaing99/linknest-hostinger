# Release notes

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
