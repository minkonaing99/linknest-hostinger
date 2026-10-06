# SCHEMA - Backend Schema + API

Last updated: 2026-10-06 (v3.2)

Canonical DDL: [full-db.sql](full-db.sql). Incremental changes for existing
databases: [new-changes-db.sql](new-changes-db.sql). Full endpoint reference with
request/response bodies: [API.md](API.md).

Engine: InnoDB, `utf8mb4_unicode_ci`. IDs are UUID strings (`VARCHAR(36)`).
Timestamps are `DATETIME(3)` in UTC and appear in the API as ISO 8601.

## Data Models

## users

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | VARCHAR(36) | PK | |
| username | VARCHAR(100) | UNIQUE, NOT NULL | admin seeded from `LINKNEST_ADMIN_USERNAME` |
| password_hash | TEXT | NOT NULL | bcrypt |
| created_at / updated_at | DATETIME(3) | NOT NULL | |

## links

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | VARCHAR(36) | PK | |
| url | TEXT | NOT NULL, UNIQUE (prefix 768) | normalized canonical URL |
| title | VARCHAR(300) | default `''` | fetched server-side when empty |
| host | VARCHAR(255) | default `''` | derived from URL; duplicate scan groups by host |
| status | VARCHAR(20) | default `saved`, indexed | see enums |
| tags | JSON | NOT NULL | array, max 20 tags of 50 chars each |
| pinned | TINYINT(1) | default 0, indexed | shown as favorite |
| date | VARCHAR(10) | indexed | `YYYY-MM-DD` saved date |
| created_at / updated_at | DATETIME(3) | NOT NULL, indexed | `updatedAfter` sync filter |
| deleted_at | DATETIME(3) | NULL, indexed | soft delete |
| last_opened_at | DATETIME(3) | NULL, indexed | open tracking |
| opened_count | INT | default 0 | |
| remind_at | DATETIME(3) | NULL, indexed | reminder / snooze |
| notes | TEXT | default `''` | plain text, max 10,000 |
| save_reason | VARCHAR(500) | default `''` | separate from notes |
| reading_position | JSON | NULL | heading + scroll ratio from extension |
| first_meaningful_at | DATETIME(3) | NULL | revisit metric |
| first_useful_at | DATETIME(3) | NULL, indexed | |
| last_useful_reviewed_at | DATETIME(3) | NULL | 30-day useful revisit |
| revision | BIGINT UNSIGNED | default 0 | bumped on every mutation; guards undo |

## link_relationships

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| link_id_a | VARCHAR(36) | PK part, FK links ON DELETE CASCADE | `CHECK (link_id_a < link_id_b)` |
| link_id_b | VARCHAR(36) | PK part, FK links ON DELETE CASCADE | undirected pair stored once |
| created_at | DATETIME(3) | NOT NULL | |

## link_events (review history)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | VARCHAR(36) | PK | |
| link_id | VARCHAR(36) | FK links CASCADE | cleared on permanent delete |
| actor_id | VARCHAR(36) | FK users SET NULL | |
| type | VARCHAR(32) | NOT NULL | see enums |
| occurred_at | DATETIME(3) | index `(link_id, occurred_at, id)` | cursor paging |
| metadata | JSON | NOT NULL | changed field names only, no old note text |

## link_actions + link_action_items (undo receipts)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| link_actions.id | VARCHAR(36) | PK | |
| actor_id | VARCHAR(36) | FK users CASCADE | |
| request_id | VARCHAR(36) | UNIQUE `(actor_id, request_id)` | idempotent retries |
| fingerprint | CHAR(64) | NOT NULL | SHA-256 of the payload. A different payload on the same request ID returns 409 |
| kind | VARCHAR(20) | `archive` / `status` | |
| created_at / expires_at | DATETIME(3) | indexed cleanup | expires 10 min after creation |
| undone_at, result_json, undo_result | | NULL | |
| link_action_items.(action_id, link_id) | | PK, FK action CASCADE | |
| before_values | JSON | NOT NULL | status, pin, milestones, notes snapshot |
| after_revision | BIGINT UNSIGNED | NOT NULL | undo blocked if revision moved |

## sessions / refresh_tokens / api_tokens

| Table | Key fields | Notes |
|-------|-----------|-------|
| sessions | token PK (64), user_id, username, expires_at (indexed) | web cookie sessions |
| refresh_tokens | token PK, user_id, expires_at, revoked_at; index `(user_id, revoked_at)` | rotated on refresh |
| api_tokens | id PK, user_id FK CASCADE, name (100), token_hash UNIQUE (SHA-256), scope `read`/`write`, last_used_at, expires_at, revoked_at | raw token shown once |

### Relationships

- users 1-N sessions, refresh_tokens, api_tokens, link_actions
- users 1-N link_events (as actor, nullable)
- links 1-N link_events, link_action_items
- links N-N links via link_relationships
- link_actions 1-N link_action_items

### Enums + constants

| Set | Values |
| --- | --- |
| Link status | `unread`, `saved`, `useful`, `archived` |
| History event type | `saved`, `imported`, `note_updated`, `marked_useful`, `status_changed`, `snoozed`, `archived`, `restored`, `useful_review_completed`, `save_reason_updated`, `details_updated`, `action_undone` |
| Action kind | `archive`, `status` |
| Token scope | `read`, `write` |
| Limits (`lib/config.js`) | title 300, notes 10,000, save reason 500, tag 50, tags 20, list default 50 / max 200 |

### Validation rules

- `url` is required, `http`/`https` only, and normalized. For outbound fetches it must resolve to a public address.
- `status` must be in the status enum. `tags` are trimmed, deduplicated, and limited as above.
- `remindAt` is ISO 8601 or null. `date` is `YYYY-MM-DD`.
- API token `name` is required (100 chars max). `scope` is `read` or `write`.
- Bodies must be plain JSON objects.

### Soft delete

`deleted_at` set means the link is in the trash. Archive is a separate status. Restore clears `deleted_at` or
moves `archived` back. A permanent delete removes the row, and history, relationships, and action items cascade.

### Audit fields

Every table has `created_at`. Mutable rows have `updated_at`. `links.revision` gives optimistic versioning.
`link_events.actor_id` records who did what. There is no `created_by` on links (single user).

### Auth model

See [TECH.md](TECH.md#security). Session cookies by default last 30 days. Access JWTs last 15 min and refresh tokens 30 days,
rotated on refresh. API tokens are hashed and have optional expiry.

### File / media storage

No uploads. Favicons and YouTube thumbnails are remote URLs. Static assets live in `public/`.
Offline downloads stay on the device in IndexedDB.

### Caching

- Server: none for API (`Cache-Control: private, no-store`). Static assets are compressed.
- Client: service worker cache `linknest-v35` holds the app shell. Protected caches are purged on logout or 401.

### Background jobs

| Job | Where | Schedule | Retry |
| --- | --- | --- | --- |
| Undo receipt cleanup (at most 100 older than 24 h) | in-process `setInterval` + startup + action requests | every 60 s | next tick |
| Offline capture sync | browser (`offline-queue.js`) | on reconnect / page load | per record, failed state shown |

### Schema change strategy

No migration tool. Append additive SQL to [new-changes-db.sql](new-changes-db.sql) and update
[full-db.sql](full-db.sql). The owner applies it in phpMyAdmin after a backup. Rollback
keeps the additive schema. `database/001-003` are the original baseline files.

## API

- **Base URL:** `https://<host>`. Every route is available under both `/api/...` and `/api/v1/...`.
- **Auth:** session cookie (web), or `Authorization: Bearer <access JWT | API token>`.
- **Optional header:** `X-LinkNest-User-ID`. A mismatch returns `409`.

### Endpoints

| Method | Path | Description | Auth |
| --- | --- | --- | --- |
| GET | /api/health | liveness | No |
| POST | /api/login | cookie login | No |
| POST | /api/logout, /api/auth/logout | logout / revoke refresh token | Yes |
| POST | /api/auth/token | issue access + refresh token | No (credentials) |
| POST | /api/auth/refresh | rotate refresh token | No (refresh token) |
| GET | /api/me | current user | Yes |
| GET, POST | /api/links | list (filters, paging) / create | Yes |
| GET, PUT, DELETE | /api/links/:id | read / update / soft or hard delete | Yes |
| PATCH | /api/links/bulk | bulk status/delete | Yes (write) |
| POST | /api/links/restore/:id | restore | Yes (write) |
| POST | /api/links/:id/opened | open tracking | Yes (write) |
| POST | /api/links/:id/merge-note | merge note into existing | Yes (write) |
| GET | /api/links/review | five-link review queue | Yes |
| GET | /api/links/useful-review | useful revisit queue | Yes |
| POST | /api/links/:id/useful-review | complete useful review | Yes (write) |
| GET | /api/links/duplicates | duplicate candidates for a URL/title | Yes |
| GET | /api/links/scan-duplicates | library-wide likely duplicates | Yes |
| GET, POST, DELETE | /api/links/:id/related[/:relatedId] | manual relationships | Yes |
| GET | /api/links/:id/suggestions | related-link suggestions | Yes |
| GET | /api/links/:id/history | review history (cursor) | Yes |
| POST | /api/links/actions | create undoable action | Yes (write) |
| POST | /api/actions/:id/undo | undo | Yes (write) |
| GET | /api/links/lookup | find link by URL (extension) | Yes |
| GET, PUT | /api/links/:id/reading-position | read / save position | Yes |
| GET | /api/links/offline-snapshot | offline library download | Yes |
| GET | /api/links/export, export.csv, export.md | JSON / CSV / Markdown export | Yes |
| POST | /api/links/import, import-csv, import-bookmarks, import-preview | import | Yes (write) |
| GET | /api/stats, /api/tags | weekly stats / tag counts | Yes |
| GET | /api/fetch-title | server-side title fetch | Yes |
| GET, POST | /api/tokens | list / create API tokens | Yes |
| DELETE | /api/tokens/:id | revoke token | Yes |

### Example

```http
POST /api/links
Authorization: Bearer <write token>
Content-Type: application/json

{ "url": "https://example.com/article", "tags": ["reading"], "saveReason": "For the Q4 plan" }
```

```json
{ "ok": true, "entry": { "id": "0b6c...", "url": "https://example.com/article", "title": "Example Article", "status": "saved", "tags": ["reading"], "saveReason": "For the Q4 plan" } }
```

Response `201`. Adds `duplicateCandidates` when similar links exist.

### Error format

```json
{ "error": "Human-readable message" }
```

Codes: `400` validation, `401` auth, `403` read-only token, `404` not found,
`409` duplicate / conflict / account changed, `429` login rate limit, `500` generic.

### Rate limiting

Only login is rate limited: 10 attempts per 15 minutes per IP, then a 15-minute lockout with `Retry-After`.
