# Features To Add

Pending work organized by priority. See ROADMAP.md for full context and reasoning.

## Done

### Backend tests (completed 2026-06-01)
- Auth session flow (`test/auth.test.js`)
- Token and refresh flow (`test/auth.test.js`)
- SSRF protection (`test/utils.ssrf.test.js`)
- Route-level auth tests (`test/routes/auth.test.js`)
- URL normalization, link sanitization, duplicate handling, query parsing (`test/utils.test.js`, `test/links.test.js`)
- 153 tests, 0 failures

### Better duplicate detection (in progress)
- Normalize tracking params: done (`normalizeUrl`)
- Normalize trailing slashes: done (`normalizeUrl`)
- Protocol normalization (http→https): pending
- Mobile/desktop host variants: pending
- Fuzzy duplicate suggestions by host + similar title: pending
- Merge/review UI for flagged duplicates: pending

### Scoped API tokens (in progress)
See `docs/IMPLEMENTATION_PLAN.md` Phase 3.

### Browser extension (in progress)
See `docs/IMPLEMENTATION_PLAN.md` Phase 4.

---

## P0 - Highest value next

### Notes on links
- Add `notes` field to the link model
- Show notes textarea in editor page
- Show note preview in browse rows
- Include notes in search
- Include notes in export and import

### Saved views
- Store persistent filter presets (status, tag, query, sort)
- Add UI for saving and loading views
- Examples: "Unread articles", "Security links", "Videos to watch"

### Better duplicate detection
(moved to in-progress above)

## P1 - Strong next phase

### Richer metadata capture
- Description
- Favicon
- Site name
- Thumbnail when available
- Detected content type (article, video, tweet, docs)

### Backend tests
(completed — moved to Done above)

## P2 - Valuable later

### Collections or folders
- Complement tags with stronger named groupings
- Examples: backend, security, startup ideas, design references

### Activity history
Track per-link events:
- Created
- Updated
- Restored
- Opened
- Status changed

### Improved import
- Async background import with progress feedback
- Preview before committing import
- Duplicate summary after import
- JSON round-trip import without manual shaping

### Scoped API tokens
(moved to in-progress above)

## P3 - Optional later

### Browser extension
(moved to in-progress above)

### AI-assisted tagging and summarization
Auto-suggest tags, generate summaries. Only useful after notes exist manually.

### Multi-user support
Shared libraries, roles, permissions. Low priority unless collaboration becomes a real goal.

## Recommended starting point

**Notes on links** - biggest jump in usefulness, small scope, improves search and revisit quality.
