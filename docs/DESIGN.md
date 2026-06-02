# DESIGN — Link Nest

## Design Goals

**Fast, minimal, functional, readable, calm.**

No decorative chrome. Every pixel earns its place. Dense information without feeling crowded. Fast on slow connections and small screens.

## Target Devices + Breakpoints

- Mobile-first layout; primary use case is desktop browse + mobile save
- Breakpoints: 375px (phone), 768px (tablet), 1024px (desktop)
- Input font-size ≥ 16px on mobile (prevents iOS zoom on focus)

## Color System

Defined in `public/css/styles.css` `:root`:

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#f2f2f7` | Page background |
| `--surface` | `rgba(255,255,255,0.86)` | Cards, panels |
| `--surface-muted` | `rgba(255,255,255,0.68)` | Secondary surfaces |
| `--border` | `rgba(60,60,67,0.18)` | Dividers, input borders |
| `--text` | `#111111` | Primary text |
| `--muted` | `#6e6e73` | Metadata, labels, placeholder |
| `--accent` | `#007aff` | Links, buttons, focus rings |
| `--accent-soft` | `rgba(0,122,255,0.14)` | Hover states, active backgrounds |
| `--success` | `#1f9c55` | Positive states (useful status) |
| `--warning` | `#b7791f` | Warn states (remind-at, stale) |
| `--danger` | `#d64045` | Delete actions, error states |
| `--radius` | `20px` | Card border radius |
| `--shadow` | `0 12px 30px rgba(17,17,17,0.07)` | Card elevation |

**Controls:**

| Token | Value |
|-------|-------|
| `--control-font-size` | `16px` (prevents iOS zoom) |
| `--control-radius` | `13px` |
| `--control-height` | `40px` |
| `--control-height-small` | `36px` |
| `--control-padding-x` | `12px` |
| `--control-border-width` | `1px` |

Dark mode: not planned.

## Typography

- System font stack — no web font downloads
- Heading: system-ui / -apple-system
- Body: same stack, smaller size
- Monospace: for URLs in editor
- Scale: h1, h2, body, small/caption, label

## Spacing System

- Base unit: 4px or 8px (infer from CSS)
- Components use consistent multiples
- Card padding, row padding, input padding all aligned to grid

## Component Inventory

| Component | Pages | Notes |
|-----------|-------|-------|
| Link card / row | browse, archive | Title, host, tags, status badge, actions |
| Tag pill | browse, editor, archive | Clickable filter in browse |
| Status badge | browse, archive | Color-coded status label |
| Search + filter bar | browse, archive | Query, status filter, tag filter |
| Editor form | editor | URL, title, tags, date, status, pin, remind |
| Confirm toast | all | Replace alert/confirm — non-blocking |
| Empty state | browse, archive | When no results |
| Settings page | settings | Admin credentials, API tokens |
| API token list | settings | Create, name, scope, revoke |
| Login form | login | Username + password |
| Sort controls | browse | Date, title, opened; asc/desc |
| Pagination / infinite scroll | browse | TBD |
| Pin indicator | browse | Visual pin icon |

## Interaction Patterns

- No page reloads on CRUD actions — fetch API + DOM update
- Toast notifications replace `alert()` / `confirm()` — non-blocking, auto-dismiss
- Delete shows "Moved to archive" feedback (soft delete UX)
- Tag click in browse adds tag to active filter
- URL paste in editor triggers auto-title fetch
- Status change is instant (optimistic update pattern not required — small dataset)
- Empty search query shows all results

## Accessibility

- WCAG AA minimum
- Keyboard navigation: all interactive elements reachable via Tab
- Focus visible on all interactive elements
- `aria-label` on icon-only buttons
- Form labels associated via `for`/`id`
- Color not the only status indicator (text labels alongside color)

## Icon Set

No icon library. SVG inline or Unicode symbols where needed. Minimizes HTTP requests.

## Dark Mode

Not planned.

## Design References

No Figma. Source of truth is `public/*.html` + `public/css/styles.css`.
