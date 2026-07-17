# Design System — RVLT Flow

## Product Context
- **What this is:** Live-event production operations software — jobs, crew, warehouse, equipment, compliance
- **Who it's for:** Production company ops staff (bump-ins, check-out/in, prep), project managers (quotes, dockets, crew), owners (dashboard, reports)
- **Space/industry:** Live events / AV production operations. Feels closer to ServiceTitan, Jobber, or Buildxact than to CurrentRMS.
- **Project type:** Data-heavy web app running dark espresso. Tables, job command centres, warehouse scanning, PDF dockets, scheduling, compliance.

## Aesthetic Direction
- **Direction:** Field Premium — sharp, premium, practical, slightly dry. Fun where it helps. Never decorative at the cost of clarity.
- **Mood:** A well-run production company's ops room: confident, fast, a bit irreverent. Linear's precision meets backstage energy.
- **Key visual language:** Dark espresso surfaces, single red accent (RVLT red), off-white warm text, hard offset shadows, 2px outlines, BC Alphapipe display moments
- **Anti-patterns (never do):**
  - Any colour accent other than RVLT red (no teal, purple, blue accents)
  - Gradients on any surface or accent element
  - Soft blurred SaaS shadows (use hard offset shadows)
  - Generic SaaS dashboard language ("Manage your X directory")
  - Personality copy, mascots, or Kalam font in alert/compliance/overdue/conflict contexts
  - Full-row background tints on table hover (use left-edge indicator)
  - 7-column stat card grids (use inline metrics strip)
  - Floating-card-in-space login (use split-panel with brand mark)
  - Centered-everything layouts
  - Placeholder emoji or purely decorative icons
  - **ALL-CAPS / uppercase text** (§5.2 — sentence case everywhere; uppercase is the rejected industrial misfire)
  - White text assumed on coloured fills (§3.7 on-fill rule — use `text-dark`, never assume white)

## Typography

### Type Stack
| Role | Font | CSS var | Notes |
|------|------|---------|-------|
| Display / Hero | Archivo | `--font-display` | Google Fonts. Bold geometric — the intentional display choice. |
| UI / Body | Hanken Grotesk | `--font-sans` | Google Fonts |
| Wordmark | Baloo 2 | `--font-wordmark` | Google Fonts — RVLT wordmark/brand moments only |
| Annotations | Kalam | `--font-hand` | Google Fonts — **only** in empty states and annotation moments |
| Data / Code | Geist Mono | `--font-mono` | Google Fonts — numbers in tables, asset tags, IDs |

### Type Scale
| Class | Size | Weight | Tracking | Line-height | Usage |
|-------|------|--------|----------|-------------|-------|
| `t-display` | 32px | 800 | -0.035em | 1.1 | Page hero moments, BC Alphapipe |
| `t-title` | 20px | 700 | -0.02em | 1.2 | Page titles, modal titles |
| `t-heading` | 14px | 700 | -0.01em | 1.3 | Section headings |
| `t-body` | 13.5px | 400 | 0 | 1.55 | Body text |
| `t-small` | 12px | 500 | 0 | 1.4 | Labels, supplementary |
| `t-micro` | 11px | 500 | 0.005em | 1.3 | Captions, hints — minimum size |
| `t-overline` | 11px | 600 | 0.02em | 1.2 | Section labels — **sentence case, never uppercase** (§5.2) |
| `t-data` | inherit | — | — | — | + `font-variant-numeric: tabular-nums` |
| `t-mono` | 12px | 400 | 0 | 1.4 | Geist Mono for IDs, tags, counts |

### Theme Text Utilities (from `@theme inline` — use these in components)
| Class | Size | Usage |
|-------|------|-------|
| `text-page-title` | 24px | Page-level headings |
| `text-section-header` | 18px | Section headings within a page |
| `text-card-title` | 15px | Card headings |
| `text-reading-body` | 16px | Long-form content |
| `text-ui-text` | 14px | Standard UI text, labels |
| `text-table-cell` | 13.5px | Table row content |
| `text-caption` | 12px | Captions, meta |
| `text-badge` | 11px | Badge / pill labels |
| `text-button` | 14px | Button labels |

The `.t-*` classes in `globals.css` (`t-display`, `t-title`, etc.) are app-level composites that set font-weight and font-family too. Use theme utilities for size-only overrides; use `.t-*` classes for full text role presets.

### Type Rules
- **Absolute font-size floor: 11px.** Never render text smaller. App ramp: 11 / 12 / 13.5 / 14 / 15 / 16 / 18 / 24 / 38px (38px = the one bright hero `Stat` figure only).
- **§5.2 No ALL-CAPS — sentence case everywhere.** Uppercase / `text-transform: uppercase` is banned. Section labels, overlines, badges, nav headers: sentence case. (Uppercase was the rejected "industrial" misfire.)
- Page titles: `t-title` (20px/700) or `text-page-title` (24px), never `text-2xl font-bold` scattered inline
- Section overlines: `t-overline` (11px/600, sentence case, `muted` color) — or use the `SectionHeader` component
- Asset tags, IDs, quantity counts: `t-mono` (Geist Mono, `muted`)
- Annotation moments (empty state captions, handwritten callouts): Kalam only
- Financial/numeric columns: always `tabular-nums`

## Color

### Approach
Dark espresso is the default app surface (`--paper: #141210`). Light "Paper" mode (`.light`) is opt-in. The single accent is RVLT red (`--red: #E0363D`).

**Token source of truth:** `globals.css` generated from the RVLT Flow registry (`https://rvlt-labs.github.io/rvlt-designlanguage/r/theme.json`). Do not edit by hand — reinstall via `npx shadcn@canary add .../theme.json` when tokens change.

### Canonical Token Names (espresso dark `:root`)
| Token | Value | Tailwind class | Usage |
|-------|-------|----------------|-------|
| `--paper` | `#141210` | `bg-paper` | Page background |
| `--paper-2` | `#1A1613` | `bg-paper-2` | Secondary surface |
| `--card` | `#211C17` | `bg-card` | Cards, panels |
| `--elev` | `#2A241D` | `bg-elev` | Elevated, dropdowns |
| `--ink` | `#F5EFE2` | `text-ink` | Primary text |
| `--ink-2` | `#CDC4B2` | `text-ink-2` | Secondary text |
| `--muted` | `#9E9483` | `text-muted` | Muted/labels |
| `--faint` | `#6E665A` | `text-faint` | Disabled/placeholders |
| `--line` | `#332C24` | `border-line` | Subtle dividers |
| `--line-2` | `#473E32` | `border-line-2` | Default border (= `--border` on dark) |
| `--red` | `#E0363D` | `bg-red` / `text-red` | RVLT primary red |
| `--red-700` | `#B21F26` | `bg-red-700` | Red shadow/hover |
| `--red-soft` | `rgba(224,54,61,.16)` | `bg-red-soft` | Red tint bg |
| `--ok` | `#4FD888` | `text-ok` / `bg-ok` | Success/available |
| `--ok-soft` | `rgba(62,207,122,.14)` | `bg-ok-soft` | Success bg tint |
| `--warn` | `#EBA53A` | `text-warn` / `bg-warn` | Warning/amber |
| `--warn-soft` | `rgba(235,165,58,.15)` | `bg-warn-soft` | Warning bg tint |
| `--t-out` | `#F26F73` | `text-t-out` | Overdue/timed-out |
| `--out-soft` | `rgba(224,54,61,.18)` | `bg-out-soft` | Overdue bg tint |
| `--rep` | `#B6AC9A` | `text-rep` | Neutral/returned |
| `--rep-soft` | `rgba(158,148,131,.14)` | `bg-rep-soft` | Neutral bg tint |
| `--blue` | `#5B8DEF` | `text-blue` / `bg-blue` | Info |
| `--blue-soft` | `rgba(91,141,239,.15)` | `bg-blue-soft` | Info bg tint |
| `--sh-card` | `0 3px 0 #0C0A08` | `shadow-[var(--sh-card)]` | Default card shadow |
| `--sh-hover` | `0 7px 0 #0C0A08` | `shadow-[var(--sh-hover)]` | Hover lift shadow |
| `--sh-stk` | `2px 4px 0 rgba(0,0,0,.5)` | `shadow-[var(--sh-stk)]` | Hard stroke shadow |
| `--scrim` | `rgba(14,12,10,.66)` | `bg-scrim` | Modal backdrop |
| `--select` | `rgba(224,54,61,.20)` | `bg-select` | Selected row background |
| `--link` | `#5B8DEF` (= `--blue`) | `text-link` | Link text — always blue, never red |
| `--cream` | `#F5EFE2` | `bg-cream` | Cream tier / editorial highlight surface |
| `--cream-ink` | `#1D1A15` | `text-cream-ink` | Text on cream surfaces |

### Module Hues (§3.7) — for nav badges, module wayfinding
Eight named hues assigned to modules. **Red is never a module colour.** Each module gets one hue; use its soft fill for backgrounds.

| Module | Token | Soft fill |
|--------|-------|-----------|
| Projects | `--blue` / `bg-blue` | `bg-blue-soft` |
| Crew | `--purple` / `bg-purple` | `bg-purple-soft` |
| Gear / Assets | `--amber` / `bg-amber` | `bg-amber-soft` |
| Compliance / T&T | `--teal` / `bg-teal` | `bg-teal-soft` |
| Maintenance | `--coral` / `bg-coral` | `bg-coral-soft` |
| Schedule | `--green` / `bg-green` | `bg-green-soft` |
| Clients/Suppliers | `--pink` / `bg-pink` | *(no soft-fill token)* |
| Warehouse | `--lime` / `bg-lime` | *(no soft-fill token)* |

The same hue palette is used for avatar colours (8 deterministic hues, never red). Data-viz series order: blue → amber → green → purple → coral → teal → pink → lime. Red is reserved for threshold indicators only.

### §3.7 On-Fill Text Rule
**Never assume white text on a coloured fill.** Text sitting on any categorical/module fill (badge, patch, shift bar, avatar):
- Dark theme: `text-dark` (the espresso near-black `--dark`)
- Light theme: `text-primary-foreground` — **except** amber and lime fills, which always use `text-dark` (their luminance fails white)
- The `--red` primary fill is the one exception: it uses `text-white` / `text-primary-foreground` (`#fff`) in both themes
Use `PersonAvatar` and `FeaturePatch` components, which encode this rule internally — don't hand-roll on-fill colours.

### §1 Red Disambiguation Rule
**Two distinct red values for distinct meanings:**

| Token | Value | Treatment | Meaning |
|-------|-------|-----------|---------|
| `--red` | `#E0363D` | Solid fill `bg-red text-white` | **LIVE / ACTIVE / IN-USE** — CHECKED_OUT, ON_SITE, ACCEPTED |
| `--t-out` | `#F26F73` | Tinted `bg-out-soft text-t-out` | **PROBLEM / OVERDUE / FAILED** — CANCELLED, T&T FAILED, overdue returns |

`--red` = the RVLT brand red (saturated, energetic). `--t-out` = the timed-out/overdue semantic (lighter, warmer — distinct at a glance). Do not mix them.

**Personality and alerts:**
- Personality copy, mascot (`FlowMascot`), and `--font-hand` (Kalam) are **BANNED** in: alert notices, compliance warnings, overdue states, T&T failure states, conflict alerts, destructive action confirmations
- They ARE allowed in: empty states, onboarding moments, zero-state dashboard, positive completions

### Light Mode ("Paper" — opt-in)
Add `.light` class to `<html>` to switch. Paper uses `--border: var(--ink)` (full-ink 2px outlines — the RVLT outline aesthetic on light). Same semantic tokens, lighter surface primitives. The app ships dark by default; light mode is available via `ThemeProvider`.

## Spacing
- **Base unit:** 4px
- **Scale:** 4, 8, 12, 16, 20, 24, 32, 48, 64
- **Page padding:** 24px desktop, 16px mobile (+ safe-area insets)
- **Component internal padding:** 12–16px
- **Between form sections:** border separator (not whitespace)
- **Between page sections:** 24–32px
- **Form fields:** 3px gap label→input, 14px between fields
- **Table cells:** 10–12px padding

## Layout
- **Max content width:** 1080px for content zones, full-width for tables and warehouse screens
- **Grid:** `grid-cols-2` for forms, `grid-cols-4` for stat metrics
- **Sidebar:** 220px fixed width on desktop
- **Responsive:** See §15 (Mobile Rules)

## Border Radius
Token source: `--r: 14px`, `--r-lg: 20px` (from theme.json). RVLT components are intentionally rounded.

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `--r` | `14px` | `rounded-[var(--r)]` | Buttons, inputs, cards, badges — default |
| `--r-lg` | `20px` | `rounded-[var(--r-lg)]` | Modals, large panels, dialogs |
| pill | `9999px` | `rounded-full` | Avatars, toggle pills |
| `--radius` | `0.875rem` | (shadcn alias = `--r`) | shadcn component default |

Note: the shadcn registry button/card/input components use `--radius` (14px) by default. Do not override to smaller values.

## §2 Shadows — Hard Offset Style
RVLT Flow uses **hard offset shadows** (no blur). This is the primary visual texture distinguishing it from generic SaaS dashboards.

Use the registry token names — do not hardcode shadow values:

| Token | Value | Usage |
|-------|-------|-------|
| `--sh-card` | `0 3px 0 #0C0A08` | Default card resting shadow |
| `--sh-hover` | `0 7px 0 #0C0A08` | Card on hover (lifted) |
| `--sh-stk` | `2px 4px 0 rgba(0,0,0,.5)` | Hard stroke shadow (buttons, small elements) |
| `--sh-halo` | `0 3px 0 var(--red-700), 0 0 28px rgba(224,54,61,.5)` | Red halo (primary button active state) |
| `--lit` | `inset 0 1px 0 rgba(255,253,248,.14)` | Inner top-edge highlight |

## Motion
- **Easing:** `cubic-bezier(0.2, 0, 0, 1)` — fast start, gentle settle
- **Duration:** micro(100ms) short(150ms) medium(200ms) long(300ms)
- All animations must respect `prefers-reduced-motion`. Degrade to opacity-only.

| Pattern | Duration | Usage |
|---------|----------|-------|
| Button press | instant | scale(0.97) feedback |
| Page transition | 200ms | Fade between pages |
| List stagger | 30ms/item | Sequential item entrance |
| Toast enter | 300ms spring | Slide from right |
| Status change | 150ms | Colour crossfade |
| Surface lift | 200ms | translateY(-1px) + shadow escalation |
| Danger escalate | 200ms | Muted → filled red on hover |

Motion utilities live in `@/components/ui/motion`: `FadeIn`, `StaggerList`/`StaggerItem`, `AnimatedNumber`, `SurfaceLift`.

## Component Patterns

### Surfaces
- **Surface:** `bg-surface + border-radius: 8px + shadow-xs + 1px border ring` — distinct content blocks
- **Surface-inset:** `bg-inset + border-radius: 6px` — recessed content
- **Surface-interactive:** Surface + `transition: all 0.2s` + hover: shadow-sm + translateY(-1px)
- Use surfaces only for semantically distinct content blocks. NOT for every form section.

### Buttons
- **Primary:** Solid RVLT red (`bg-primary`), `text-primary-foreground`, hard offset shadow, inner highlight
- **Secondary:** Espresso surface with `2px outline` border; fills slightly on hover
- **Ghost:** Text only with underline reveal on hover
- **Danger:** Starts muted (outline + text), escalates to filled red on hover (progressive disclosure)
- **All:** `scale(0.97)` on press

### §9.1 Required States — Every Interactive Element
Every button, input, link, menu item, tab, etc. must carry:
- **Focus:** `focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 focus-visible:ring-offset-paper`
- **Disabled:** `disabled:opacity-45 disabled:cursor-not-allowed`
- **Motion:** any looping/active animation guarded by `motion-safe:` (respects `prefers-reduced-motion`)
- **Invalid (inputs):** `aria-invalid` drives the error ring — never colour-only

Registry components encode these already. Hand-built interactive elements must replicate them.

### Avatars / People
Always use `PersonAvatar name="…"` for any crew/person display. It derives a deterministic hue from the name hash (one of the 8 module hues, never red) and renders AA-safe initials per the §3.7 on-fill rule. Never hand-pick avatar background colours.

### Status Indicators
Registry `StatusIndicator` (when deployed) offers `dot` / `glow` / `inline` variants; `live` state is a pulsing green dot. Until migrated, the app's existing `status-indicator.tsx` (33 consumers) stays — see migration note in the redesign plan.
- **Dot + Text:** 7px dot with 2px ring glow + status text. For detail views and headers.
- **Pill:** Compact badge, dot inside. Use `intentStyles` from `status-colors.ts` — NEVER hardcode pill classes.
- **Live/Active pill:** `bg-primary text-primary-foreground` (solid red) — CHECKED_OUT, ON_SITE, ACCEPTED
- **Error/Problem pill:** `bg-out-soft text-t-out` (tinted red) — CANCELLED, overdue, conflict
- **Status encoded by colour AND label, never colour-only** (§3.3 — accessibility)
- **Never:** Plain colored rectangles, badges without semantic mapping

### Tables
- **Headers:** `t-overline` (10px/700/uppercase), `fg-3`, no background
- **Rows:** 1px `border-top` separator, 10–12px cell padding
- **Hover:** Left-edge 2px red bar (opacity 0→1) + subtle `bg-elevated` tint
- **IDs/tags:** `t-mono` (JetBrains Mono), `fg-3`
- **Values:** Right-aligned, `tabular-nums`, 500 weight

### Forms
- **Layout:** Flat sections separated by `border-top`. No card wrapping per section.
- **Section title:** 13px/700, 12px description text below
- **Fields:** `grid-cols-2` default, 14px gap
- **Labels:** 11px/600, `fg-2`, 3px above input
- **Inputs:** Standard (bordered, red double-ring focus) or Minimal (bottom-border for settings)
- **Actions:** Right-aligned footer, secondary → primary left to right

### Notices/Alerts
- **Style:** Left-edge 3px accent bar + surface background. NOT full-background tint.
- **Colors:** Green (success), Amber (warning), Red (error), Blue (info)
- **NO personality copy in alerts.** No mascots, no Kalam, no irreverence. Operators need immediate clarity.

### Empty States
- **Icon container:** 44px, 2px solid border, hard offset shadow, 10px radius
- **Heading:** `t-heading` (14px/700)
- **Description:** `t-micro` (11px), `fg-3`. Domain-specific copy ("No assets checked out" > "No results found")
- **CTA:** Primary button when an action exists
- **Kalam annotation:** Optional — a handwritten-style caption below the description (Kalam, 14px, `fg-3`)
- **Mascot:** Optional — only in true zero-state (first-time, nothing yet created)

### Empty State Illustrations
SVG spot illustrations from `@/components/ui/spot-illustrations`:
- Monochrome red, 56px display size, `text-primary/60`
- Domains: assets, projects, crew, maintenance, calendar, documents, clients, kits, locations, notifications

### Skeleton Loading
- **Solid `--elev` pulse, no gradient.** (RVLT design rule — gradient shimmer is a SaaS anti-pattern)
- Use `<Skeleton />` from the registry — it uses the correct token and animation
- Match actual content layout shapes (circle for avatars, rounded rects for text/buttons)
- Minimum 200ms display to avoid flash

### Page Layout Templates
- **PageHeader:** `t-title` + optional description + action buttons. No "Manage your X" boilerplate.
- **ListPageLayout:** PageHeader + filters + DataTable + empty state
- **DetailPageLayout:** Breadcrumb + header with status + tabs + content
- **FormPageLayout:** PageHeader + flat form sections

### Detail Page Layout (2-column)
All detail pages (project, asset, model, kit, client, crew, supplier, maintenance, T&T) use asymmetric 2-column:
- **Left (~63%):** Main content with tabs
- **Right (~37%, 340px min-width, sticky):** Key facts, quick actions, activity timeline
- Sidebar sections: `border-b pb-4` separators, `SectionHeader` overline labels
- Responsive: sidebar stacks below on mobile (see §15)

### Dashboard Layout
- Dynamic greeting (Good morning/afternoon/evening) + date
- Alert badges (red/amber) only when problems exist
- Inline metrics strip (single surface, vertical dividers) instead of stat card grid
- Projects with `DateRangeBar` for visual rental period
- Activity feed with staggered entrance

### Breadcrumb Navigation
```
Parent > Current Page
Parent > Entity Name > Edit
```
`ChevronRight` separator (3×3), `t-small text-fg-3`, links `hover:text-fg`.

### Section Headers
Use the registry `SectionHeader` component. Two variants:
- **default** — `t-overline` label in mono, `muted` color (sentence case) + extending `1px --line` rule. The everyday section divider.
- **prominent** — Kalam label in RVLT red + extending rule. Reserve for marketing / hero / personality moments, never compliance or alert sections.

(Legacy `.section-label` CSS utility remains for non-migrated pages; new work uses `SectionHeader`.)

### Navigation
- **Sidebar items:** module-hue wayfinding (decision 2026-06-18, below). Each top-level
  item carries its module hue (`hueText`/`hueSoftBg`/`hueHoverText` maps in
  `app-sidebar.tsx`). Active: the item's hue text + hue-soft bg + `--sh-card`; hover:
  hue text + hue-soft bg. Sub-rows: hue text on `bg-elev` when active. This is an
  intentional override of the original "red-only active" nav rule — the sidebar is the
  one place module hues do double duty as the active treatment, so the nav reads as a
  coloured map of the app. **Red is still never a module hue.** The mobile bottom nav
  keeps the simpler red-active rule (§16).
- **Org avatar:** 26px, 6px radius, solid espresso background with red monogram
- **Section labels:** `t-overline`, `muted` (sentence case, §5.2)
- **NavLink:** Always use `NavLink` wrapper from `app-sidebar.tsx`. Never plain `<Link>` for sidebar items (DOM crash risk on Next.js navigation). (The mobile bottom nav in `mobile-nav.tsx` is a separate, non-sidebar render path and uses a plain focus-ringed `<Link>`.)

## §3 Status System

All status → color intent mappings live in `src/lib/status-colors.ts`. **Never hardcode intent classes outside this file.**

### Intent → Class Mapping (RVLT registry token names)
| Intent | Dot | Text | Pill | Background |
|--------|-----|------|------|------------|
| primary (live) | `bg-red` | `text-red` | `bg-red text-white` | `bg-red-soft` |
| success | `bg-ok` | `text-ok` | `bg-ok-soft text-ok` | `bg-ok-soft` |
| warning | `bg-warn` | `text-warn` | `bg-warn-soft text-warn` | `bg-warn-soft` |
| error | `bg-t-out` | `text-t-out` | `bg-out-soft text-t-out` | `bg-out-soft` |
| info | `bg-blue` | `text-blue` | `bg-blue-soft text-blue` | `bg-blue-soft` |
| neutral | `bg-rep` | `text-rep` | `bg-rep-soft text-rep` | `bg-rep-soft` |

**Critical distinction:**
- `primary` pill = solid `--red` fill (`bg-red text-white`) — live/active
- `error` pill = `--t-out` text on `--out-soft` tint — problem/overdue

## §4 Keyboard Shortcuts
- Shortcut hints in button tooltips ("New Asset (N)")
- Single-key shortcuts disabled when input/textarea is focused
- Single-key shortcuts disabled when dialog/modal is open
- `?` opens shortcuts overlay

## §5 Data Visualization
Inline charts from `@/components/ui/sparkline`:
- **`Sparkline`** — tiny line chart, red stroke on espresso
- **`UtilizationBar`** — thin progress bar (red for active, amber for at-risk, green for available)
- **`DateRangeBar`** — rental period visualization

## §6 PDF Pipeline (separate from app UI)
PDF generation (`src/lib/pdfme/`) uses Helvetica (pdfme constraint — no Unicode, no web fonts). PDF branding updates are **deferred** to a follow-up PR. Do not apply RVLT design system colors or fonts to PDF templates in this redesign. See `docs/designs/ux-ui-redesign.md` T3 decision.

## §7 Theming / BrandingProvider
Each org can override accent color via Settings → Branding. `BrandingProvider` at runtime generates a full red ramp from the org's chosen primary. Default (no override) = RVLT red `oklch(0.55 0.24 25)`. The branding override applies only to `--primary` and `--red-*` ramp — not to semantic colors (success/warning/error/info stay fixed).

## §8 State Matrix — Required States Per Surface Type

Every interactive surface must implement all applicable states. `✓` = required. `—` = not applicable.

| Surface | Empty | Loading | Error | Partial | Success | Auth-gated |
|---------|-------|---------|-------|---------|---------|-----------|
| List page | ✓ | ✓ | ✓ | — | — | ✓ |
| Detail page | — | ✓ | ✓ | — | — | ✓ |
| Form (create) | — | — | ✓ | — | ✓ | ✓ |
| Form (edit) | — | ✓ | ✓ | — | ✓ | ✓ |
| Table | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Dashboard widget | ✓ | ✓ | ✓ | — | — | — |
| Command/search | ✓ | ✓ | ✓ | — | — | — |
| Dialog | — | ✓ (submit) | ✓ | — | ✓ | — |
| Scan/warehouse | ✓ | ✓ | ✓ | — | ✓ | — |

### State Patterns
- **Empty:** Icon illustration + `t-heading` + `t-micro fg-3` copy + optional CTA button
- **Loading:** Skeleton shimmer matching content shape
- **Error:** Left-edge red bar notice + retry/back action. Never a full-page replacement for recoverable errors.
- **Success:** Toast notification for mutations; inline confirmation for scans/check-outs
- **Auth-gated:** Component returns `null` when `!hasPermission`. Never throws, never shows fallback UI.

## §9 Personality Rules

### Allowed
- **Kalam font:** empty state captions, annotation callouts, zero-state onboarding
- **Mascot:** true zero-state (no data yet), first-time-user onboarding
- **Irreverent microcopy:** action button labels, empty state descriptions, page subtitle lines
- **Punchy operator voice:** tooltips, confirmation messages ("Gear's away"), menu items

### Banned
- Any personality in: **alert notices, overdue warnings, T&T failure states, compliance errors, conflict alerts, destructive action confirmations, export/import failures**
- Rule: if a human is about to make a decision that could affect revenue, safety, or compliance, the copy must be direct and plain

## §10 Mobbin Research Protocol
Before redesigning any major product area, use Mobbin MCP. Target domain-adjacent apps:
- Field service, dispatch, crew scheduling, project/job ops
- Inventory/equipment management, quote/billing builders
- Warehouse/logistics, compliance/checklists, admin/settings

Apply UX structure (information hierarchy, interaction patterns, navigation IA). Do NOT apply Mobbin visual styling — DESIGN.md governs all visuals.

Fallback references: Linear, Notion, Airtable, ServiceTitan, Jobber, Vercel, Supabase, Stripe Dashboard.

## §11 Display Font
`--font-display` is set to **Archivo** (Google Fonts). This is the intentional display choice — not a fallback.

Archivo is loaded via `next/font/google` with weights 400–900. Always reference it via `var(--font-display)` or the `.t-display` class. Never hardcode `font-family: 'Archivo'`.

## §15 Mobile Rules — Touch, Density, Safe Areas

### Touch Targets
- Minimum interactive target: 44×44px (iOS HIG) for all tap targets
- Use `.touch-target` utility class on interactive elements smaller than 44px
- Table row actions: full-row tap in mobile card mode (no inline icon buttons)
- Form inputs: minimum 44px height on mobile

### Density
- Mobile uses card-based layout for lists (not data tables)
- Maximum 2 columns on mobile (never 3+)
- Detail page: single column (sidebar stacks below main content)
- Section headers collapse to simple `fg-4` overline labels (no extending line on mobile)
- Font sizes stay at desktop values — do NOT shrink for density. The 11px floor applies on all screens.

### Safe Areas
- Always account for iOS safe-area insets using `env(safe-area-inset-*)` inline styles
- The app-shell uses `position: fixed; inset: 0; overflow: hidden` on mobile (see `globals.css`)
- Never use Tailwind arbitrary `safe-*` values — use inline `style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}`
- Bottom nav must add safe-area-inset-bottom to its own padding

### Responsive Breakpoints
| Breakpoint | Width | Behavior |
|-----------|-------|---------|
| Mobile | < 768px | Bottom nav, card lists, single column |
| Tablet | 768px–1024px | Side nav collapses to icon-rail, 2-column content |
| Desktop | > 1024px | Full sidebar, data tables, 2-column detail pages |

### Viewport Behavior
- `viewport-fit: cover`, `maximum-scale: 1` (see `layout.tsx`)
- iOS status bar: `black-translucent` themeColor `#1a100d` (espresso)
- `html { min-height: calc(100% + env(safe-area-inset-top)) }` prevents bottom gap

## §16 Mobile Navigation (Bottom Nav)

### Bottom Nav Structure
5-item fixed bottom navigation bar for mobile (< 768px). Desktop uses the sidebar.

```
[ Dashboard ] [ Jobs ] [ Warehouse ] [ Crew ] [ Assets ]
```

- Active tab: RVLT red icon + red label
- Inactive tab: `fg-4` icon + `fg-4` label
- Tab height: 56px (+ safe-area-inset-bottom)
- Icon size: 22px
- Label: `t-micro` (11px/500)
- No badges on nav items (alerts surface in Dashboard instead)

### MobileNav Component
`src/components/layout/mobile-nav.tsx` — **separate** from `app-sidebar.tsx`. Any IA change (add/remove tabs, reorder, rename) MUST be applied to BOTH files in the same PR.

### What Goes in the Bottom Nav vs Sidebar
- Bottom nav (5 items): Daily-use operator workflows only
  - Dashboard (overview, alerts)
  - Jobs (active projects, pull sheets)
  - Warehouse (check-out/in, scanning)
  - Crew (schedule, roster)
  - Assets (gear, kits)
- Sidebar-only (desktop + overflow): Settings, Admin, Clients, Suppliers, Test & Tag, Maintenance, Reports
- Settings accessible via avatar menu on mobile

### Deep Navigation on Mobile
- Use Sheet (bottom-sheet) for detail panels, not full-page navigation where possible
- "Back" always goes to the list (no breadcrumb trees on mobile)
- Destructive actions behind one confirmation step (no long dialogs)

## §17 Marketing Page Design

The marketing page (`/` root) is a distinct design mode from the app UI. These rules apply only to marketing/landing routes.

### Typography — marketing is Archivo dominant
- Every section heading: Archivo, large and bold (800–900 weight). This is the reverse of the app where Hanken Grotesk dominates.
- Kalam is used MORE freely: section annotations above headings (e.g. *"built from the actual job flow"*), written in RVLT red. Not restricted to empty states as in the app.
- Body copy: Hanken Grotesk as normal.

### Red emphasis word
Each hero/section heading has one key word or phrase in solid `--red` text, often with a red underline decoration element. One emphasis per heading maximum.

### Layout sections
1. **Sticky nav** — `--paper` bg, `RVLT Flow` wordmark (RVLT in red italic display, Flow in white bold), ghost Sign in + Halo CTA Book a demo
2. **Hero** — centered, floating feature-patch icons as decorative imagery, dual CTA
3. **Metrics strip** — 3–4 `Stat` widgets, one bright hero metric + siblings dim
4. **How it works** — numbered 4-step horizontal cards (BC Alphapipe step numbers in red)
5. **Features grid** — 3×2 cards, each with module-colored feature-patch icon + mini UI mockup
6. **Why section** — 2-col split: text+stat left / crew scheduler preview right
7. **Pricing** — 3-tier cards (Core dark / Flow cream featured / Network dark), cream tier pops
8. **FAQ** — accordion
9. **Final CTA** — full `bg-red` section, white headline, cream "Book a workflow demo" button
10. **Footer** — 4-col, logo+tagline, Product/Company/Resources columns

### Feature-patch floating decorations
Module-colored square icon badges (14-20px radius, soft fill bg + icon) scattered at varying scales around the hero. Same component as the module wayfinding patches — decorative use only here.

### Cream tier (pricing highlight)
Featured pricing tier: `bg-cream text-cream-ink` card, elevated above flanking dark cards. Primary CTA inside is a red `Button` (Halo CTA variant for the hero plan). Kalam annotation in the card.

### Full red CTA section
Bottom of page: `bg-red` full-width rounded section, white heading text, cream `Button` CTA, GAFF sticker badge decorative element.

### GAFF brand mark
The GAFF tape roll icon (black-and-white round sticker) is a production-industry in-joke used as a brand mark in marketing contexts. Different from the FlowMascot (the robot), which is the app-context empty-state icon. Both are decorative and never used in functional alerts.

### Auth pages
Login / register / onboarding follow marketing aesthetics, not app UI rules:
- Split-panel layout: brand side (dark, BC Alphapipe headline) + form side
- NOT a floating card centered on espresso — that reads as generic SaaS

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-18 | RVLT Flow rebrand from RVLT Flow | Full brand/identity change per company direction |
| 2026-06-18 | Dark espresso forced, no light mode | RVLT brand identity; operator screens in low-light venues |
| 2026-06-18 | Single RVLT red accent | Brand distinction; no palette sprawl |
| 2026-06-18 | Hard offset shadows | Tactile, distinctive, avoids generic SaaS shadow blur |
| 2026-06-18 | Archivo as display font (not BC Alphapipe) | Preferred the Archivo look; BC Alphapipe removed entirely |
| 2026-06-18 | Hanken Grotesk as font-sans | Registry canonical; replaces DM Sans from old RVLT Flow layout |
| 2026-06-18 | Geist Mono as font-mono | Registry canonical (`--font-mono: "Geist Mono"`) |
| 2026-06-18 | Red disambiguation: fill vs tint, not separate hues | Single accent is non-negotiable; treatment carries semantic meaning |
| 2026-06-18 | Personality banned from alert/compliance contexts | Operator trust; clarity over character in high-stakes UI moments |
| 2026-06-18 | Bottom nav: Dashboard/Jobs/Warehouse/Crew/Assets | Daily operator workflows; Settings → avatar menu |
| 2026-06-18 | PDF rebrand deferred | Requires 5-consumer audit; out of scope for this redesign PR |
| 2026-06-18 | Mobile §15/§16 written fresh | These sections didn't exist in old DESIGN.md |
| 2026-06-18 | --teal-* aliases kept during migration | 44 legacy files; aliases removed in per-page PRs via grep pass |
| 2026-06-18 | Keep BrandingProvider, default to RVLT red | Org theming stays; default accent switches from teal to red |
| 2026-06-18 | NavLink wrapper required in all nav PRs | Next.js/Base UI DOM crash risk if replaced with standard Link |
| 2026-06-18 | Sidebar nav uses module-hue active/hover (not red-only) | Per-module colour makes the sidebar a wayfinding map; user-directed. Red stays non-module; mobile bottom nav keeps red-active (§16) |
