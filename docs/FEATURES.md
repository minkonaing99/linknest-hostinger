# Feature Status

Current Link Nest capabilities. See [FUTURE_PLAN.md](FUTURE_PLAN.md) for work
that has not shipped.

## Done

### Link Library

- Capture a link using only its URL and fetch its title on the server.
- Edit title, URL, status, tags, reminder, and plain-text notes.
- Search titles, URLs, tags, and notes.
- Filter and sort the library.
- Mark links unread, saved, useful, favorite, archived, or deleted.
- Restore archived links.
- Normalize safe HTTP and HTTPS variants, mobile and AMP hosts, trailing
  slashes, query order, and common tracking parameters.
- Show favicons and YouTube thumbnails when available.
- Keep YouTube links in a dedicated tab outside the normal Browse list.

### Review Workflow

- Build a five-link queue from due reminders and oldest eligible links.
- Require a meaningful decision before removing a link from the queue.
- Add or edit a note, mark useful, snooze, archive, or open during review.
- Snooze for one week or until a custom date.
- Show review position, such as `2 of 5`, and a completion screen.
- Support keyboard controls: Left archives, Right marks useful, Up snoozes,
  `N` edits the note, and `O` opens the link.
- Support touch and pen gestures: left archives, right marks useful, and up from
  the status handle snoozes.
- Keep visible controls available for accessibility and discovery.
- Filter unresolved links older than 90 days and review, archive, or keep them
  for another 90 days without changing their meaningful status.

### Meaningful Revisit Measurement

- Record the first meaningful action in `firstMeaningfulAt`.
- Count note changes, useful decisions, and soft archives as meaningful.
- Do not count opening or snoozing as meaningful.
- Measure eligible links only after they become at least 14 days old.
- Build a 30-day baseline before comparing revisit performance.
- Show a homepage weekly summary with saved, reviewed, useful, revisit rate,
  and oldest unresolved values.

### Capture and Duplicate Handling

- Quick-add links from the homepage.
- Show five recent links for capture confirmation and correction.
- Detect exact and possible duplicates using canonical URLs, hosts, and similar
  titles.
- Offer Open existing, Merge note, Restore archived, and Save separately.
- Never merge, restore, or overwrite without user confirmation.
- Queue captures in IndexedDB while offline and sync when connectivity returns.
- Show pending, saved, failed, and duplicate-resolution states.

### Search and Portability

- Open command search with `/`, `Cmd+K`, or `Ctrl+K`.
- Search links and run common actions without leaving the current page.
- Export the complete library as JSON.
- Export portable Markdown and CSV files.
- Import JSON and CSV files.
- Include title, URL, note, status, and saved date in portable exports.

### YouTube Workflow

- Show YouTube videos in a dedicated responsive media list.
- Preserve 16:9 thumbnails and show when each video was saved.
- Ask before opening a video.
- Offer Open, Open and archive, Share, and Cancel.
- Use native sharing when available and copy the URL as fallback.
- Archive without refreshing the page.

### PWA and Browser Extension

- Install Link Nest as a standalone PWA.
- Cache the application shell and show an offline page.
- Support safe-area insets, phone layouts, tablet layouts, and reduced motion.
- Save the current browser tab through the browser extension.
- Capture an optional plain-text note from the extension popup.
- Configure extension server URL and write-scoped API token.

### Authentication, API, and Quality

- Authenticate the private single-user web application with sessions.
- Create scoped API tokens for shortcuts, extensions, and scripts.
- Validate and normalize external URLs.
- Protect server-side metadata fetching against SSRF.
- Document REST endpoints in [API.md](API.md).
- Test authentication, links, review, command search, offline capture, homepage,
  export, duplicate handling, and YouTube behavior.

## Next

- Complete the iPhone Shortcut setup guide described in
  [FUTURE_PLAN.md](FUTURE_PLAN.md).

## Deferred

- AI summaries and automatic tagging.
- Collections and folders.
- Rich-text notes.
- External notifications.
- Native iOS application.
- Collaboration and multi-user support.
- Gamification and recommendation scoring.
- Richer metadata beyond current support.
- Saved views.
- Import preview, background progress, and detailed duplicate summaries.
