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

Implement these features one at a time, in this order:

### 1. Optional Useful Takeaway

- When a link without a note is marked useful, ask `What was useful?`.
- Save a non-empty answer in the existing note field.
- Allow Skip or Cancel without blocking the useful decision.
- Do not ask when the link already has a note.
- Cover review buttons, keyboard and swipe actions, status changes, and command search.

No database change is required.

### 2. PWA Share Target

- Register the installed PWA as a share target on supported Android and ChromeOS devices.
- Accept a shared title, text, and URL.
- Open the existing editor with the shared link prefilled.
- Keep the link editable before saving.
- Use the existing offline capture queue when the device is offline.
- Keep duplicate handling in the existing editor flow.

No database change is required. Sharing while logged out may require a later auth
return-path improvement if real use proves it necessary.

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
