# SCHEMA — Link Nest

## Data Models

### users

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | VARCHAR(36) | PK | UUID |
| username | VARCHAR(100) | UNIQUE NOT NULL | |
| password_hash | TEXT | NOT NULL | bcrypt |
| created_at | DATETIME(3) | NOT NULL | |
| updated_at | DATETIME(3) | NOT NULL | |

### links

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | VARCHAR(36) | PK | UUID |
| url | TEXT | NOT NULL | UNIQUE KEY on url(768) |
| title | TEXT | NOT NULL DEFAULT '' | |
| host | VARCHAR(255) | NOT NULL DEFAULT '' | extracted from URL |
| status | VARCHAR(20) | NOT NULL DEFAULT 'saved' | enum: unread, saved, useful, archived |
| tags | LONGTEXT | NOT NULL | JSON array stored as longtext |
| pinned | TINYINT(1) | NOT NULL DEFAULT 0 | boolean |
| date | VARCHAR(10) | NOT NULL DEFAULT '' | YYYY-MM-DD |
| created_at | DATETIME(3) | NOT NULL | |
| updated_at | DATETIME(3) | NOT NULL | |
| deleted_at | DATETIME(3) | NULL | soft delete |
| last_opened_at | DATETIME(3) | NULL | set on /opened call |
| opened_count | INT(11) | NOT NULL DEFAULT 0 | incremented on /opened |
| remind_at | DATETIME(3) | NULL | future notification trigger |

**Indexes:** `updated_at`, `created_at`, `status`, `date`, `pinned`, `deleted_at`, `last_opened_at`, `remind_at`

### sessions

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| token | VARCHAR(64) | PK | SHA-256 hex of raw cookie value |
| user_id | VARCHAR(36) | NOT NULL | |
| username | VARCHAR(100) | NOT NULL | denormalized for fast reads |
| created_at | DATETIME(3) | NOT NULL | |
| expires_at | DATETIME(3) | NOT NULL | pruned at startup |

### refresh_tokens

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| token | VARCHAR(64) | PK | SHA-256 hex |
| user_id | VARCHAR(36) | NOT NULL | |
| username | VARCHAR(100) | NOT NULL | |
| created_at | DATETIME(3) | NOT NULL | |
| expires_at | DATETIME(3) | NOT NULL | |
| revoked_at | DATETIME(3) | NULL | set on logout or rotation |

**Indexes:** `expires_at`, `(user_id, revoked_at)`

### api_tokens

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | VARCHAR(36) | PK | UUID |
| user_id | VARCHAR(36) | NOT NULL | FK → users.id CASCADE DELETE |
| name | VARCHAR(100) | NOT NULL | user-assigned label |
| token_hash | VARCHAR(64) | UNIQUE NOT NULL | SHA-256 of raw token |
| scope | VARCHAR(10) | NOT NULL DEFAULT 'write' | 'read' or 'write' |
| created_at | DATETIME(3) | NOT NULL | |
| last_used_at | DATETIME(3) | NULL | updated on auth |
| expires_at | DATETIME(3) | NULL | NULL = never expires |
| revoked_at | DATETIME(3) | NULL | set on delete |

## Relationships

- `sessions.user_id` → `users.id`
- `refresh_tokens.user_id` → `users.id`
- `api_tokens.user_id` → `users.id` (CASCADE DELETE)
- `links` has no user FK — single-user model; all links belong to the single admin

## Enums + Constants

**link.status:** `unread` | `saved` | `useful` | `archived`
- Unknown values passed to API default to `saved` (enforced by `normalizeStatus` in `lib/utils.js`)

**api_token.scope:** `read` | `write`
- `read` allows GET endpoints only
- `write` allows all CRUD

## Validation Rules

| Field | Rules |
|-------|-------|
| url | Required; must be valid URL; `assertPublicUrl` on title fetch (SSRF guard) |
| title | Optional; if blank or equal to URL, server auto-fetches from page |
| status | One of enum values; unknown → `saved` |
| tags | Array of strings; each tag trimmed; max length not enforced in DB |
| date | YYYY-MM-DD or empty string |
| pinned | Boolean |
| remind_at | ISO 8601 datetime or null |
| username | Required, non-empty |
| password | Min length enforced at login; hash stored, never plaintext |
| JWT_SECRET | Min 32 chars enforced at startup |

## Soft Delete Strategy

`links.deleted_at` — non-null means deleted. Archive page shows `deleted_at IS NOT NULL`. All browse/search queries filter `deleted_at IS NULL`.

## Auth Model

Two short-lived token types + one long-lived:

| Token | Storage | Lifetime | Usage |
|-------|---------|----------|-------|
| JWT access token | Client memory | 15 min (default) | `Authorization: Bearer <token>` |
| Refresh token | DB (`refresh_tokens`), SHA-256 hashed | 30 days | `POST /api/auth/refresh` |
| API token | DB (`api_tokens`), SHA-256 hashed | Configurable or never | `Authorization: Bearer <token>` |
| Session cookie | DB (`sessions`), SHA-256 hashed | 7 days | `Cookie: linknest_session=<token>` |

Auth check order per request: Cookie session → Bearer JWT → API token.

## Migration Strategy

- Files in `database/` prefixed `NNN_name.sql`, applied in order via phpMyAdmin
- No ORM migration runner — manual apply
- Rollback: manual `ALTER TABLE DROP COLUMN` or restore from backup
- Current migrations: `001_initial.sql` → `002_retention.sql` → `003_api_tokens.sql`

---

## API

### Base URL

```
http://localhost:3080        (local dev)
https://your-domain.example  (production)
```

All routes available under both `/api/...` and `/api/v1/...`.

### Auth Method

`Cookie: linknest_session=<token>` (web UI) or `Authorization: Bearer <jwt-or-api-token>` (API clients).

### Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | /api/login | Create session | Public |
| POST | /api/logout | Destroy session | Session |
| GET | /api/me | Current user info | Any |
| POST | /api/auth/token | Issue JWT via credentials | Public |
| POST | /api/auth/refresh | Rotate refresh token, issue new JWT | Public (refresh token in body) |
| GET | /api/links | List/search links | Any |
| POST | /api/links | Create link | Any |
| GET | /api/links/:id | Get single link | Any |
| PATCH | /api/links/:id | Update link | Any |
| DELETE | /api/links/:id | Soft-delete link | Any |
| POST | /api/links/:id/opened | Record open event | Any |
| POST | /api/links/bulk | Bulk status/tag update | Any |
| GET | /api/links/export | Export all as JSON | Any |
| POST | /api/links/import | Bulk import from JSON | Any |
| GET | /api/stats | Counts by status | Any |
| GET | /api/tags | All tags with counts | Any |
| POST | /api/fetch-title | Fetch page title for URL | Any |
| GET | /api/tokens | List API tokens | Any |
| POST | /api/tokens | Create API token | Any |
| DELETE | /api/tokens/:id | Revoke API token | Any |

### Request/Response Example

```http
POST /api/links
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://example.com/article",
  "title": "",
  "status": "unread",
  "tags": ["reading", "tech"]
}
```

```json
{
  "ok": true,
  "link": {
    "id": "uuid",
    "url": "https://example.com/article",
    "title": "Example Article",
    "host": "example.com",
    "status": "unread",
    "tags": ["reading", "tech"],
    "pinned": false,
    "date": "2026-06-02",
    "createdAt": "2026-06-02T10:00:00.000Z",
    "updatedAt": "2026-06-02T10:00:00.000Z",
    "deletedAt": null,
    "lastOpenedAt": null,
    "openedCount": 0,
    "remindAt": null
  }
}
```

### Error Response Format

```json
{
  "error": "Human-readable message",
  "details": { "field": "validation detail" }
}
```

HTTP status codes: `400` validation, `401` unauthenticated, `403` forbidden (wrong scope), `404` not found, `409` duplicate URL, `429` rate limited, `500` server error.

### Rate Limiting

Applied to: `POST /api/login`, `POST /api/auth/token`, `POST /api/auth/refresh`.
In-memory sliding window per IP. Exceeded → `429 Too Many Requests`.
