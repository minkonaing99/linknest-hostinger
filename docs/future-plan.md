# Future Plan

Link Nest should become a personal knowledge inbox, not a larger bookmark warehouse.
The product should optimize for the percentage of eligible links meaningfully
revisited, not the number of links stored.

This plan supersedes earlier feature priorities where they conflict with the core
revisit loop below.

## Product Rules

- Capture requires only a URL. The server fetches the title.
- Notes are optional, plain text, and added later during review.
- A review should end with a decision.
- Opening or snoozing a link does not count as a meaningful action.
- Keep the workflow private and single-user until real usage proves otherwise.

## Next Release

### Plain-Text Notes

- Add notes to links.
- Allow adding and editing notes during review.
- Show a short note preview in Browse.
- Include notes in search, import, and export.
- Never require a note during capture.

### Five-Link Review Queue

- Reuse the existing Browse rows and filters.
- Show five links per review session.
- Fill the queue with due reminders first.
- Fill remaining slots with the oldest saved or unread links that:
  - are at least 14 days old; and
  - have no meaningful action.
- Keep opened links in the queue until a meaningful action occurs.

This replaces the current 30-day stale-unread rule for the review workflow.

### Review Actions

- Open.
- Add or edit note.
- Mark useful.
- Snooze for one week.
- Snooze until a custom date.
- Archive using the existing soft-delete behavior.

Hard deletion is not part of review because deleted rows cannot remain in the
revisit metric without a full event-history system.

### Homepage

- Show a badge when review items are pending.
- Put due reminders first.
- Show the five-link review queue next.
- Show five recent links for capture confirmation and quick correction.
- Keep other statistics secondary.

### Revisit Measurement

- Add a nullable `firstMeaningfulAt` timestamp.
- Set it once, when the first meaningful action occurs.
- Meaningful actions are:
  - adding or editing a note;
  - marking a link useful; or
  - archiving through soft delete.
- Do not set it when a link is opened or snoozed.
- Measure links saved during the selected 30-day period that have become at
  least 14 days old.
- Show `Building baseline` during the first 30 days.
- Afterward, compare the current rate with the previous period.
- Target a 20 percentage-point improvement over the baseline.

### iPhone Shortcut

- Accept a URL from the iOS share sheet.
- Send it to the existing authenticated API.
- Let the server fetch the title.
- Show a small native success or failure notification.
- Do not show a second metadata form.

## Build Order

1. Plain-text notes.
2. Review queue and actions.
3. Meaningful-action measurement.
4. Homepage changes.
5. iPhone Shortcut setup documentation.

## Later Improvements

### Faster Review Controls

- Add keyboard controls to the review queue:
  - Left Arrow: archive.
  - Right Arrow: mark useful.
  - Up Arrow: snooze.
  - `N`: add or edit the note.
  - `O`: open the link.
- Add equivalent swipe gestures on touch devices:
  - Swipe left: archive.
  - Swipe right: mark useful.
  - Swipe up: snooze.
- Keep visible buttons available for accessibility and discoverability.

### Review Progress

- Show the current position and queue size, such as `2 of 5`.
- Show a completion screen after all five links receive a decision.
- Keep each review session finite and focused.

### Offline Capture Queue

- Allow the PWA to accept links while offline.
- Store pending captures locally without losing them.
- Sync queued links automatically after connectivity returns.
- Show clear pending, saved, and failed states.
- Keep conflict handling compatible with duplicate detection.

### Better Portable Export

- Keep JSON as the complete backup format.
- Add Markdown and CSV export options.
- Include title, URL, note, status, and saved date.
- Keep exported data portable to Obsidian, spreadsheets, and other tools.

### Command Search

- Open command search with `/` or `Cmd+K`.
- Search saved links without navigating away from the current page.
- Support common actions from search results, including open, add note,
  mark useful, snooze, and archive.
- Keep normal Browse search unchanged.

### In-App Weekly Summary

- Add one homepage card showing:
  - links saved;
  - links reviewed;
  - useful decisions;
  - revisit percentage; and
  - the oldest unresolved link.
- Do not add email, push, or browser notifications.

### Duplicate Merge

- When a duplicate is found, offer these explicit choices:
  - open the existing link;
  - merge the new note into the existing link;
  - restore the archived copy; or
  - save a separate copy.
- Never merge or overwrite data without user confirmation.

## Explicitly Deferred

- AI summaries and automatic tagging.
- Collections and folders.
- Full activity history.
- Rich-text notes.
- Email, push, or browser notifications.
- Native iOS app.
- Collaboration and multi-user support.
- Gamification.
- Recommendation scoring.
- Richer metadata capture.
- Saved views beyond the focused review queue.
