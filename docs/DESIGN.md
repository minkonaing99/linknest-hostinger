# DESIGN - UI/UX Design Brief

Last updated: 2026-10-06 (v3.2)

Normative source: [BRAND.md](BRAND.md) (tokens, components, do's and don'ts) and
the visual specimen [BRAND.html](BRAND.html). Product principles live in [PRODUCT.md](PRODUCT.md).
If this summary conflicts with BRAND.md, BRAND.md is correct.

## Design goals

Calm, focused, familiar, fast, trustworthy. The north star is "The Quiet Inbox": a
lightweight native-feeling utility that puts the next useful decision first.

Anti-references: statistics-first dashboards, gamified productivity tools,
AI-heavy knowledge systems, dense bookmark managers.

## Devices + breakpoints

Mobile-first and fully usable on desktop. Installable PWA with safe-area insets.
Breakpoints in use: 1024, 900, 768, 720, 600, 560, 480, 400 px. Reuse the
breakpoint that already governs a component. Shell max width is 980 px (920 px for the narrow shell).
Touch targets are at least 44 x 44 px.

## Color system

| Role | Web | Extension (OKLCH green) |
| --- | --- | --- |
| Canvas | `#F2F2F7` | `oklch(96% .012 155)` |
| Surface | `rgba(255,255,255,0.86)` | panel `oklch(99% .006 155)` |
| Muted surface | `rgba(255,255,255,0.68)` | field `oklch(97.5% .008 155)` |
| Border | `rgba(60,60,67,0.18)` | |
| Text / muted | `#111111` / `#6E6E73` | `oklch(24% .012 155)` / `oklch(48% .012 155)` |
| Primary / accent | `#007AFF` (soft `rgba(0,122,255,0.14)`) | `oklch(54% .13 155)`, hover `oklch(49% .13 155)` |
| Success | `#1F9C55` | |
| Warning | `#B7791F` | |
| Error / danger | `#D64045` | |
| Info | accent blue | |

App icons use forest green on cream (`public/img/`, `extension/icons/`). Never
show status by color alone.

## Typography

One system font stack for everything: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif`. No webfonts. Base size 16 px.

| Role | Size / weight / line height |
| --- | --- |
| h1 page title | 32 / 700 / 1.05, -0.04em |
| h2 login title | 24 / 700 / 1.08 |
| h3 dialog title | 20 / 700 |
| h4 section title | 18 / 700 / 1.2 |
| h5 brand kicker | 14 / 700 / 1.2 |
| Control | 16 / 600 (buttons) |
| Body: row title | 14 / 600 / 1.3 |
| Body: supporting | 13 / 400 / 1.4 |
| Label | 12 / 600 |
| Caption / metadata | 11 / 400 / 1.3 |

Use sentence case. Action labels start with a verb ("Add link", "Archive").

## Spacing

Base 4 px. Scale: 4, 6, 8, 10, 12, 14, 16, 20, 24. Main gap 12 px, airy stack 16 px,
surface padding 14 px (12 px compact).
Radii: control 13, row 14, nav 15, nested 18, surface 20, dialog 22, large card 24, pill 999.

## Component inventory

| Component | Where |
| --- | --- |
| Segmented nav (3 items, badge) | all protected pages |
| Surface / grouped list / nested surface | Home, Browse, Settings |
| Link row (status dot, title, metadata, trailing actions, favicon) | Browse, Archive, Home recent |
| YouTube media row (16:9 thumbnail) + action sheet | Browse YouTube tab |
| Review card + completion screen | Home |
| Quick-add form with expandable save reason | Home |
| Link form (editor) + History + Related + Suggestions panels | Editor |
| Duplicate resolution dialog | Home, Editor |
| Command search dialog / bottom sheet (620 px) | global (`shared.js`) |
| Bulk action bar + export | Browse |
| Toast with Undo (15 s, pauses on hover/focus) | global (`undo.js`) |
| Import preview table | Editor import |
| Token form + list, offline library controls | Settings |
| Offline library list + status filter | `offline-library.html` |
| Extension popup + settings | `extension/` |
| Buttons: primary, small, ghost, danger | everywhere |
| Fields: 40 px min height, 13 px radius, 4 px soft-blue focus ring | everywhere |

## Interaction patterns

- Transitions take 120-250 ms and touch only opacity, color, shadow, and transform. No layout animation.
- Hover and focus states are always visible. Status dot cycles status on click.
- Skeleton rows reserve height while loading. Offline capture shows queued and sync state.
- Toasts use `role="status"` / `aria-live`. Undo toast lives 15 s, bounded by the 10 min server expiry.
- Review has keyboard keys (Left archive, Right useful, Up snooze, `N` note, `O` open)
  and swipe gestures. Visible buttons always remain.
- Menus attach to their row. Dialogs need a title, focus management, and Escape where safe.

## Accessibility

WCAG 2.1 AA minimum. Semantic HTML before ARIA. Visible focus everywhere and
full keyboard navigation. Status needs text, not only color. Honor
`prefers-reduced-motion` (disable shimmer and nonessential transitions). Responsive phone layouts.

## Icons

No icon library and no SVG icons. Controls use text labels, CSS shapes (status dots), favicons, and PNG brand assets. Logo mark: interlocking
chain-link on a cream rounded square (`public/img/logo-mark.png`, `logo-source.png`).

## Dark mode

Not planned. No `prefers-color-scheme` styles exist. Add only if real use shows a need.

## References

- [BRAND.md](BRAND.md), [BRAND.html](BRAND.html)
- Figma: TBD (none)
