# Future Plan

Link Nest should remain a personal knowledge inbox, not become a larger bookmark
warehouse. Product success means more eligible links receive a meaningful revisit,
not more links are stored.

See [FEATURES.md](FEATURES.md) for shipped capabilities.

## Product Rules

- Capture requires only a URL. The server fetches the title.
- Notes remain optional, plain text, and editable later.
- Review ends with a decision.
- Opening or snoozing does not count as a meaningful action.
- Keep the workflow private and single-user until real use proves otherwise.
- Prefer small improvements to the revisit loop over new infrastructure.

## Next

### iPhone Shortcut Setup Guide

- Document accepting a URL from the iOS share sheet.
- Document sending it to the authenticated Link Nest API.
- Use the server-fetched title without a second metadata form.
- Show a small native success or failure notification.
- Explain API-token creation without exposing token values in screenshots.

## Possible Later Improvements

These need evidence from real use before implementation.

### Manual Related Links

- Add an `Add related link` action to the editor.
- Search and select existing links rather than entering another raw URL.
- Show two or three related links below the note, with access to the full list.
- Allow removing a relationship without deleting either link.
- Treat relationships as symmetric and reject self-links and duplicate pairs.
- Do not add automatic suggestions, relationship types, graph views, or AI.
- Store relationships in a minimal join table added through
  `docs/change-db.sql` when implementation begins.

### Improved Import

- Preview an import before saving.
- Show progress for large files.
- Summarize invalid and duplicate rows.
- Preserve reliable JSON round trips without manual reshaping.

## Explicitly Deferred

- AI summaries and automatic tagging.
- Collections and folders.
- Rich-text notes.
- Email, push, or browser notifications.
- Native iOS application.
- Collaboration and multi-user support.
- Gamification.
- Recommendation scoring.
- Richer metadata beyond current title, favicon, and YouTube thumbnail support.
- Saved views beyond the focused review queue.

Move an item into `Next` only after observed use proves the need. Move it to
[FEATURES.md](FEATURES.md) only after implementation and verification ship.
