# PRD — Link Nest

## Problem Statement

Browser bookmarks are siloed per device and browser. There is no lightweight self-hosted tool for saving, tagging, and rediscovering links across devices without trusting a third party with your reading history.

## Goals + Success Metrics

| Goal | Metric |
|------|--------|
| Save a link in < 5 seconds | From browser extension click to saved confirmation |
| Find a previously saved link in < 10 seconds | Search by title, URL, or tag |
| Zero data leakage | All data stays on user's server |
| Works on mobile | Full functionality at 375px viewport |

## Target Users

**Primary: The Solo Power User** — a developer or researcher who reads heavily, tags obsessively, and wants full control over their data. Runs their own VPS or shared hosting. Single-user by design.

**Secondary: Small team / household** — two or three people sharing a single instance via separate accounts (future).

## Feature List

### Core (MVP — shipped)

- Save links with auto-fetched title
- Status workflow: `unread` → `saved` → `useful` → `archived`
- Tag links with freeform tags
- Pin links to top
- Browse + search + filter by status/tag/host/date
- Edit title, tags, date, status, pin
- Delete (soft) with archive page for recovery
- Import/export JSON
- Cookie session auth (web UI)
- Bearer JWT + refresh token auth (API clients)
- Scoped long-lived API tokens (browser extension, iOS)
- Browser extension (one-click save from any page)
- URL normalization (strips tracking params, canonical form)
- SSRF guard on title fetch
- Rate limiting on auth endpoints

### Extended (v2 candidates)

- Notes field on links
- Saved views / persistent filter presets
- Richer metadata: description, favicon, thumbnail, content type
- Protocol normalization (http → https dedup)
- Fuzzy duplicate detection by host + title similarity
- Merge/review UI for duplicates
- Remind-at scheduling with notification
- Multi-account / team sharing
- iOS Shortcut / Share Sheet integration
- Full-text search (title + notes)
- Public read-only link pages

### Out of Scope

- Social features (likes, comments, follows)
- Browser sync / cloud backup (user hosts their own)
- Bookmarklet (extension is better)
- Markdown rendering of notes (plain text only in v2)

## User Stories

- As a power user, I want to save a link from my browser in one click so that I don't lose it mid-research.
- As a power user, I want to filter by tag and status so that I can surface links relevant to my current project.
- As a power user, I want to export all my links as JSON so that I can migrate or back up without vendor lock-in.
- As a user on mobile, I want the browse page to be usable one-handed so that I can triage links on the go.
- As a developer, I want a scoped API token so that my iOS shortcut can save links without exposing my login credentials.

## Constraints

- Single Node.js process — no worker threads, no message queues
- Hostinger shared hosting — no persistent background processes, no cron
- MariaDB 11.8 on Hostinger — `tags` stored as `longtext` (not native JSON column); use `JSON_CONTAINS` / `JSON_TABLE`
- Three runtime deps only: `bcryptjs`, `dotenv`, `mysql2`
- No frontend framework, no build step
- No CDN or external asset delivery

## Open Questions / Assumptions

- Multi-user support: assumed single-user per instance for now; `users` table exists but no registration UI
- Remind-at: column exists in schema; notification delivery mechanism TBD
- PWA offline: `sw.js` + `manifest.json` present but offline experience is minimal
