# Link Nest · v1.3.0

Last updated: 2026-06-01

Link Nest is a private website for saving, organizing, and revisiting useful links in one clean library.

It is designed for people who want a calmer alternative to messy browser bookmarks, scattered notes, or saving links across multiple apps. The project includes a built-in web interface and a JSON API, so the same database can later be used by a mobile app such as iOS.

## What The Website Does

Link Nest helps you collect links and keep them easy to find later.

You can:

- save links with a title, status, tags, and date
- auto-fetch the page title from a pasted URL
- browse saved links in a cleaner library view
- search, filter, sort, pin, edit, restore, and soft-delete links
- tap the status dot to instantly cycle a link's status
- filter by popular tags using one-tap chips above the library
- see your unread count at a glance in the nav bar
- bulk-select links and change their status or delete them at once
- set a reminder date on any link to revisit it later
- surface due reminders and stale unread links with one-tap filters
- export data as JSON
- use the same backend for both the website and future mobile clients

## Main Pages

### Home

The home page gives a compact overview of your library. It includes summary cards, recent items, and a quick-add input for saving a link fast.

### Browse

The browse page is the main library view. It is built for scanning links quickly, filtering by status or tag, and managing items without leaving the page.

- **Inline status cycling** — click the status dot on any row to cycle through saved, unread, and useful without opening an editor
- **Tag filter chips** — the most-used tags appear as tappable chips above the list for instant one-tap filtering
- **Unread badge** — the Browse nav link shows a live count of unread links across all pages
- **Bulk actions** — select multiple links and delete or change their status in one action
- **Due to revisit** — one-tap filter that shows links whose reminder date has passed
- **Stale unread (30d)** — one-tap filter that shows unread links not opened in the last 30 days

### Add Link

The add-link page is used for creating or updating saved links with a more complete form. Includes a "Remind me" date field for scheduling a revisit.

### Login

The login page protects the site behind private authentication and keeps the library limited to approved users.

## Core Features

### Private Authentication

The website supports browser login using secure session cookies. The backend also supports token-based authentication for mobile or external clients.

### Link Organization

Each saved item is structured for long-term use instead of simple bookmarking. Links can be tagged, pinned, marked by status, and filtered later.

### Auto Title Fetching

When a URL is added, the app can fetch the page title automatically to reduce manual typing and keep entries consistent.

### Search And Filtering

The library supports search, filtering, sorting, and sync-friendly queries such as `updatedAfter`, `remindBefore`, `staleBefore`, and `neverOpened`.

### Revisit And Retention

Each link tracks when it was last opened and how many times. A reminder date field lets you schedule a link for future review. Browse surfaces due reminders and stale unread links without any manual curation.

### Soft Delete And Restore

Links are soft-deleted by default, which makes it easier to support recovery and future app sync behavior.

### API-Ready Backend

The backend is structured so the website and an iOS app can use the same database and the same API.

## Tech Stack

Link Nest is built with:

- Node.js
- a plain HTTP server
- MySQL via `mysql2`
- vanilla HTML, CSS, and JavaScript on the frontend
- `bcryptjs` for password hashing
- JWT access tokens plus refresh tokens for app clients

## Data Model Notes

Links are stored in MySQL and include sync-friendly timestamps.

Key fields include:

- `url`
- `title`
- `tags`
- `status` (`unread`, `saved`, `useful`, `archived`)
- `pinned`
- `createdAt`
- `updatedAt`
- `deletedAt`
- `lastOpenedAt`
- `openedCount`
- `remindAt`

## Authentication Modes

### Browser Sessions

The website uses cookie-based login for the browser UI.

### Mobile Or External Clients

The API also supports bearer access tokens with refresh tokens, which makes it suitable for an iOS app or other clients using the same backend.

## API Overview

The project exposes private JSON API routes under:

- `/api/...`
- `/api/v1/...`

Main API groups:

- login, logout, and identity
- token and refresh-token auth
- link listing with pagination and filters
- create, update, soft delete, restore, and hard delete
- open tracking (`POST /api/links/:id/opened`)
- bulk status update (`PATCH /api/links/bulk`)
- tag usage counts (`GET /api/tags`)
- title fetching
- import and export

Full API details are documented in [docs/API.md](./docs/API.md).

## Product Direction

Link Nest is intended to be more than a simple bookmark page. The long-term direction is a personal link library with:

- a private web interface
- mobile app support
- shared API access
- sync-friendly data handling

That makes the current website a usable product on its own while also serving as the backend foundation for future iOS development.
