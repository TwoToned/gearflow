# Design System — GearFlow

## Product Context
- **What this is:** Asset & rental management SaaS for AV and theatre production companies
- **Who it's for:** Warehouse staff (scanning gear all day), project managers (quotes/invoices), owners (overview/reports)
- **Space/industry:** AV rental management. Peers: CurrentRMS, Rentman, Flex Rental Solutions
- **Project type:** Data-heavy web app (dashboard, tables, forms, detail views, warehouse scanning)

## Aesthetic Direction
- **Direction:** Industrial Calm
- **Decoration level:** Intentional — subtle depth through layered surfaces, no patterns or gradients
- **Mood:** A well-organized warehouse run by people who care. Clean, confident, data-dense when needed, spacious when possible. Linear's quietness meets the precision of technical production work.
- **Anti-patterns (never do):**
  - Purple/violet gradients as accents
  - Generic colored rectangle badges (use dot + text instead)
  - Card-per-section in forms (use flat sections with dividers)
  - "Manage your X directory" boilerplate copy
  - Full-row background tint on table hover (use left-edge glow)
  - Centered-everything layouts
  - Placeholder emoji or decorative icons

## Typography
- **Display/Hero:** DM Sans — 32px, weight 800, tracking -0.035em
- **Title:** DM Sans — 20px, weight 700, tracking -0.02em
- **Heading:** DM Sans — 14px, weight 700, tracking -0.01em
- **Body:** DM Sans — 13.5px, weight 400, line-height 1.55
- **Small/Label:** DM Sans — 12px, weight 500
- **Micro:** DM Sans — 11px, weight 500, tracking 0.005em
- **Overline:** DM Sans — 10-11px, weight 700, tracking 0.08em, uppercase
- **Data/Tables:** DM Sans with `font-variant-numeric: tabular-nums` for aligned numbers
- **Code/Mono:** Geist Mono — 12px
- **Loading:** Google Fonts via `next/font/google` (already configured)

### Type Rules
- Page titles use `t-title` (20px/700), NOT `text-2xl font-bold` scattered inline
- Section labels use overline style (10px/700/uppercase/teal)
- Body copy is 13.5px — slightly smaller than default for data density
- Negative letter-spacing on headings (-0.01 to -0.035em) for tightness
- Tabular nums on all financial/numeric columns

## Color
- **Approach:** Restrained — teal primary as sole accent, semantic colors for status only
- **Color space:** oklch throughout — perceptually uniform, consistent across light/dark

### Primary Teal Ramp
| Step | oklch | Usage |
|------|-------|-------|
| 50 | `oklch(0.96 0.02 195)` | Subtle backgrounds |
| 100 | `oklch(0.87 0.06 195)` | Light hover states |
| 200 | `oklch(0.77 0.10 195)` | Borders on teal elements |
| 300 | `oklch(0.67 0.12 195)` | - |
| 400 | `oklch(0.58 0.13 195)` | Dark mode primary |
| 500 | `oklch(0.45 0.12 195)` | Light mode primary |
| 600 | `oklch(0.38 0.10 195)` | Primary hover (light) |
| 700 | `oklch(0.30 0.08 195)` | Heavy accents |
| 800 | `oklch(0.22 0.06 195)` | - |
| 900 | `oklch(0.14 0.04 195)` | - |

### Semantic Colors
| Name | Light | Dark | Usage |
|------|-------|------|-------|
| Success/Green | `oklch(0.55 0.16 155)` | `oklch(0.65 0.17 155)` | Available, confirmed, checked in |
| Warning/Amber | `oklch(0.72 0.17 70)` | `oklch(0.78 0.15 70)` | Reserved, quoting, due soon |
| Error/Red | `oklch(0.58 0.22 27)` | `oklch(0.68 0.20 25)` | Overdue, maintenance, conflict |
| Info/Blue | `oklch(0.55 0.14 255)` | `oklch(0.62 0.14 255)` | Informational, kit pricing notes |

Each semantic color has a subtle variant at 8-10% opacity for backgrounds.

### Foreground Hierarchy
| Name | Light | Dark | Usage |
|------|-------|------|-------|
| fg (primary) | `oklch(0.12 0.02 220)` | `oklch(0.94 0.005 220)` | Headings, primary text |
| fg-2 (secondary) | `oklch(0.35 0.015 220)` | `oklch(0.72 0.006 220)` | Body text, descriptions |
| fg-3 (muted) | `oklch(0.52 0.008 220)` | `oklch(0.52 0.005 220)` | Labels, captions, metadata |
| fg-4 (subtle) | `oklch(0.68 0.005 220)` | `oklch(0.38 0.004 220)` | Placeholders, disabled text |

### Surface Depth (5 levels)
| Level | Light | Dark | Usage |
|-------|-------|------|-------|
| Inset | `oklch(0.955 0.005 220)` | `oklch(0.095 0.01 240)` | Recessed areas, code blocks |
| Base | `oklch(0.975 0.003 220)` | `oklch(0.115 0.01 240)` | Page background |
| Surface | `oklch(1 0 0)` | `oklch(0.155 0.01 240)` | Cards, table containers |
| Elevated | `oklch(0.985 0.002 210)` | `oklch(0.185 0.01 240)` | Dropdowns, hover states |
| Popover | `oklch(1 0 0)` | `oklch(0.20 0.012 235)` | Dialogs, popovers, menus |

### Dark Mode Strategy
- 5 distinct surface levels (not just 2)
- Slightly warm undertone in neutrals (hue 240 instead of pure 0)
- Primary teal boosted to 0.60 lightness (from 0.45) for vibrancy
- Borders use `oklch(1 0 0 / 6%)` — white at low opacity, not gray
- Shadows are stronger (20-25% opacity vs 3-6% in light)

### Borders
| Name | Light | Dark |
|------|-------|------|
| default | `oklch(0 0 0 / 6%)` | `oklch(1 0 0 / 6%)` |
| strong | `oklch(0 0 0 / 10%)` | `oklch(1 0 0 / 10%)` |

### Theming
Each org can override colors via Settings → Branding. The `BrandingProvider` converts any hex primary to a full oklch palette at runtime using `generatePrimaryPalette()` in `src/lib/color-utils.ts`. The default teal shown here is the fallback.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (not cramped, not spacious)
- **Scale:** 4, 8, 12, 16, 20, 24, 32, 48, 64
- **Page padding:** 24px desktop, 16px mobile
- **Component internal padding:** 12-16px
- **Between form sections:** Border separator (not space)
- **Between page sections:** 24-32px

### Spacing Rules
- Use the scale values — no arbitrary pixel values
- Tighter inside components (8-12px), more breathing room between sections (24-32px)
- Form fields: 3px gap between label and input, 14px between fields
- Table cells: 10-12px padding

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment
- **Max content width:** 1080px for content, full-width for tables
- **Grid:** `grid-template-columns: 1fr 1fr` for forms, `repeat(4, 1fr)` for stats
- **Sidebar:** 220px fixed width
- **Responsive:** Stack to single column on mobile, sidebar collapses

## Border Radius
- **sm:** 4px — inputs, badges, pills
- **md:** 6px — buttons, cards, nav items
- **lg:** 8px — containers, table wrappers, surfaces
- **xl:** 12px — app mockup frame, large containers
- **full:** 9999px — avatars, toggle pills

### Radius Rules
- Tighter than shadcn defaults (6px vs 8px for buttons)
- Consistent per component type — don't mix radii on the same level
- Inputs and badges share sm (4px)
- Cards and buttons share md (6px)

## Shadows
| Name | Light | Dark | Usage |
|------|-------|------|-------|
| xs | `0 1px 2px oklch(0 0 0 / 3%)` | `0 1px 2px oklch(0 0 0 / 15%)` | Subtle lift on stat cards |
| sm | `0 1px 3px oklch(0 0 0 / 5%), 0 1px 2px oklch(0 0 0 / 3%)` | darker | Default surface shadow |
| md | `0 4px 12px oklch(0 0 0 / 6%), 0 1px 3px oklch(0 0 0 / 4%)` | darker | Hover-elevated, dropdowns |
| focus | `0 0 0 2px var(--bg-base), 0 0 0 4px oklch(0.45 0.12 195 / 40%)` | adjusted | Focus ring — double-ring pattern |

### Shadow + Border Ring Pattern
Surfaces use `box-shadow: var(--shadow-xs), 0 0 0 1px var(--border)` — shadow for depth, 1px ring for definition. This replaces plain `border: 1px solid` which looks flat.

## Motion
- **Approach:** Intentional — every animation serves a purpose
- **Library:** Framer Motion
- **Easing:** `cubic-bezier(0.2, 0, 0, 1)` — fast start, gentle settle
- **Duration:** micro(100ms) short(150ms) medium(200ms) long(300ms)

### Motion Patterns
| Pattern | Duration | Easing | Usage |
|---------|----------|--------|-------|
| Button press | instant | scale(0.97) | Active state feedback |
| Button hover | 200ms | cubic-bezier(0.2,0,0,1) | translateY(-0.5px) + shadow escalation |
| Table row hover | 100ms | ease | Left-edge glow + subtle tint |
| Page transition | 200ms | ease-out | Fade between pages |
| List stagger | 30ms/item | ease-out | Items appear sequentially |
| Toast enter | 300ms | spring(stiffness:300) | Slide from right |
| Surface lift | 200ms | cubic-bezier(0.2,0,0,1) | translateY(-1px) + shadow-md |
| Status change | 150ms | ease | Color crossfade |
| Ghost underline | 150ms | ease | Opacity reveal on hover |
| Danger escalate | 200ms | ease | Muted → filled on hover |

### Reduced Motion
All animations MUST respect `prefers-reduced-motion`. Use `useReducedMotion()` hook. When enabled, animations degrade to instant transitions (opacity only, no transforms).

## Component Patterns

### Surfaces (replacing Card overuse)
- **Surface:** `background: var(--bg-surface); border-radius: 8px; box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);` — for distinct content blocks
- **Surface-inset:** `background: var(--bg-inset); border-radius: 6px;` — for recessed content
- **Surface-interactive:** Same as surface + `transition: all 0.2s; cursor: pointer;` and on hover: `box-shadow: var(--shadow-md), 0 0 0 1px var(--border-strong); transform: translateY(-1px);`
- **When to use a surface:** Only for content that is semantically distinct from its surroundings. NOT for every form section.

### Buttons
- **Primary:** Solid teal with inner highlight (`inset 0 1px 0 oklch(1 0 0 / 12%)`) for depth. Not flat.
- **Secondary:** Ghost border (`inset 0 0 0 1px var(--border-strong)`) that fills background on hover.
- **Ghost:** Text only with underline reveal on hover (opacity 0 → 0.4). NOT background tint.
- **Danger:** Starts muted (border + text only), escalates to filled red on hover. Progressive disclosure of destructive intent.
- **Active state:** All buttons `scale(0.97)` on press for physical feedback.

### Status Indicators
- **Dot + Text:** For detail views and headers. 7px dot with 2px ring glow + status-colored text.
- **Pill:** For tables and compact contexts. 4px border-radius, dot inside, colored background at 8-10% opacity.
- **Never:** Plain colored rectangles, badges without dots, or full-saturation background pills.

### Tables
- **Headers:** 10px uppercase, 700 weight, 0.08em letter-spacing, `fg-3` color. No background.
- **Rows:** 1px border-top separator. 10-12px cell padding.
- **Hover:** Left-edge 2px teal bar (opacity 0→1) + subtle `var(--teal-subtle)` background.
- **Asset tags/IDs:** Monospace (`Geist Mono`), `fg-3` color.
- **Values:** Right-aligned, `tabular-nums`, 500 weight.

### Forms
- **Layout:** Flat sections separated by `border-top: 1px solid var(--border)`. NO Card wrapping per section.
- **Section title:** 13px/700, with 12px description text below.
- **Fields:** `grid-template-columns: 1fr 1fr` default, 14px gap.
- **Labels:** 11px/600, `fg-2` color, 3px above input.
- **Inputs:** Standard (bordered with double-ring focus) or Minimal (bottom-border for settings).
- **Actions:** Right-aligned at form bottom, secondary then primary.

### Notices/Alerts
- **Style:** Left-edge 3px accent bar + surface background. NOT full-background tint.
- **Colors:** Green (success), Amber (warning), Red (error), Blue (info).
- **Icon + text layout, no titles.** Keep concise.

### Empty States
- **Icon:** 44px container with teal border + teal-subtle background, rounded 10px.
- **Heading:** 14px/700
- **Description:** 11px, `fg-3` color. Domain-specific copy (not "No results found").
- **CTA:** Primary button below when an action makes sense.

### Skeleton Loading
- **Pattern:** Linear gradient shimmer (200% background-size, 1.5s animation)
- **Colors:** `var(--bg-elevated)` → `var(--bg-popover)` → `var(--bg-elevated)`
- **Shapes:** Match the actual content layout — skeleton avatar (32px circle), skeleton heading (60% width, 16px height), skeleton text (full width, 12px height)
- **Minimum display time:** 200ms to avoid flash on fast loads

### Page Layout Templates
- **PageHeader:** Title (t-title) + optional description + action buttons. No "Manage your X" boilerplate.
- **ListPageLayout:** PageHeader + filters + DataTable + empty state fallback.
- **DetailPageLayout:** Breadcrumb + header with status + tabs + content.
- **FormPageLayout:** PageHeader + surface container with flat form sections.

### Section Headers
- **Style:** Teal label chip (10px/700/uppercase, teal text on teal-subtle background, 4px radius) with extending line (`flex: 1; height: 1px; background: var(--border)`).
- **Usage:** Major section divisions on pages. Not for every form group.

### Navigation
- **Sidebar items:** 12.5px/500, `fg-2` color. Active: teal color + teal-subtle background + 2px left-edge teal bar.
- **Org avatar:** 26px, 6px radius, gradient teal background.
- **Section labels:** 10px/700/uppercase/0.08em tracking, `fg-4` color.

## Keyboard Shortcuts
- Display shortcut hints in button tooltips (e.g., "New Asset (N)")
- Single-key shortcuts disabled when input/textarea is focused
- Single-key shortcuts disabled when dialog/modal is open
- `?` opens shortcuts overlay

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-19 | Industrial Calm aesthetic | Confident, not corporate. Matches AV production audience. |
| 2026-03-19 | Keep DM Sans + Geist Mono | Already loaded, good choice, not overused. No reason to change. |
| 2026-03-19 | Deep teal as sole accent | Distinctive in AV rental space (competitors use blue). Instant brand identity. |
| 2026-03-19 | Dot + text status indicators | Replaces generic colored rectangle badges. More intentional. |
| 2026-03-19 | Left-edge table hover | Replaces full-row tint. Distinctive, directional. |
| 2026-03-19 | Flat form sections | Replaces Card-per-section nesting. Reduces visual noise dramatically. |
| 2026-03-19 | 5-level surface depth | Creates true hierarchy in dark mode instead of flat same-shade surfaces. |
| 2026-03-19 | Framer Motion | Intentional animation language. No competitor in AV rental has motion. |
| 2026-03-19 | Org-level theming | Colors override via existing BrandingProvider. Default teal is fallback. |
| 2026-03-19 | Shadow + border ring | Surfaces use shadow + 1px ring instead of plain border. More depth. |
| 2026-03-19 | Inner highlight on primary buttons | Inset white shadow creates physical depth. Not flat. |
| 2026-03-19 | Danger button escalation | Starts muted, escalates to filled on hover. Progressive disclosure. |
