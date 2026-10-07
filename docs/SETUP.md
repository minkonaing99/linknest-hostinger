# SETUP - Setup + Testing + Changelog

Last updated: 2026-10-06

## Setup

### Prerequisites

- Node.js >= 20 (`package.json` engines; `node --test` is built in)
- MySQL 8 or MariaDB 11.x (production: Hostinger MariaDB 11.8)
- Python 3 (only for `scripts/import_links.py`)
- HTTPS or `localhost` for the service worker and offline features

### Install

```bash
git clone <repo-url> linknest && cd linknest
npm install
cp .env.example .env            # then fill in values, see below
```

Create the database. For a new database, run [full-db.sql](full-db.sql) once.
For an existing database, apply only the missing statements from [new-changes-db.sql](new-changes-db.sql).
Do it manually in phpMyAdmin or the `mysql` CLI. The app never runs migrations.

```bash
mysql -u <user> -p <db_name> < docs/full-db.sql
npm start                       # http://localhost:3080 (or PORT)
```

On first start the server creates the admin user from `LINKNEST_ADMIN_USERNAME` /
`LINKNEST_ADMIN_PASSWORD` if it does not exist.

### Environment variables

| Key | Required | Default | Description |
| --- | --- | --- | --- |
| `DB_HOST` | no | `localhost` | MySQL host (Hostinger Node.js: `127.0.0.1`; `localhost` can resolve to IPv6) |
| `DB_PORT` | no | `3306` | MySQL port |
| `DB_NAME` | yes | - | database name |
| `DB_USER` | yes | - | database user |
| `DB_PASSWORD` | yes | - | database password |
| `PORT` | no | `3080` | HTTP port (`.env.example` uses `3090`) |
| `JWT_SECRET` | yes | - | at least 32 chars; signs access tokens |
| `ACCESS_TOKEN_TTL_MINUTES` | no | `15` | bearer access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | no | `JWT_TTL_DAYS` or `30` | refresh token lifetime |
| `JWT_TTL_DAYS` | no | `30` | legacy fallback for refresh TTL |
| `AUTH_COOKIE_NAME` | no | `linknest_session` | session cookie name |
| `AUTH_SESSION_TTL_DAYS` | no | `30` | web session lifetime |
| `COOKIE_SECURE` | no | `true` unless `NODE_ENV=development` | set `false` only for local HTTP |
| `NODE_ENV` | no | - | `development` relaxes the cookie `Secure` default |
| `LINKNEST_ADMIN_USERNAME` | first run | - | admin account to seed |
| `LINKNEST_ADMIN_PASSWORD` | first run | - | admin password to seed |
| `TRUSTED_PROXY` | no | `false` | trust `X-Forwarded-For` for the login rate limit (only behind a proxy) |
| `CORS_ORIGIN` | no | empty | allowed origin for the extension's API calls (`*` allowed) |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

### Run locally

```bash
COOKIE_SECURE=false npm start
```

Open `http://localhost:3080`. Load the extension unpacked from `extension/`, then
set the server URL and a write-scoped token (Settings > API tokens).

Scripts:
- `node scripts/renormalize_urls.js` - read-only audit of URLs against current normalization rules
- `python3 scripts/import_links.py --base-url <url> --username <u> --password <p> <export.json>` - import a JSON export through the web API

### Common errors

| Error | Fix |
| --- | --- |
| `Missing database credentials...` | set `DB_USER` and `DB_NAME` (and the password) in `.env` |
| `Missing JWT_SECRET` / `must be at least 32 characters` | set a long `JWT_SECRET` |
| Login works but the cookie is not kept on HTTP | `COOKIE_SECURE=false` for local HTTP only |
| `Unknown column 'revision'` / `save_reason` / missing `link_events` | apply the missing SQL from [new-changes-db.sql](new-changes-db.sql) |
| Extension gets CORS errors | set `CORS_ORIGIN` and use a Bearer API token |
| Offline features do nothing | serve over HTTPS or localhost. Hard-reload to update the service worker |
| `429` on login | wait out the 15-minute lockout |

## Testing

- **Framework:** Node built-in `node:test` + `node:assert`. No external test deps.
- **Location:** `test/` (49 files), including `test/routes/`.
- **Coverage target:** 80%+ (v3.2: 90.50% lines, 86.85% branches, 91.38% functions).
- **Types:** unit (domain modules with a mocked `lib/db.js`), integration (route
  handlers with fake `req`/`res`, transaction mocks), UI/DOM (page scripts loaded
  with stub DOM, `vm` for the service worker). E2E: none automated. Real-browser
  smoke is manual and listed per release in [release_notes.md](release_notes.md).
- **Workflow:** TDD. RED (failing test), GREEN (minimal code), REFACTOR.

```bash
npm test                                         # all tests
node --test test/links.test.js                   # one file
node --test --experimental-test-coverage         # coverage report
```

### Writing tests

- File name `test/<area>.test.js`. Use `describe` / `it` from `node:test`.
- To mock the database, inject the mock into `require.cache` for `lib/db.js` **before**
  requiring the module under test (see `test/links.test.js`, queue-based `query` mock).
- Routes: call `handle(req, res, new URL(...))` with minimal fake objects and assert
  on the status and JSON body.
- Frontend: read the page script with `fs`, run it against a small DOM stub, and assert
  on rendered nodes and calls.
- Tests never touch production data. Use only mocks or a disposable database.

## Changelog

Format: [Keep a Changelog](https://keepachangelog.com). The detailed per-feature
history, with deployment and validation notes, lives in [release_notes.md](release_notes.md).

Current version: **v3.2** (`package.json` still says `0.2.0`, see [PLAN.md](PLAN.md)).

### [3.2.0] - 2026-10-07

#### Deployed
- Production: https://link-nest.merxylab.com upgraded v3.0 -> v3.2 (Hostinger
  Node.js, Node 22, git `main` @ `deffc14`). Database `u580993728_newlinknest`
  backed up, then upgraded in place with idempotent `ADD COLUMN IF NOT EXISTS` /
  `CREATE TABLE IF NOT EXISTS` statements equivalent to `new-changes-db.sql`.
- Parallel fresh install at https://links.merxylab.com (database
  `u580993728_links`), pending removal by the owner.

#### Fixed
- `docs/full-db.sql` no longer fails on a fresh database: removed trailing
  `ALTER TABLE` statements that re-added columns already in `CREATE TABLE links`.

#### Added
- Save reasons, selective Markdown export, extension clipboard capture,
  reading position, related-link suggestions, review history, toast Undo,
  account-bound offline library.
- Project docs: PRD, TECH, SCHEMA, DESIGN, PLAN, SETUP.

#### Changed
- API.md documents `/api/health`, `/api/links/scan-duplicates`, and `/api/tokens`.
- README updated from v1.3.0 to v3.2.
- Manual DB change file renamed `docs/db-changes.sql` -> `docs/new-changes-db.sql`.
- Service worker cache `linknest-v35`; IndexedDB v2.

#### Removed
- API.md section for `GET /api/links/check-health`. The endpoint does not exist in code.
