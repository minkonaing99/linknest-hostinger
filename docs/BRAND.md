---
name: Link Nest
version: 1.0
status: normative
creative_north_star: The Quiet Inbox
colors:
  canvas: "#F2F2F7"
  surface: "#FFFFFFDB"
  surface_muted: "#FFFFFFAD"
  border: "#3C3C432E"
  text: "#111111"
  muted: "#6E6E73"
  accent: "#007AFF"
  accent_soft: "#007AFF24"
  success: "#1F9C55"
  warning: "#B7791F"
  danger: "#D64045"
typography:
  family: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif'
  base_size: 16px
radii:
  control: 13px
  row: 14px
  navigation: 15px
  nested_surface: 18px
  surface: 20px
  dialog: 22px
  large_card: 24px
  pill: 999px
---

# Link Nest Brand and Product Design System

This file is the normative visual and verbal guide for Link Nest. Future agents
must read [PRODUCT.md](PRODUCT.md) first, then this file, before changing UI.
[BRAND.html](BRAND.html) is the visual specimen. If the two disagree, this file
wins. Update both only after a visual change has shipped.

## Overview

### Creative north star: The Quiet Inbox

Link Nest is a private place where saved links wait for a useful decision. It
should feel like a calm native utility, not a content feed or productivity game.
Screens place the next action first, keep supporting information compact, and
leave enough space for quick scanning.

### Product promise

- Capture a link with almost no friction.
- Return when context is still useful.
- End review with a meaningful decision: note, useful, archive, or delete.
- Keep the user's library portable, private, and easy to correct.

### Personality

- Calm: restrained color, short copy, stable layouts.
- Focused: one primary task per surface or dialog.
- Familiar: native-looking controls and direct labels.
- Lightweight: no decorative dashboards, heavy illustration, or visual noise.
- Personal: useful to one person, without social or gamified pressure.

### Logo system

The mark is an interlocking link symbol. Its dark green form communicates saved
knowledge and continuity. Do not redraw, recolor, stretch, crop, outline, or add
a container behind the transparent mark.

| Use | Asset | Native size | Display rule |
| --- | --- | ---: | --- |
| Web header | `public/img/logo-mark.png` | 64 x 64 RGBA | 28 x 28 px |
| Login or large identity | `public/img/logo-mark.png` | 64 x 64 RGBA | 40 x 40 px |
| Apple touch icon | `public/img/apple-touch-icon.png` | 180 x 180 | Use as supplied |
| PWA icon | `public/img/icon-192.png` | 192 x 192 | Use as supplied |
| PWA large or maskable | `public/img/icon-512.png` | 512 x 512 | Use as supplied |
| Source artwork | `public/img/logo-source.png` | 1254 x 1254 | Production source only |
| Extension | `extension/icons/icon-{16,48,128}.png` | Named size | Use matching size |

The web header uses only the transparent mark. The cream rounded tile belongs to
installed-app, browser-extension, and operating-system icon contexts. Keep clear
space around the mark equal to at least one quarter of its displayed width. Do
not display the raster mark below 16 x 16 px.

### Brand architecture

Web product and extension currently use related but different accents:

- Web uses system blue for primary actions and focus.
- Logo and extension use a restrained green family.
- Semantic green means success in the web app.

Do not silently replace one palette with the other. A future unification is a
separate, deliberate redesign requiring updates to code and both brand files.

## Colors

### Web palette

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#F2F2F7` | Page background and PWA theme |
| Surface | `rgba(255, 255, 255, 0.86)` | Main grouped surfaces |
| Muted surface | `rgba(255, 255, 255, 0.68)` | Nested and secondary surfaces |
| Border | `rgba(60, 60, 67, 0.18)` | Quiet separation |
| Text | `#111111` | Titles, labels, primary content |
| Muted | `#6E6E73` | Metadata, hints, supporting copy |
| Accent | `#007AFF` | Primary actions, active states, focus |
| Accent soft | `rgba(0, 122, 255, 0.14)` | Focus ring and selection wash |
| Success | `#1F9C55` | Confirmed success and useful state |
| Warning | `#B7791F` | Review attention |
| Danger | `#D64045` | Destructive actions and errors |

The canvas may use the shipped pale vertical gradient and a subtle blue radial
wash near the top-left. Surfaces may use translucent white and blur when they
sit above that canvas. Blur is functional depth, not decoration.

Never communicate status by color alone. Pair dots and fills with text, labels,
or an accessible name. Do not use undefined CSS variables such as
`--separator`, `--label`, `--secondary-label`, or `--fill-secondary` as canonical
tokens until they are defined in `:root`.

### Extension palette

Extension UI uses the existing green OKLCH palette. Preserve these implemented
roles when editing extension screens:

| Role | Value |
| --- | --- |
| Canvas | `oklch(96% .012 155)` |
| Panel | `oklch(99% .006 155)` |
| Text | `oklch(24% .012 155)` |
| Muted text | `oklch(48% .012 155)` |
| Field | `oklch(97.5% .008 155)` |
| Accent | `oklch(54% .13 155)` |
| Accent hover | `oklch(49% .13 155)` |

## Typography

Use the system stack from frontmatter. Do not load a webfont. The product should
inherit the clarity and performance of the user's operating system.

| Role | Size | Weight | Line height | Tracking |
| --- | ---: | ---: | ---: | ---: |
| Page title | 32 px | 700 | 1.05 | -0.04em |
| Login title | 24 px | 700 | 1.08 | -0.03em |
| Dialog title | 20 px | 700 | normal | default |
| Section title | 18 px | 700 | 1.2 | -0.02em |
| Brand kicker | 14 px | 700 | 1.2 | -0.02em |
| Control | 16 px | 600 for buttons | 1 to 1.2 | default |
| Row title | 14 px | 600 | 1.3 | default |
| Supporting copy | 13 px | 400 | 1.4 | default |
| Field label | 12 px | 600 | normal | -0.01em |
| Metadata | 11 px | 400 | 1.3 | default |

Titles are sentence case. Action labels begin with a verb: `Add link`, `Open`,
`Copy link`, `Archive`, `Save connection`. Avoid slogans, hype, streak language,
and guilt. Errors say what failed and what the user can do next.

## Elevation

Depth remains quiet. Use one of the shipped levels rather than inventing a new
shadow for each component.

| Level | Recipe | Use |
| --- | --- | --- |
| Flat | no shadow, subtle border | Nested groups, ghost controls |
| Surface | `0 12px 30px rgba(17,17,17,.07)` | Standard surface |
| Raised row | `0 14px 28px rgba(17,17,17,.06)` | Hovered library row |
| Login card | `0 20px 48px rgba(17,17,17,.10)` | Authentication focus |
| Modal | `0 24px 80px rgba(0,0,0,.24)` | Command and action dialogs |

Use 1 px borders for structure. Main surfaces use 20 px radius, controls 13 px,
rows 14 px, nested surfaces 18 px, and large cards or bottom sheets 22 to 24 px.
Pills use 999 px. Keep the radius hierarchy visible: controls smaller than their
container.

## Components

### Layout and rhythm

- Standard shell: maximum 980 px, with 10 px horizontal margins at full width.
- Narrow shell: maximum 920 px.
- Main vertical gap: 12 px; airy stack: 16 px.
- Surface padding: 14 px; compact surface: 12 px; login card: 24 px.
- Common spacing values: 4, 6, 8, 10, 12, 14, 16, 20, and 24 px.
- Respect `env(safe-area-inset-bottom)` in installed and bottom-sheet layouts.

Existing breakpoints are 1024, 900, 768, 720, 600, 560, 480, and 400 px. Reuse
the breakpoint already governing a component. Do not add a new breakpoint for a
single alignment issue when flexible layout can solve it.

### Surfaces and grouped lists

Use `.surface` for a major task or group. Use `.surface--group` for edge-to-edge
list rows and `.surface--nested` for secondary content. A row has one title,
compact metadata, and actions at the trailing edge. Titles truncate after two
lines where space is limited. YouTube thumbnails remain 16:9 and use 10 px
radius.

### Navigation

Primary navigation is one three-item `.segmented-nav`. Active state uses a white
fill, dark text, and low shadow. Inactive items use muted text. Keep labels short
and stable. Badges show unresolved counts only when useful.

### Fields

Fields use 40 px minimum height, 13 px radius, 12 px horizontal padding, 16 px
text, and a quiet border. Textareas use at least 110 px height. Focus uses a blue
border and 4 px soft-blue ring. Use native input types before custom controls.

### Buttons

- Primary: blue gradient, white label, 40 px minimum height, weight 600.
- Small: 36 px minimum height and 14 px label.
- Ghost: translucent white, dark label, no shadow.
- Danger: red label or fill only for destructive actions.
- Touch layouts: provide at least 44 x 44 px interactive targets.

One surface should have one obvious primary action. Destructive actions must not
look primary until the user has deliberately opened their context.

### Feedback and status

Use brief success or failure toasts with `role="status"` and `aria-live` when
appropriate. Status dots remain 7 px but require a text or accessible equivalent.
Skeletons may reserve row height while loading. Offline capture must show queued
state and sync state, not an empty screen.

### Menus and dialogs

Menus stay attached to their triggering row and above neighboring rows. Command
search uses a centered 620 px dialog on desktop and a bottom sheet below 600 px.
YouTube decisions use a compact centered action sheet on desktop and tablet or
mobile bottom sheet below 1024 px. Dialogs require a title, focus management,
Escape dismissal where safe, and one clear primary path.

### Motion

Motion confirms state without delaying work. Use 120 to 250 ms transitions for
opacity, color, shadow, and transform. Prefer transform and opacity. Avoid layout
animation. Disable nonessential transitions and shimmer under
`prefers-reduced-motion: reduce`.

### Accessibility

- Use semantic HTML before ARIA.
- Keep visible keyboard focus on every interactive element.
- Preserve keyboard navigation and native controls.
- Provide text for status, errors, and color-coded states.
- Keep interactive targets at least 44 px on coarse-pointer layouts.
- Maintain readable contrast on translucent surfaces.
- Test at 390, 768, and 1024 px widths plus desktop.

## Do's and Don'ts

### Do

- Read `docs/PRODUCT.md` and this guide before UI work.
- Reuse existing tokens, classes, component shapes, and responsive behavior.
- Put the next useful decision before secondary information.
- Keep capture fast and correction close to the saved link.
- Use direct, sentence-case copy and familiar controls.
- Verify desktop, phone, tablet, keyboard, reduced motion, and safe areas.
- Update this file and `BRAND.html` after an approved visual system change ships.

### Don't

- Do not turn the homepage into a statistics-first dashboard.
- Do not add streaks, points, celebration effects, or guilt-based prompts.
- Do not make AI the center of the product experience.
- Do not add folder trees or configuration before real usage proves the need.
- Do not add gradients, shadows, blur, or colors outside existing roles casually.
- Do not use the cream app-icon tile inside the web header.
- Do not invent a new component when an existing pattern covers the task.
- Do not treat opening or snoozing alone as gained knowledge.

### Future-agent checklist

1. Identify the existing component and token closest to the requested change.
2. Inspect its desktop, tablet, phone, keyboard, loading, empty, and error states.
3. Make the smallest change that keeps the system coherent.
4. Check copy against the calm, direct voice.
5. Verify contrast, focus, target size, reduced motion, and overflow.
6. Change this guide only when the system itself changes, not for one-off styling.
