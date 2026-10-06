# Link Nest API

Last updated: 2026-10-05

Link Nest exposes a private JSON API for:

- the built-in web UI using cookie sessions
- mobile or external clients using bearer access tokens and refresh tokens

All documented routes are available under both:

- `/api/...`
- `/api/v1/...`

Examples in this document use `/api/...` for brevity.

## Offline library snapshot

`GET /api/links/offline-snapshot` (also `/api/v1/`) requires authentication;
read-scoped tokens are supported. It accepts no query parameters and returns
`Cache-Control: private, no-store`.

```json
{
  "schemaVersion": 1,
  "userId": "authenticated-user-id",
  "links": [],
  "total": 0,
  "complete": true,
  "downloadedAt": "2026-10-05T00:00:00.000Z"
}
```

The snapshot includes active links only (`deleted_at IS NULL` and status other
than `archived`), ordered by `updated_at DESC, id ASC`. One repeatable-read
transaction reads count and rows. It returns a prefix of at most 2,000 links and
25 MiB of UTF-8 serialized JSON, including the envelope. `total` counts all
eligible links; `complete` is false when either cap truncates the library.

Each link contains only `id`, `url`, `title`, `status`, `tags`, `notes`,
`saveReason`, `pinned`, `date`, `createdAt`, and `updatedAt`. Credentials, internal
revisions, action receipts, histories, and reading positions are excluded.
This is a device read cache, not a complete backup or an article download.

Browser downloads and capture sync send optional `X-LinkNest-User-ID` with the
last verified user ID. After authentication, the router rejects a mismatched
or invalid supplied header with `409` before reads/writes. Clients without this header
keep their existing contract. `/api/me` success and authentication failure are
also private, no-store. A failed download never replaces the old device snapshot.

## Base URL

Examples:

```text
http://localhost:3080
https://your-domain.example
```

## Authentication

Link Nest supports two auth styles.

### 1. Cookie session auth for the website

Used by the built-in browser UI.

#### Log in

```http
POST /api/login
Content-Type: application/json
```

Request body:

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

Success response:

```json
{
  "ok": true,
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z"
  }
}
```

Notes:

- the server also sets an HTTP-only session cookie
- repeated failed login attempts are rate-limited
- invalid credentials return `401`
- too many attempts return `429`

#### Log out

```http
POST /api/logout
```

Success response:

```json
{
  "ok": true
}
```

This clears the session cookie and removes the stored session if present.

### 2. Bearer token auth for mobile or external clients

Used by native apps or API clients.

#### Get access token and refresh token

```http
POST /api/auth/token
Content-Type: application/json
```

Request body:

```json
{
  "username": "your-username",
  "password": "your-password"
}
```

Success response:

```json
{
  "ok": true,
  "tokenType": "Bearer",
  "accessToken": "<jwt>",
  "accessTokenExpiresIn": 900,
  "refreshToken": "<opaque-refresh-token>",
  "refreshTokenExpiresAt": "2026-05-14T00:00:00.000Z",
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z"
  }
}
```

Use the access token like this:

```http
Authorization: Bearer <accessToken>
```

#### Refresh an access token

```http
POST /api/auth/refresh
Content-Type: application/json
```

Request body:

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

Success response returns a new token pair.

Notes:

- refresh tokens are rotated
- invalid or expired refresh tokens return `401`

#### Revoke a refresh token

```http
POST /api/auth/logout
Content-Type: application/json
```

Request body:

```json
{
  "refreshToken": "<opaque-refresh-token>"
}
```

Success response:

```json
{
  "ok": true,
  "revoked": true
}
```

## Current user

### Get current authenticated user

```http
GET /api/me
```

Works with either:

- session cookie
- bearer token

Success response:

```json
{
  "user": {
    "id": "user-id",
    "username": "your-username",
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z"
  },
  "authMethod": "cookie"
}
```

If not authenticated:

```json
{
  "error": "Authentication required"
}
```

## Link model

A link document returned by the API looks like this:

```json
{
  "id": "42891bc9-d756-49db-9538-0717596e766c",
  "date": "2026-04-14",
  "title": "Example Article",
  "url": "https://example.com/article",
  "host": "example.com",
  "notes": "Useful explanation of the topic.",
  "saveReason": "Reference for my next project.",
  "tags": ["reading", "reference"],
  "status": "saved",
  "pinned": false,
  "createdAt": "2026-04-14T00:00:00.000Z",
  "updatedAt": "2026-04-14T00:00:00.000Z",
  "deletedAt": null,
  "lastOpenedAt": null,
  "openedCount": 0,
  "remindAt": null,
  "firstMeaningfulAt": null,
  "firstUsefulAt": null,
  "lastUsefulReviewedAt": null,
  "thumbnailUrl": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
}
```

### Field notes

- `id` is the app-level identifier
- `date` uses `YYYY-MM-DD`
- `status` is one of `saved`, `unread`, `useful`, `archived`
- `deletedAt = null` means the link is active
- `deletedAt != null` means the link is soft-deleted
- `host` is derived from the normalized URL
- `notes` is optional plain text, limited to 10,000 characters
- `saveReason` is optional plain text, limited to 500 JavaScript UTF-16 code units after trimming, and defaults to `""`
- `saveReason` accepts strings only when supplied; null, arrays, and other types return `400`
- changing `saveReason` updates `updatedAt` but does not count as a meaningful revisit or useful review
- `lastOpenedAt` is set each time `POST /api/links/:id/opened` is called
- `openedCount` increments by 1 on each open call
- `remindAt` is a nullable ISO datetime for user-set reminders
- `firstMeaningfulAt` records the first note change, useful status, or soft archive
- `firstUsefulAt` records the first transition to useful made at least 24 hours after capture
- `lastUsefulReviewedAt` records completion of the latest useful-link revisit
- `thumbnailUrl` is derived for supported YouTube videos and is otherwise `null`
- clients cannot set arbitrary thumbnail URLs

## Protected endpoints

Every endpoint below requires authentication unless stated otherwise.

## Link listing

### List links

```http
GET /api/links
```

Supported query params:

- `page`
- `limit` (default `50`, max `200`)
- `q`
- `search` (alias of `q`)
- `status`
- `tag`
- `sort` = `updatedAt`, `createdAt`, `date`, `title`
- `order` = `asc`, `desc`
- `updatedAfter` = ISO datetime
- `includeDeleted` = `true|false`
- `remindBefore` = ISO datetime — returns links where `remindAt` is set and `remindAt <= remindBefore`
- `staleBefore` = ISO datetime — returns links not opened since this time (or never opened and created before it)
- `ageBefore` = ISO datetime - returns active saved or unread links created on or before the cutoff, without a meaningful revisit or future reminder
- `neverOpened` = `true|false` — returns links where `openedCount = 0`
- `youtube` = `only|exclude` — includes only YouTube links or removes them from results

Examples:

```http
GET /api/links?page=1&limit=20
```

```http
GET /api/links?q=swift&status=saved&tag=ios&sort=updatedAt&order=desc
```

```http
GET /api/links?status=deleted
```

```http
GET /api/links?includeDeleted=true
```

Response:

```json
{
  "links": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "pages": 0,
  "query": {
    "q": "swift",
    "status": "saved",
    "tag": "ios",
    "sort": "updatedAt",
    "order": "desc",
    "includeDeleted": false,
    "updatedAfter": null
  }
}
```

### Listing behavior

- active lists exclude deleted links by default
- `status=deleted` returns only soft-deleted links
- `q` searches `title`, `notes`, `saveReason`, `url`, `host`, `tags`, and `date`
- sorting always keeps pinned items first

### Review queue

```http
GET /api/links/review
```

Returns up to five active saved or unread links with no meaningful action.
Due reminders come first, followed by the oldest links that are at least 14
days old. A future reminder suppresses an otherwise eligible link until due.

```json
{
  "links": []
}
```

Opening and snoozing do not count as meaningful actions. Changing a note,
marking useful, or soft-archiving sets `firstMeaningfulAt` once.

### Useful revisit queue

```http
GET /api/links/useful-review
```

Returns up to five useful links whose save, first useful, or latest useful review
date is at least 30 days old.

```http
POST /api/links/:id/useful-review
```

Records a completed useful-link revisit. Send no body for Still useful, or send
the changed note atomically with completion:

```json
{
  "notes": "Updated plain-text note"
}
```

Opening alone does not complete it. Notes are limited to 10,000 characters.

## Link write operations

For a share-sheet capture workflow using a long-lived write token, see the
[iPhone Shortcut setup guide](IPHONE_SHORTCUT.md).

### Create a link

```http
POST /api/links
Content-Type: application/json
```

Request body:

```json
{
  "url": "https://example.com/article?utm_source=test",
  "title": "Example Article",
  "date": "2026-04-14",
  "status": "saved",
  "tags": ["reading", "reference"],
  "notes": "Useful explanation of the topic.",
  "saveReason": "Reference for my next project.",
  "pinned": false
}
```

Success response:

```json
{
  "ok": true,
  "entry": {
    "id": "link-id",
    "date": "2026-04-14",
    "title": "Example Article",
    "url": "https://example.com/article",
    "host": "example.com",
    "tags": ["reading", "reference"],
    "notes": "Useful explanation of the topic.",
    "status": "saved",
    "pinned": false,
    "createdAt": "2026-04-14T00:00:00.000Z",
    "updatedAt": "2026-04-14T00:00:00.000Z",
    "deletedAt": null
  }
}
```

Behavior:

- URLs are normalized before storage
- common tracking parameters like `utm_*`, `fbclid`, and `gclid` are removed
- invalid URLs return `400`
- duplicate URLs return `409`
- if a matching URL already exists in archived state, the response includes the existing id and `archived: true`

Example duplicate response:

```json
{
  "error": "This link already exists but is archived",
  "url": "https://example.com/article",
  "id": "existing-link-id",
  "archived": true
}
```

### Check duplicate candidates

```http
GET /api/links/duplicates?url=https%3A%2F%2Fexample.com&title=Example
```

The response lists exact URL matches first, followed by same-domain links with
similar titles. Archived matches remain visible so clients can offer Restore.

```json
{
  "candidates": [
    {
      "id": "existing-link-id",
      "url": "https://example.com",
      "title": "Example",
      "similarity": 1,
      "exact": true,
      "archived": false
    }
  ]
}
```

Clients must ask before merging notes or restoring a link. Exact URL duplicates
cannot be saved separately. Similar links may be saved separately.

### Merge a note into an existing link

```http
POST /api/links/:id/merge-note
Content-Type: application/json
```

Request body:

```json
{
  "note": "New insight"
}
```

The note is appended atomically with a blank line separator. Empty notes and
combined notes longer than 10,000 characters are rejected.

### Related links

```http
GET /api/links/:id/related
POST /api/links/:id/related
DELETE /api/links/:id/related/:relatedId
```

POST accepts `{ "relatedId": "link-id" }`. Relationships are symmetric.
Self-links and missing links return `400` or `404`; duplicate pairs return
`409`. DELETE removes only the relationship and returns `{ "removed": true }`.

### Suggested connections

```http
GET /api/links/:id/suggestions
GET /api/v1/links/:id/suggestions
```

Authenticated sessions and read-scoped tokens can request suggestions. Responses
use `Cache-Control: private, no-store` and return `{ "suggestions": [] }` when no
matches qualify. Each item contains `link` (id, title, url, host), `sharedTags`,
`titleSimilarity` (rounded to three decimals), and a plain-text `reason` such as
`Shares tags: javascript` or `Similar title`.

Candidates share exact trimmed, case-sensitive tags or the same host, exclude
the source, archived/deleted links, and existing relationships, and are capped
at 200 after sorting by shared-tag count and binary ID. Results rank by shared
tags, Jaro-Winkler title similarity, then ID and are capped at five. Shared tags
or title similarity of at least 0.85 are required; host alone is insufficient.
Blank and URL fallback titles provide no title signal. Matching uses saved data,
does not fetch remote pages, and never writes a relationship or score.

Malformed IDs return `400`; missing, deleted, or archived sources return `404`.
Unexpected failures return `500` with a generic message. Use the existing
relationship POST to confirm a connection. Skip for now is local to the editor
session and has no API write.

### Review history

```http
GET /api/links/:id/history?limit=20&cursor=...
GET /api/v1/links/:id/history?limit=20&cursor=...
```

Authenticated sessions and read-scoped tokens can read history, including for
soft-archived links. Responses are private and no-store:

```json
{
  "events": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "type": "marked_useful",
      "occurredAt": "2026-10-05T01:00:00.000Z",
      "metadata": { "changedFields": ["status", "notes"], "fromStatus": "saved", "toStatus": "useful" }
    }
  ],
  "nextCursor": null
}
```

Limit defaults to 20, accepts integers 1-100, and rejects duplicate/unknown query
parameters. Treat `nextCursor` as opaque and send it unchanged for the next page.
Events order by descending timestamp and binary event ID; the validated cursor
contains that pair. Malformed IDs, limits, or cursors return `400`; missing or
permanently deleted links return `404`; unexpected failures return a generic `500`.

Types are `saved`, `imported`, `note_updated`, `marked_useful`, `status_changed`,
`snoozed`, `archived`, `restored`, `useful_review_completed`, `save_reason_updated`,
`details_updated`, and `action_undone`. One compound operation creates one event. Metadata lists
changed fields and may include before/after status or reminder time; it never
stores old or new note/reason text. Actor IDs are stored internally from the
authenticated user and omitted from this response and portable backups.

Writes and events commit together. Unchanged edits, repeated archive/restore,
opening, and position saves create no event. Useful-review completion records
each successful completion; merge-note retries append again under the existing
contract. The explicit action endpoint deduplicates matching request IDs; legacy
note-merge requests retain their existing append behavior.
History begins when the schema and compatible application are enabled; existing
links receive no fabricated past events. Soft archive retains events, while
permanent deletion cascades them.

### Undoable archive and status actions

```http
POST /api/links/actions
POST /api/v1/links/actions
Content-Type: application/json
```

```json
{ "requestId": "11111111-1111-4111-8111-111111111111", "kind": "status", "ids": ["link-id"], "status": "useful", "takeaway": "Used this in my project" }
```

Sessions and write-scoped tokens can create actions. Allowed keys are exactly
`requestId`, `kind`, `ids`, `status`, and `takeaway`. Kind is `archive` or `status`;
IDs must be 1-200 distinct nonempty strings of at most 36 characters. Status
accepts `saved`, `unread`, `useful`, or `archived` only for a status action.
Takeaway is optional nonempty plain text, allowed only for one link marked useful,
and is appended atomically within the existing combined 10,000-character note limit.
Archived/deleted links reject status actions; archive of an already deleted link
is a no-op. Missing members reject the entire batch before mutation.

Success returns `{ "entries": [...], "updated": 1, "action": { "id": "...",
"undoExpiresAt": "..." } }`. No changes return `updated: 0`, empty entries, and
`action: null`. Optional UUID request IDs are scoped to the authenticated user.
Repeating the same canonical payload returns its original result; reusing the ID
with another payload returns `409`. Receipts remain available for 24 hours;
actions expire for undo after 10 minutes. The browser retries a lost action reply
once with the same ID and payload, without retrying HTTP rejection responses.

```http
POST /api/actions/:id/undo
POST /api/v1/actions/:id/undo
```

Send no body or `{}`; previous link values are never accepted. Undo checks the
authenticated owner, expiry, every member, and exact internal revisions under
locks. Any later edit, open tracking, reading-position save, relationship change,
or restore blocks undo with `409`, and nothing is restored. Missing members also
block the whole batch. Expiry returns `410`; another owner's action returns `404`.
Malformed input returns `400`, unauthenticated requests `401`, and read tokens
`403`. Unexpected failures use a generic `500`; all responses are private/no-store.

Undo restores only server-held status/archive-owned values, including pin state
and relevant review milestones, plus a compound useful takeaway. It updates
`updatedAt` and revision without treating restoration as a new review decision,
and appends `action_undone`. Success returns restored entries/count and null action.
Repeated undo returns the stored success without repeating restoration or history.
Standalone note editing, ordinary restore, permanent delete, and imports are not
undo actions. Action receipts/snapshots and revisions never enter JSON backups.

The existing link PUT preserves its response and adds nullable `action` when a
supplied status changes. Editor details commit together, but undo preserves
unrelated title/URL/tag/reason/reminder changes. Useful status with a changed note
can reverse that compound note. Other note-derived milestones stay intact.
Legacy DELETE and bulk routes remain compatible; web archive/status gestures use
the explicit action endpoint. Cleanup deletes at most 100 receipts older than
24 hours at startup, every minute, and during action requests; item snapshots
cascade with receipts, while durable history remains.

### Update a link

```http
PUT /api/links/:id
Content-Type: application/json
```

Request body uses the same shape as create.

Omitting `saveReason` preserves the existing value. Send `"saveReason": ""`
to clear it. Save reasons are separate from notes and are never automatically
merged or overwritten when restoring an archived duplicate or merging a note.

Success response:

```json
{
  "ok": true,
  "entry": {
    "id": "link-id"
  }
}
```

Behavior:

- updates re-sanitize and normalize the full link
- `updatedAt` is refreshed automatically
- changing the URL to one already used by another link returns `409`
- missing ids return `404`

### Soft-delete a link

```http
DELETE /api/links/:id
```

Success response:

```json
{
  "ok": true,
  "total": 42
}
```

Behavior:

- sets `deletedAt` to now
- sets `updatedAt` to now
- forces `status` to `archived`
- clears `pinned`
- returns the count of active links after deletion

### Hard-delete a link

```http
DELETE /api/links/:id?hardDelete=true
```

This permanently removes the document.

### Restore a soft-deleted link

```http
POST /api/links/restore/:id
```

Success response:

```json
{
  "ok": true,
  "entry": {
    "id": "link-id"
  }
}
```

Behavior:

- sets `deletedAt` back to `null`
- refreshes `updatedAt`
- if the old status was `archived`, it becomes `saved`

### Track a link open

```http
POST /api/links/:id/opened
```

Requires auth. No request body needed.

Success response:

```json
{
  "ok": true,
  "entry": {
    "id": "link-id",
    "lastOpenedAt": "2026-06-01T12:00:00.000Z",
    "openedCount": 3
  }
}
```

Behavior:

- sets `lastOpenedAt` to now
- increments `openedCount` by 1
- returns the full updated entry
- returns `404` if the link does not exist or is soft-deleted

## Bulk operations

### Bulk update status

```http
PATCH /api/links/bulk
Content-Type: application/json
```

Request body:

```json
{
  "ids": ["id-1", "id-2"],
  "status": "useful"
}
```

Success response:

```json
{
  "ok": true,
  "updated": 2
}
```

Rules:

- `ids` must be a non-empty array
- maximum batch size is `200`
- only active links are updated

## Tag endpoints

### Get popular tags

```http
GET /api/tags?limit=15
```

Success response:

```json
{
  "tags": [
    { "tag": "ios", "count": 12 },
    { "tag": "security", "count": 7 }
  ]
}
```

Notes:

- only active links are counted
- `limit` defaults to `20`
- allowed range is `1..50`

## Stats endpoint

### Get library stats

```http
GET /api/stats
```

Success response:

```json
{
  "total": 120,
  "unread": 30,
  "saved": 70,
  "useful": 20,
  "archived": 0,
  "revisit": {
    "windowDays": 30,
    "minimumAgeDays": 14,
    "current": { "eligible": 10, "meaningful": 4, "rate": 40 },
    "previous": { "eligible": 8, "meaningful": 2, "rate": 25 },
    "percentagePointChange": 15,
    "targetRate": 45,
    "buildingBaseline": false
  },
  "weekly": {
    "windowDays": 7,
    "timeZone": "Asia/Bangkok",
    "start": "2026-09-05T17:00:00.000Z",
    "end": "2026-09-12T17:00:00.000Z",
    "saved": 6,
    "reviewed": 3,
    "usefulDecisions": 2,
    "revisitPercentage": 40,
    "oldestUnresolved": {
      "id": "42891bc9-d756-49db-9538-0717596e766c",
      "title": "Example Article",
      "createdAt": "2026-01-02T03:04:05.000Z"
    }
  }
}
```

Notes:

- counts are based on current stored status values
- `total` counts active links only
- revisit cohorts include soft-archived links and exclude links under 14 days old
- rates are whole percentages; unavailable rates, changes, and targets are `null`
- the target is 20 percentage points above the previous cohort, capped at 100
- `weekly` covers today and the previous six Thailand calendar days
- `weekly.reviewed` counts first meaningful revisits recorded during that window
- `weekly.usefulDecisions` counts first transitions to useful during that window
- `weekly.revisitPercentage` reuses the fair 30-day eligible-cohort rate; new weekly saves are not yet eligible
- `weekly.oldestUnresolved` is the oldest active, non-YouTube review candidate at least 14 days old, or `null`

## Reading position

### Look up a saved article

```http
GET /api/links/lookup?url=https%3A%2F%2Fexample.com%2Farticle
```

Returns `{"entry":{"id":"...","url":"https://example.com/article"}}`, or
`{"entry":null}` when the canonical URL is not saved or is soft archived.
Lookup uses the existing canonicalization rules (including protocol, tracking
parameters, and fragment handling) with exact, case-sensitive URL comparison.
Similar titles and fuzzy duplicate candidates are never used as identity.
URLs must be absolute HTTP/HTTPS, at most 2,048 characters, without credentials,
whitespace, or control characters.

### Read or save a position

```http
GET /api/links/:id/reading-position?url=https%3A%2F%2Fexample.com%2Farticle
PUT /api/links/:id/reading-position
Content-Type: application/json
```

PUT body:

```json
{
  "url": "https://example.com/article",
  "ratio": 0.5,
  "offset": -50,
  "anchor": "Chapter two",
  "scrollHeight": 2400
}
```

Both return `{"position":{...}}`; GET returns `{"position":null}` when no
valid position exists. A successful PUT adds server-generated `savedAt` in UTC
ISO format. Client timestamps do not set the save time. Only the documented
position fields are stored; unrelated fields are ignored.

- `ratio`: finite number from 0 to 1, relative to the current maximum scroll distance.
- `offset`: finite heading viewport offset from -100,000 to 100,000 pixels.
- `anchor`: plain heading text, at most 200 UTF-16 code units, without control
  characters. Empty text uses ratio fallback.
- `scrollHeight`: finite maximum scroll distance (`document height - viewport
  height`, clamped at zero), from 0 to 100,000,000 pixels. Used for layout-change feedback.
- All requests require authentication; read tokens can use GET, while PUT needs
  write scope. Responses use `Cache-Control: private, no-store`.
- Missing/soft-archived links return `404`; a different canonical link URL
  returns `409`; invalid fields return `400`. Unexpected failures use a generic
  error rather than exposing database details.
- PUT changes only `links.reading_position`. It does not change status,
  `updatedAt`, open counts, meaningful-review timestamps, or useful-review time.
  The latest successful explicit position write wins.
- General link create/update does not accept position writes. Editing to a
  different canonical URL clears the position atomically. Soft archive retains
  it, restore makes it available again, and hard delete removes it with the link.

The extension operates on the current article tab, independently of the capture
URL field. It injects only after Save position or Resume reading is clicked,
uses the isolated top frame, and checks the live URL before scrolling. Unique
heading matches restore the viewport offset; missing/ambiguous headings use the
saved ratio. Changed geometry reports approximate feedback. Browser/internal
pages, extension stores, PDFs, and recognized embedded readers/feeds are
unsupported. Arbitrary virtualized feeds cannot be detected reliably and are
outside the supported article flow.

### Backup compatibility

Complete JSON backups embed nullable `readingPosition` on each link.
Import and preview validate its fields, URL identity, and exact UTC ISO save time.
Invalid positions make that import row invalid; missing/null fields support older
backups. CSV and Markdown are portable notes exports and omit reading positions.

## Title metadata

### Fetch title metadata for a URL

```http
GET /api/fetch-title?url=https%3A%2F%2Fexample.com%2Farticle
```

Success response:

```json
{
  "title": "Example Article",
  "url": "https://example.com/article",
  "host": "example.com",
  "needsManualEntry": false
}
```

Behavior:

- URL is normalized first
- private and reserved network targets are blocked
- title fetching may use oEmbed for supported providers
- if title extraction fails cleanly, `needsManualEntry` may be `true`

Extension clipboard capture reuses this authenticated endpoint for a missing
title, then sends the validated copied URL to `POST /api/links` with the popup's
tags, notes, and `saveReason`. Metadata failure or a five-second client timeout
uses the copied URL as title. Metadata does not replace capture URL identity.
No new endpoint or database field is needed for clipboard capture.

Example fallback response:

```json
{
  "title": "",
  "url": "https://example.com/protected-page",
  "host": "example.com",
  "needsManualEntry": true
}
```

## Import and export

### Export all links

```http
GET /api/links/export
```

Returns a versioned downloadable JSON backup with `version`, `exportedAt`,
`links`, and `relationships` fields.

Notes:

- export includes all links, including soft-deleted ones, and manual relationships
- version 3 retains `saveReason` and nullable `readingPosition`; legacy records default to empty reason and null position
- version 3 includes each link's complete `history` array and reads links, relationships, and events in one repeatable-read transaction
- history events contain only validated ID, type, ISO timestamp, and compact metadata; no portable actor identity or undo snapshots
- response is sent as `application/json`

### Export portable Markdown or CSV

```http
GET /api/links/export.md
GET /api/links/export.csv
```

Both exports include all links. Markdown adds a separate `Why I saved this`
section for links with a save reason. CSV keeps its existing five columns and
does not include save reasons; use JSON for a complete backup.

Markdown also includes tags. Its default, unscoped endpoint still exports the
complete library, including archived links. Browse offers two scoped downloads:

```http
GET /api/links/export.md?scope=selected&ids=first-id,second-id
GET /api/links/export.md?scope=filtered&tag=study&status=saved&youtube=exclude
```

- `selected`: 1-200 distinct IDs, returned in request order; explicitly selected
  archived records are allowed. A missing link returns `404` with no partial file.
- `ids` accepts comma-separated IDs or a URL-encoded JSON array of strings when
  an imported ID contains a comma or begins with a JSON delimiter. Each ID must
  be nonempty, at most 36 UTF-16 code units, without edge whitespace/control characters.
- `filtered`: every matching link across all pages, capped at 5,000. Above the
  cap, the endpoint returns `400` and asks for narrower filters, rather than truncating.
- Supported filters are `q` or `search`, `tag`, `status`, `sort`, `order`,
  `includeDeleted`, `updatedAfter`, `remindBefore`, `staleBefore`, `ageBefore`,
  `neverOpened`, and `youtube`. Use the existing list filter values; supplied
  booleans must be `true` or `false` and dates must be valid ISO datetimes with
  seconds and a timezone. Pagination parameters are rejected.
- Selected requests accept only `scope` and `ids`. Filtered requests reject IDs,
  unknown/repeated parameters, unsupported enum values, and simultaneous `q`/`search`.
- `ids` without a scope is rejected. No scope retains legacy full-export behavior.
- Browse's review and useful-revisit views export their remaining visible session
  IDs using selected scope, so a refreshed queue cannot add unseen replacements.
- Successful downloads use private/no-store headers and report the exact exported
  count in `X-Link-Count`. Filenames are `links-selected.md` or `links-filtered.md`.
- GET keeps scoped Markdown exports available to read-scoped API tokens.

CSV retains its five-column contract and full-export behavior:

```csv
title,url,notes,status,date
```

CSV follows RFC 4180 quoting and uses UTF-8 with a BOM. To prevent spreadsheet
formula execution, exported titles and notes beginning with `=`, `+`, `-`, or
`@` receive a leading apostrophe. CSV import reverses this protection.

### Preview an import

```http
POST /api/links/import-preview
Content-Type: application/json
```

Request body uses `format` (`json`, `csv`, `bookmarks`, or `batch`) and `data`.
File formats send text. JSON accepts either a legacy link array or a versioned
backup object with `links` and `relationships` arrays.

```json
{
  "format": "json",
  "data": "[{\"url\":\"https://example.com\"}]"
}
```

The response contains `summary`, up to 100 display `rows`, every normalized
`readyLinks` entry, and relationship preview details for JSON backups. Preview
performs no writes. It identifies invalid rows, repeated URLs in the import,
and URLs already present in the database.

### Legacy direct CSV import

```http
POST /api/links/import-csv
Content-Type: application/json
```

Request body:

```json
{
  "csv": "title,url,notes,status,date\r\nExample,https://example.com,Review,saved,2026-09-11"
}
```

Rules:

- header order must be exactly `title,url,notes,status,date`
- maximum import size is 5,000 data rows
- URLs must use HTTP or HTTPS
- status must be `saved`, `unread`, `useful`, or `archived`
- date must use `YYYY-MM-DD`
- duplicates and invalid database entries are reported and skipped
- the editor uses the preview endpoint; this direct endpoint remains for API compatibility
- JSON remains the complete link-record backup because CSV excludes tags, reminders, pin state, and timestamps

### Import links from JSON payload

```http
POST /api/links/import
Content-Type: application/json
```

Request body:

```json
{
  "links": [
    {
      "url": "https://example.com/article",
      "title": "Example Article",
      "date": "2026-04-14",
      "status": "saved",
      "tags": [],
      "notes": "Review during the next research session."
    }
  ]
}
```

#### Batch text import format

The editor page also supports pasting plain text lines in this format:

```
https://example.com | Example Site
https://another.com | Another Site
```

Each line is `url | title`. The title is optional — if omitted the backend fetches it or falls back to the URL.

Success response:

```json
{
  "ok": true,
  "imported": 1,
  "duplicates": 0,
  "invalid": 0,
  "total": 43
}
```

Rules:

- maximum import batch size is `5000`
- duplicates are skipped
- invalid items are skipped
- `total` is the active-link count after import
- exported JSON link records restore IDs, tags, status, pin state, reminders,
  notes, save reasons, open history, and revisit timestamps
- version 2 JSON backups restore manual related-link connections after links
- version 3 also restores validated per-link `history` within the link's insertion transaction, then appends an Imported event
- legacy arrays/version 2 remain accepted; omitted history means no fabricated past timeline
- malformed history makes its link invalid; event-ID conflicts roll back that link and count invalid rather than overwriting an existing event
- duplicate links skip their accompanying history; restore never replaces an existing link or timeline
- restored events retain IDs and timestamps but receive the current importer's internal actor ID; incoming actor IDs and note/reason snapshots are rejected
- the editor sends ready links in batches of 100, so large imports expose
  progress and may be partially complete if a later batch fails

### Legacy direct browser bookmarks HTML import

```http
POST /api/links/import-bookmarks
Content-Type: application/json
```

Request body:

```json
{
  "html": "<DL><p>...browser bookmarks html...</DL>"
}
```

Success response:

```json
{
  "ok": true,
  "imported": 10,
  "total": 53,
  "parsed": 14
}
```

Behavior:

- parses `<a href="...">` entries from bookmark HTML
- the editor uses the preview endpoint; this direct endpoint remains for API compatibility
- only `http` and `https` links are imported
- missing or invalid links are skipped
- imported bookmark items default to `status: saved`

## Duplicate scan

### Find likely duplicate pairs across the library

```http
GET /api/links/scan-duplicates
```

Behavior:

- scans up to 2,000 non-deleted links
- compares titles (or URLs when a title is empty) only within the same host
- returns pairs with Jaro-Winkler similarity of `0.75` or higher, highest first

Success response:

```json
{
  "pairs": [
    {
      "a": { "id": "id-1", "url": "https://example.com/a", "title": "Example guide" },
      "b": { "id": "id-2", "url": "https://example.com/b", "title": "Example guide v2" },
      "similarity": 0.94
    }
  ],
  "total": 1
}
```

## API tokens

Scoped tokens for shortcuts, the browser extension, and scripts. Send them as
`Authorization: Bearer <token>`. Read-scoped tokens receive `403` on
`POST`, `PUT`, `PATCH`, and `DELETE`.

### List tokens

```http
GET /api/tokens
```

```json
{
  "tokens": [
    {
      "id": "token-id",
      "name": "iPhone Shortcut",
      "scope": "write",
      "createdAt": "2026-10-05T00:00:00.000Z",
      "lastUsedAt": null,
      "expiresAt": null,
      "revokedAt": null
    }
  ]
}
```

The raw token value is never returned after creation.

### Create a token

```http
POST /api/tokens
Content-Type: application/json
```

```json
{
  "name": "iPhone Shortcut",
  "scope": "write",
  "expiresAt": "2027-01-01T00:00:00.000Z"
}
```

- `name` is required, 100 characters max
- `scope` is `read` or `write` (default `write`)
- `expiresAt` is optional

Response `201`:

```json
{ "ok": true, "token": "raw-token-shown-once", "name": "iPhone Shortcut", "scope": "write" }
```

### Revoke a token

```http
DELETE /api/tokens/:id
```

Returns `{ "ok": true }`, or `404` when the token is missing or already revoked.

## Health check

```http
GET /api/health
```

Public. Returns `{ "ok": true }` without touching the database.

## Common errors

Example error response:

```json
{
  "error": "Link not found"
}
```

Common status codes:

- `200` success
- `201` created
- `400` bad request or validation error
- `401` authentication required or invalid credentials
- `404` resource not found
- `409` duplicate or conflicting resource
- `403` read-only API token used on a write endpoint
- `429` too many login attempts
- `500` internal server error

## Validation rules and behavior notes

### URL rules

- URL must be absolute
- only `http` and `https` are supported for outbound title and health checks
- some tracking and auth-related query params are stripped during normalization
- URL fragments are removed

### Tag rules

- tags are normalized into unique trimmed values
- max tag count is `20`
- max tag length is `50`

### Title rules

- max title length is `300`
- if no title is provided, the normalized URL is used

### Date rules

- `date` must use `YYYY-MM-DD`

## HTML page routes

These are not JSON API endpoints, but useful to know for client behavior:

- `/` → home page
- `/browse.html`
- `/editor.html`
- `/archive.html`
- `/settings.html`
- `/login.html`
- `/offline.html`
- `/logout` → clears session and redirects to login

Protected pages require authentication and are served from the private `views/`
directory. Login also routes through Node so security headers apply. Only the
offline fallback remains public HTML.

### iOS Share Sheet / Shortcuts

The editor page accepts pre-filled query params for use with iOS Shortcuts or any external tool:

```
/editor.html?url=<encoded-url>&title=<encoded-title>
```

Both params are optional. If `url` is provided without `title`, the app will attempt to fetch the title automatically.

## Versioning note

The app currently serves both `/api/...` and `/api/v1/...` routes with the same behavior. There is no separate v1-only logic yet.
