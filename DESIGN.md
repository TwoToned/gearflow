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

## Typography

### Type Stack
| Role | Font | CSS var | Notes |
|------|------|---------|-------|
| Display / Hero | BC Alphapipe → Archivo | `--font-display` | Commercial — see §11. Registry fallback is Archivo. |
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
| `t-overline` | 10px | 700 | 0.08em | 1.2 | Section labels, uppercase headers |
| `t-data` | inherit | — | — | — | + `font-variant-numeric: tabular-nums` |
| `t-mono` | 12px | 400 | 0 | 1.4 | JetBrains Mono for IDs, tags, counts |

### Type Rules
- **Absolute font-size floor: 11px.** Never render text smaller.
- Page titles: `t-title` (20px/700), never `text-2xl font-bold` scattered inline
- Section overlines: `t-overline` (10px/700/uppercase, `fg-3` color)
- Asset tags, IDs, quantity counts: `t-mono` (JetBrains Mono, `fg-3`)
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
| Name | Value | Usage |
|------|-------|-------|
| sm | 4px | Inputs, badges, pills |
| md | 6px | Buttons, nav items |
| lg | 8px | Cards, containers, table wrappers |
| xl | 12px | Modals, large panels |
| full | 9999px | Avatars, toggle pills |

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

### Status Indicators
- **Dot + Text:** 7px dot with 2px ring glow + status text. For detail views and headers.
- **Pill:** Compact badge, dot inside. Use `intentStyles` from `status-colors.ts` — NEVER hardcode pill classes.
- **Live/Active pill:** `bg-primary text-primary-foreground` (solid red) — CHECKED_OUT, ON_SITE, ACCEPTED
- **Error/Problem pill:** `bg-error-subtle text-error` (tinted red) — CANCELLED, overdue, conflict
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
- Linear gradient shimmer: `var(--bg-elevated)` → `var(--bg-popover)` → `var(--bg-elevated)`, 1.5s
- Match actual content layout shapes
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
RVLT red overline chip (`t-overline`, red text on red-subtle bg, 4px radius) + extending `1px border` line.

### Navigation
- **Sidebar items:** `t-small` (12px/500), `fg-2`. Active: red text + `bg-red-subtle` + 2px left-edge red bar.
- **Org avatar:** 26px, 6px radius, solid espresso background with red monogram
- **Section labels:** `t-overline`, `fg-4`
- **NavLink:** Always use `NavLink` wrapper from `app-sidebar.tsx`. Never plain `<Link>` for sidebar items (DOM crash risk on Next.js navigation).

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

## §11 BC Alphapipe Font Licensing
BC Alphapipe (Berton Hasebe) is a commercial typeface. **NOT on Google Fonts.**

- The registry theme sets `--font-display: "bc-alphapipe", "Archivo", sans-serif` — Archivo is the fallback until licensed
- Font files must be purchased and placed in `public/fonts/bc-alphapipe/` then loaded via `next/font/local`
- **Until licensed:** Archivo (Google Fonts) renders as the display font fallback — acceptable for development
- The registry will load Archivo automatically if bc-alphapipe is absent

**Do not hardcode `font-family: 'BC Alphapipe'` anywhere.** Always use `var(--font-display)` or `.t-display` class.

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

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-18 | RVLT Flow rebrand from GearFlow | Full brand/identity change per company direction |
| 2026-06-18 | Dark espresso forced, no light mode | RVLT brand identity; operator screens in low-light venues |
| 2026-06-18 | Single RVLT red accent | Brand distinction; no palette sprawl |
| 2026-06-18 | Hard offset shadows | Tactile, distinctive, avoids generic SaaS shadow blur |
| 2026-06-18 | BC Alphapipe for display (Hanken Grotesk fallback) | Brand identity; fallback until licensed |
| 2026-06-18 | Hanken Grotesk replaces DM Sans | Similar weight/quality; distinct from GearFlow aesthetic |
| 2026-06-18 | JetBrains Mono replaces Geist Mono | Better legibility for long asset tag strings |
| 2026-06-18 | Red disambiguation: fill vs tint, not separate hues | Single accent is non-negotiable; treatment carries semantic meaning |
| 2026-06-18 | Personality banned from alert/compliance contexts | Operator trust; clarity over character in high-stakes UI moments |
| 2026-06-18 | Bottom nav: Dashboard/Jobs/Warehouse/Crew/Assets | Daily operator workflows; Settings → avatar menu |
| 2026-06-18 | PDF rebrand deferred | Requires 5-consumer audit; out of scope for this redesign PR |
| 2026-06-18 | Mobile §15/§16 written fresh | These sections didn't exist in old DESIGN.md |
| 2026-06-18 | --teal-* aliases kept during migration | 44 legacy files; aliases removed in per-page PRs via grep pass |
| 2026-06-18 | Keep BrandingProvider, default to RVLT red | Org theming stays; default accent switches from teal to red |
| 2026-06-18 | NavLink wrapper required in all nav PRs | Next.js/Base UI DOM crash risk if replaced with standard Link |
