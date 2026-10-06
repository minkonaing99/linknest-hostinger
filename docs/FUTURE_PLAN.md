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

Save reasons, selective Markdown exports, extension clipboard capture, reading
positions, related-link suggestions, review history, toast Undo, and offline library access are implemented in source. Existing databases require the manual
SQL in [new-changes-db.sql](new-changes-db.sql) before deployment; see
[release_notes.md](release_notes.md).

All eight requested features are now implemented.
[V3.2_IMPLEMENTATION_PLAN.md](V3.2_IMPLEMENTATION_PLAN.md) retains acceptance
criteria and rollout requirements. Complete deployment verification before
expanding the feature list.

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
