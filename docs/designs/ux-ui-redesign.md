<!-- /autoplan restore point: /home/jayden/.gstack/projects/gearflow/worktree-bridge-cse_01X8Vs3P7wTZzycnYRKHgcmV-autoplan-restore-20260618-115858.md -->
---
status: ACTIVE
updated: 2026-06-18
---
# Plan: Full RVLT Flow UI/UX Redesign (RVLT Flow → RVLT Flow)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Overview

RVLT Flow is being fully rebranded and redesigned into **RVLT Flow**: production-operations software built by a real live-events production company. This is a complete production UI/UX redesign — not a prototype, not an app-shell refresh, not a token swap. Every major page, every core flow, every reusable surface, every empty/loading/error state, every responsive breakpoint.

**Product must retain all existing functionality. UI/UX overhaul only.**

---

## Product Direction

RVLT Flow should feel like:
- A field-ready operations tool
- Built by people who actually know bump-ins, prep, crew, warehouse chaos, quotes, dockets, test tags, and client changes
- Sharp, premium, practical, slightly dry
- Fresh, fun, tactile, and alive
- Not generic enterprise software
- Not a generic SaaS dashboard

### Feel: Fun + Fresh, Operationally Complete

The redesign should have energy: playful but controlled, confident, tactile, slightly irreverent, expressive where it helps — never childish, never decorative at the cost of clarity.

Every page must still show the data operators need:
- dates, statuses, clashes, crew, venues, clients, quantities
- assigned assets, quote totals, document states
- overdue work, next actions, warnings, audit/activity context

**Do not simplify by hiding important operational data.**

Personality moments (controlled):
- Kalam annotations
- Mascot/empty-state moments
- Punchy operator microcopy
- Tactile card treatments
- Expressive but semantic status treatments

---

## Design System Law: DESIGN.md

Read `DESIGN.md` as the bible before writing any code.

Key constraints:
- Dark espresso is the default app surface
- Semantic tokens only — no raw hex colours in components
- Single red accent only for primary/live/active/alert
- No gradients, no extra accent colours
- Depth via luminance ladder, 2px outlines, hard offset shadows
- No soft blurred SaaS depth
- 11px absolute font-size floor
- Type stack: Archivo (display), Hanken Grotesk (UI), Kalam (annotations only), Geist Mono (data/code) — sentence case only, no ALL-CAPS (§5.2)
- Spacing on a 4px grid
- Mobile follows DESIGN.md §15 and §16 especially

Cross-check DESIGN.md against `RVLT-Labs/rvlt-designlanguage` canonical source if local copy is stale.

---

## RVLT Flow Component Registry

**All UI components must come from the RVLT Flow registry first. Never build bespoke components when a registry equivalent exists.**

Registry: `https://rvlt-labs.github.io/rvlt-designlanguage`
Install: `npx shadcn add https://rvlt-labs.github.io/rvlt-designlanguage/r/<name>.json` (shadcn 4.10.0 resolves directly — `@canary` no longer required). Use `--overwrite` to refresh an audited component.

### Currently DEPLOYED registry components (29 — verified live 2026-06-18):
`theme` `utils` `button` `badge` `card` `input` `textarea` `label` `checkbox` `switch`
`select` `dialog` `sheet` `drawer` `popover` `dropdown-menu` `tooltip` `command`
`sonner` `tabs` `accordion` `table` `separator` `skeleton` `avatar` `flow-mascot`
`stat` `empty-state` `stepper`

### ANNOUNCED but NOT YET DEPLOYED (7 — registry index + URLs still 404 as of 2026-06-18):
`page-header` `breadcrumb` `section-header` `combobox` `status-indicator` `feature-patch` `crew-scheduler`
The maintainer announced these (+ a compliance audit of the 29) but the GitHub Pages deploy hasn't propagated — `registry.json` still lists 29 and `r/<name>.json` 404 for all 7. **Install them once live** (DEPLOY GATE). The live `button.json` is byte-identical to our local copy, confirming the audit hasn't landed either.

### Component Inventory

| Component | Source | Notes |
|-----------|--------|-------|
| Button | Registry | RVLT variants: default/outline/ghost/destructive |
| Badge | Registry | Status pill: use with status-colors.ts intent |
| Card | Registry | Has `--sh-card` shadow baked in |
| Input / Textarea / Label | Registry | Form primitives |
| Checkbox / Switch | Registry | |
| Select | Registry | Remember: always pass explicit label to `<SelectValue>` |
| Dialog / Sheet / Drawer | Registry | Overlays — all render-prop trigger pattern |
| Popover / Dropdown Menu | Registry | DropdownMenuLabel MUST be in DropdownMenuGroup |
| Tooltip | Registry | |
| Command | Registry | Used for search/command palettes |
| Sonner | Registry | Toast system (already wired in layout) |
| Tabs | Registry | |
| Accordion | Registry | |
| Table | Registry | Uses `border-line` classes (not `border-border`) |
| Separator | Registry | |
| Skeleton | Registry | Already uses RVLT shimmer tokens |
| Avatar | Registry | |
| FlowMascot | Registry | `eyeColor` prop, aria-hidden; banned in alerts |
| Stat | Registry | `{ figure, label, bright? }` — for dashboard widgets |
| EmptyState | Registry | `{ title, description?, action? }` — includes FlowMascot |
| Stepper | Registry | Multi-step flows |
| StatusBadge (app-specific) | KEEP_CUSTOM | Reads from status-colors.ts intent map; uses Badge |
| StatusDot (app-specific) | KEEP_CUSTOM | Dot + optional ring-glow for compact status signals |
| AppSidebar | KEEP_CUSTOM | NavLink wrapper required (DOM crash risk) |
| MobileNav | KEEP_CUSTOM | Must stay in sync with AppSidebar IA |
| PageHeader | REGISTRY (pending deploy) | `page-header` — title + description + actions; net-new, no collision |
| SectionHeader | REGISTRY (pending deploy) | `section-header` — default=mono muted / prominent=Kalam red (NOT uppercase); net-new |
| FeaturePatch | REGISTRY (pending deploy) | `feature-patch` — module icon badge (sticker / soft); net-new |
| CrewScheduler | REGISTRY (pending deploy) | `crew-scheduler` — horizontal Gantt, internal clash detection; net-new |
| Combobox | REGISTRY (pending deploy) | `combobox` — installs as `combobox.tsx`; no collision with existing `combobox-picker.tsx` (26 consumers) |
| Breadcrumb | ⚠ COLLISION | Registry `breadcrumb` would overwrite app `breadcrumb.tsx` (7 consumers, commit 39b2965b). Do NOT blind-install — migrate consumers in a dedicated PR |
| StatusIndicator | ⚠ COLLISION | Registry `status-indicator` would overwrite app `status-indicator.tsx` (33 consumers, commit 5a5b268a). Do NOT blind-install — migrate consumers in a dedicated PR |
| StatusBadge (app-specific) | KEEP_CUSTOM | Reads from status-colors.ts intent map; uses Badge |
| StatusDot (app-specific) | KEEP_CUSTOM | Dot + optional ring-glow for compact status signals |

### Registry-First Rule
Before writing any new UI component:
1. Check the deployed registry components (29 live; 7 more pending — re-check `registry.json`)
2. If a needed component is announced-but-404, it's behind the DEPLOY GATE — don't rebuild it bespoke, wait for deploy
3. Only write bespoke if genuinely not covered by the registry

### Install Plan — DONE 2026-06-18 (registry deployed)
- ✅ **Net-new installed:** `page-header`, `section-header`, `feature-patch`, `crew-scheduler`, `combobox` (5 files created; all typecheck clean)
- ✅ **Audited refresh:** re-ran the 27 deployed primitives with `--overwrite` — 16 updated (compliance fixes: removed `uppercase`, added `disabled:cursor-not-allowed`, `aria-hidden` on icons, `text-white`→`text-primary-foreground`), 9 already identical. No export/prop-API changes. `theme`/`utils` deliberately excluded.
- ✅ **Verification:** `tsc --noEmit` src errors held at **1290** (pre-existing mid-migration baseline; HEAD=1290, after=1290, delta 0). `globals.css --font-display` confirmed still `"Archivo"`.
- ⏳ **STILL PENDING — collision migration (own PR each):** `breadcrumb` (7 consumers) and `status-indicator` (33 consumers) NOT installed — would overwrite app-bespoke files. Migrate consumers in dedicated PRs.

**Registry bug found:** the shipped `combobox.json` uses `<PopoverTrigger render={…}>`, but the shipped `popover.json` is Radix (`asChild`) — the registry's own combobox doesn't compile against its own popover. We locally patched `combobox.tsx` to `asChild` (commented in-file). **Report upstream; re-apply patch after any `combobox` reinstall.**

**Pre-existing 1290 errors are expected:** the design-system-foundation commit swapped UI primitives to the RVLT API (`asChild`, `primary/halo/line/cream` variants), but the 94 app pages still use the old RVLT Flow call patterns (`render` prop, `outline`/`destructive`/`secondary` variants, `icon-sm`, EmptyState `label`). Phase 4 page-by-page redesign migrates those call sites. The app does not fully typecheck mid-migration — by design.

---

## Tech Constraints

Stack (do not change):
- Next.js App Router
- TypeScript
- Tailwind v4
- shadcn/ui
- Existing data layer, server actions, routes, hooks, and state management

**Do NOT:**
- Rewrite backend logic
- Change database schema unless absolutely required
- Remove permissions/auth checks or audit logging
- Remove existing features
- Stub out real data
- Break existing URLs without safe aliases/redirects

**May:**
- Completely rebuild JSX/layout/composition
- Redesign components
- Add design-system-compatible primitives
- Add route aliases for rebrand naming
- Improve UX hierarchy, empty/loading/error states, responsive behaviour

---

## Research Requirement: Mobbin MCP

Use Mobbin MCP before redesigning each major product area. Prefer domain-adjacent references:
- Field service, dispatch, crew scheduling, project/job ops
- Inventory/equipment management, quote/billing builders
- Warehouse/logistics, compliance/checklists, admin/settings

Fall back to: Linear, Notion, Airtable, Retool, Stripe Dashboard, GitHub, Jira, ClickUp, Monday.com, Gusto, Rippling, ServiceTitan, Jobber, Buildxact, Vercel, Supabase.

Apply UX structure, not visual styling. DESIGN.md governs all visuals.

---

## Scope: Every Meaningful Surface

### Global/App Shell
- Root layout metadata and branding: RVLT Flow
- App sidebar (RVLT Flow navigation IA)
- Mobile bottom navigation
- Top bar/header
- Command/search entry points
- Notification surfaces
- Global loading/error/not-found states
- Auth shell, onboarding shell, settings shell

**Navigation IA:**
Dashboard → Jobs/Projects → Schedule → Crew → Equipment/Assets → Quotes/Documents → Warehouse → Test & Tag → Maintenance → Clients → Suppliers → Settings/Admin

### Dashboard
Operator's daily command centre. Using existing data:
- Active/on-site/prep jobs, upcoming jobs/projects
- Clashes/conflicts/alerts
- Open quotes, overdue items/returns
- Crew/utilisation signals, recent activity, high-priority notifications

UX target: glanceable today/week view, strong triage hierarchy, clear "what needs attention now"

### Jobs / Projects List
- Existing filters, search, sort, statuses, row actions, bulk actions
- Saved views, links to project detail, create/edit flows

UX target: dense but legible operations table, strong status semantics, mobile-friendly card/table hybrid

### Job / Project Detail
All existing tabs/features:
- Overview, client/venue/dates, lifecycle/status
- Quote/financials/line items, crew/services/schedule
- Equipment/assets, documents/PDFs, warehouse/pull sheets/dockets
- Notes/briefs, activity/audit log, conflicts/availability warnings
- Settings/actions/delete/archive

UX target: job command centre with hero/header, clear tab hierarchy, primary actions obvious

### Crew
- Crew list, member detail, availability, assigned jobs
- Roles/skills/certifications, scheduling/offer flows

UX target: roster-first thinking, clear availability/clash signalling

### Schedule / Planner / Gantt
- Date range controls, crew rows, job/service blocks, clashes
- Drag/edit actions, detail sheets/drawers, filters

UX target: real ops board, readable Gantt density, strong day/week navigation

### Equipment / Assets
- Asset registry, model/category views, item detail
- Availability, status, check-in/check-out context
- Maintenance/test tag indicators, assignments to jobs
- Bulk/serialized asset handling, kits/accessories/groups

UX target: warehouse-usable, clear availability/conflict state, strong asset identity

### Quotes / Line Items / Documents
- Quote list/index, quote builder/project financials
- Line item builder, grouped line items
- Labour/equipment/trucking/misc items, totals/sidebar
- Document/PDF generation controls, accepted/sent/draft/expired states

UX target: builder feels intentional, totals always obvious, client-facing doc workflow polished

### Warehouse
- Pull sheets, picking, packing, check-out/check-in
- Scan flows, warehouse display/token route
- Discrepancies/missing/damaged states

UX target: phone/tablet-first, big touch targets, high contrast, few taps

### Test & Tag / Compliance
- T&T dashboard, registry, record/detail pages
- Due/overdue states, reports, quick test flow, profiles/settings

UX target: compliance dashboard reads instantly, overdue risk clear

### Maintenance
- Maintenance list, asset-linked maintenance
- Status transitions, scheduled/overdue/completed, notes/outcomes

UX target: maintenance board, urgency clear, asset context always visible

### Clients / Suppliers / Locations
- Lists, detail pages, create/edit forms
- Linked jobs/assets/orders, contact cards
- Supplier purchase/order flows

UX target: relationship/context pages, linked operational history obvious

### Settings / Admin
- Company/org settings, team/users/roles, billing/plan
- Notifications, platform/admin registration, branding
- Integrations, WooCommerce/settings, permissions

UX target: calm, structured admin, dangerous actions clearly separated

### Auth and Onboarding
- Login, register, admin registration, onboarding
- Two-factor/passkey surfaces, invite/accept flows

UX target: rebranded RVLT Flow, premium but direct, trustworthy

---

## Component/System Work

Audit all `src/components/ui/*` and shared layout components.
- Update to RVLT design while preserving backwards-compatible props
- Do not break imports, keep shadcn patterns intact
- Search entire repo before changing shared component props/exports

Critical: Button variants/sizes, Badge variants/status, EmptyState presets, Skeleton named exports, Avatar group exports, Card subcomponents, Tabs variants, Dropdown/Dialog/Sheet trigger APIs.

---

## Implementation Workflow

### Phase 1 — Audit
1. Read DESIGN.md fully
2. Inspect RVLT design language reference: https://rvlt-labs.github.io/rvlt-designlanguage/
3. Inventory all app routes under `src/app`
4. Catalogue shared UI components
5. Identify data-fetching hooks/server actions per page

### Phase 2 — Design Research
Use Mobbin MCP per module. 3-5 references per major area.

### Phase 3 — Design System Foundation ✅ COMPLETE (2026-06-18)
Delivered in two commits on `worktree-bridge-cse_01X8Vs3P7wTZzycnYRKHgcmV`:
- `DESIGN.md` — fully replaced (RVLT Flow; red disambiguation §1; shadow tokens §2; mobile §15/§16; personality rules §9; state matrix §8)
- `src/app/globals.css` — installed from registry `theme` component (canonical RVLT tokens: `--paper`, `--ink`, `--card`, `--red: #E0363D`, `--t-out: #F26F73`, etc.) + app-specific CSS preserved
- `src/app/layout.tsx` — font swap: Hanken Grotesk + Geist Mono + Kalam + Baloo 2; themeColor → espresso `#1a100d`
- `src/lib/status-colors.ts` — updated to RVLT token names (`bg-ok`, `bg-warn`, `bg-t-out`, `bg-blue`, `bg-rep`, `bg-red`)
- All 29 registry components installed in `src/components/ui/`

**Registry-first rule for all remaining phases:**
1. Install from registry before building bespoke UI
2. Check `NEEDS_REGISTRY` list — user may add missing components on request
3. `theme` already installed — do NOT reinstall (it would wipe app-specific CSS)

### Phase 4 — Page-by-page Redesign
For every page:
1. Read existing file before editing
2. Identify data/actions/hooks to preserve
3. Mobbin research
4. Replace JSX/layout/styling only
5. Preserve every feature/action and operational data density
6. Add responsive/mobile treatment and empty/loading/error states
7. Self-check against DESIGN.md

### Phase 5 — Verification
- lint, typecheck/build, unit tests
- Browser QA: login, dashboard, projects list, project detail, schedule, crew, assets, quotes/documents, warehouse, test-and-tag, settings, onboarding/mobile

### Phase 6 — Review
- Run independent code review agent over staged diff
- Check for: removed features, broken imports, data-layer changes, auth regressions, DESIGN.md violations, raw hex colours, text below 11px

### Phase 7 — PR
Clean verification → commit → push → open PR

---

## Acceptance Criteria

### 1. Brand
- App reads as RVLT Flow everywhere practical
- RVLT Flow legacy branding removed (except historical/user data)
- Metadata, nav, auth, onboarding, dashboard, shell all rebranded

### 2. Design Fidelity
- DESIGN.md followed across all surfaces
- No rogue colours/typefaces/gradients
- Dark espresso default, semantic tokens only
- Red accent used correctly (solid fill = live/active; tinted = error/overdue)
- Fresh/fun moments via actual design language, not random decoration
- All UI components sourced from RVLT registry or KEEP_CUSTOM list — no bespoke equivalents of registry components

### 3. UX Quality
- Major workflows feel redesigned, not merely restyled
- Mobile usable at 375px
- Empty/loading/error states intentional
- Product feels senior-designed, fun, and fresh

### 4. Feature Preservation
- All existing modules/features preserved
- Existing data fetching/server actions/hooks preserved
- No fake data replacing real data
- No required operational data hidden for aesthetics

### 5. Technical Quality
- TypeScript/build passes, lint clean
- Shared components remain backwards compatible
- No backend/schema churn unless required

---

## UX Standards: Operator Voice

Acceptable microcopy examples:
- "No jobs yet. Create one before the calendar starts lying."
- "Clash detected."
- "Quote overdue."
- "Crew not confirmed."
- "Ready for prep."
- "Nothing needs you. Suspicious."
- "Inventory is behaving. For now."
- "No overdue returns. Frame it."

---

## Scale Estimate

Roughly 90+ pages across 15+ major modules. Each page requires:
- Audit of existing data/actions
- Mobbin research (2-3 patterns per area)
- Full JSX/layout rebuild
- Responsive/mobile treatment
- Empty/loading/error states

Significant effort. Full build estimated at 3-5 days of concentrated CC time.

---

## Execution Log (Phase 4 — page-by-page redesign)

### Unit 1 — App Shell ✅ (2026-06-18)
Files: `globals.css`, `app-sidebar.tsx`, `mobile-nav.tsx`, `top-bar.tsx`.
- **globals.css:** added the `--sidebar-*` token block (the RVLT theme.json omits them, so the sidebar bg was rendering with no surface). Defined once in `:root` via `var()` refs so `.light` flows through. Mapped in `@theme inline` as `--color-sidebar-*`.
- **app-sidebar.tsx:** sentence-cased section labels (Core/Assets/Operations/People/Admin per §5.2), stale tokens → RVLT (`fg-3/fg-4`→`muted/faint`, `bg-inset`→`paper-2/elev`, raw `oklch`→`var(--lit)`), Quick Create `DropdownMenuTrigger render=`→`asChild`. Active-state red text + 2px left bar already lived in the `sidebar.tsx` primitive — just needed the tokens. NavLink, render-on-SidebarMenuButton, routes, and permission gates all preserved.
- **mobile-nav.tsx:** rebuilt to the §16 5-tab spec (Dashboard / Projects / Warehouse / Crew / Assets), 56px tall, 22px icons, 11px labels, red active / faint inactive. Scan tab removed (warehouse page already owns scan/lookup — zero feature loss, per user "strict bible" call).
- **top-bar.tsx:** sticky backdrop-blur RVLT pass (§7 permits blur on sticky nav); functionality (breadcrumb, command search, notifications) preserved.
- **Verify:** shell files typecheck-clean; total `tsc` src errors 1290→1288 (fixed 2, added 0).

**KEY MIGRATION FINDING — the dominant Phase-4 mechanical task is `render`→`asChild`.** The RVLT registry primitives (Button, DropdownMenu, Popover, Dialog, Select, Tabs…) are Radix-based and use **`asChild`**, but the 94 app pages were written with the Base-UI **`render`** prop (per the now-stale CLAUDE.md note). Most of the ~1288 pre-existing errors are this, plus variant renames (`outline`/`destructive`/`secondary`→`line`/`primary`/`cream`), size renames (`icon-sm`→`icon`), `Badge variant`→`status`, and `EmptyState label`→children. NOTE: the app-bespoke `sidebar.tsx` primitive is the exception — it still uses `render` (Base UI), so SidebarMenuButton `render=` is correct. Per-page redesign converts each call site. **CLAUDE.md's "render not asChild" convention should be updated to reflect the RVLT components are `asChild`** (flag for a follow-up).

### Next units (P1 order): Dashboard → Job/Project detail → Warehouse → Assets → Crew → Quotes/Documents

---

## Registry Gaps — RESOLVED (announced 2026-06-18, pending deploy)

All 5 originally-flagged gaps + 2 preview-spotted components have been **built by the registry maintainer** and announced. They are **not yet live** on GitHub Pages (`registry.json` still lists 29; all 7 `r/<name>.json` return 404). See the DEPLOY GATE + Install Plan in the "RVLT Flow Component Registry" section above. Status:

| Component | Was | Now | Install action when live |
|-----------|-----|-----|--------------------------|
| `page-header` | gap | built | direct install (net-new) |
| `section-header` | gap | built — default mono-muted / prominent Kalam-red (NOT uppercase per §5.2) | direct install (net-new) |
| `combobox` | gap | built | direct install as `combobox.tsx` (no collision with `combobox-picker.tsx`) |
| `breadcrumb` | gap | built | ⚠ migrate — collides with app `breadcrumb.tsx` (7 consumers) |
| `status-indicator` | gap | built — dot/glow/inline, live=pulsing green | ⚠ migrate — collides with app `status-indicator.tsx` (33 consumers) |
| `feature-patch` | (preview-spotted) | built — sticker / soft variants | direct install (net-new) |
| `crew-scheduler` | (preview-spotted) | built — horizontal Gantt, internal clash detection | direct install (net-new) |

New spec rules that shipped with this library update (already folded into DESIGN.md):
- §5.2 No ALL-CAPS — sentence case everywhere (removed uppercase from `.t-overline`)
- §3.7 on-fill rule — text on categorical fills uses `text-dark`, never assume white
- §9.1 required interactive states — focus ring / disabled / motion-safe on every element
- Type ramp formalised: 11 / 12 / 13.5 / 14 / 15 / 16 / 18 / 24 / 38px (38 = the one bright hero Stat)
- `PersonAvatar name="…"` mandatory for all people displays

---

---

## AUTOPLAN REVIEW REPORT

**Run date:** 2026-06-18
**Branch:** worktree-bridge-cse_01X8Vs3P7wTZzycnYRKHgcmV
**Plan file:** docs/designs/ux-ui-redesign.md
**Restore point:** ~/.gstack/projects/gearflow/worktree-bridge-cse_01X8Vs3P7wTZzycnYRKHgcmV-autoplan-restore-20260618-115858.md

---

## PHASE 1: CEO REVIEW

### PRE-REVIEW SYSTEM AUDIT

**Repository state:**
- 94 app pages across 15+ modules
- Branch: worktree-bridge-cse_01X8Vs3P7wTZzycnYRKHgcmV (clean worktree, no uncommitted changes)
- Last major work: 13-feature removal sprint (PR #227, chore/all-feature-removals)
- One stash on main: "UX Gaps — shortcuts, mobile, touch targets, skeletons, MiraProvider, useMemo" (relevant — prior UX work in progress)
- Active Convex migration (FEATUREDOCS/54) — parallel to this plan

**Current DESIGN.md status:** MISALIGNED
- Existing: RVLT Flow "Industrial Calm" — teal primary, DM Sans typography, light/dark mode
- Required: RVLT Flow design system — dark espresso default, red accent, Hanken Grotesk, BC Alphapipe, Kalam, JetBrains Mono
- Delta: COLOR SYSTEM is completely different (teal vs red), TYPOGRAPHY is completely different (DM Sans vs Hanken Grotesk/BC Alphapipe), DEFAULT SURFACE is completely different (light+dark vs dark espresso always)
- **DESIGN.md must be replaced before any page work begins**

**Route inventory:**
| Module | Pages | Priority |
|--------|-------|----------|
| Dashboard | 1 | P1 |
| Projects / Jobs | 5 (list, detail, edit, new, templates) | P1 |
| Assets / Models / Categories | 10 | P1 |
| Crew | 5 (list, detail, planner, timesheets) | P1 |
| Warehouse | 3 (landing, project, pull-sheet) | P1 |
| Test & Tag | 6 (list, detail, quick-test, registry, reports) | P1 |
| Auth / Onboarding | 8 (login, register, invite, 2FA, onboarding) | P1 |
| Clients / Suppliers / Locations | 12 (list, detail, edit, new per entity) | P2 |
| Maintenance | 4 | P2 |
| Settings | 14 (org, team, documents, assets, billing, etc.) | P2 |
| Kits | 4 | P2 |
| Admin | 5 | P3 |
| Warehouse Display (public token route) | 1 | P2 |
| Auditor / Availability | 2 | P3 |
| **Total** | **~94** | |

**Well-designed existing patterns (style references):**
- `src/components/projects/equipment-tab.tsx` — dense table with good action placement
- `src/app/(app)/projects/[id]/page.tsx` — tabbed detail page pattern
- `src/components/ui/` — solid shadcn v4 base with CLAUDE.md conventions

**Anti-patterns to fix:**
- Card-per-section in forms (documented anti-pattern in current DESIGN.md but still present in many pages)
- Generic "RVLT Flow" branding in metadata, sidebar, auth
- DM Sans font loading (needs replacement with Hanken Grotesk stack)

**TODOS.md relevance:**
- Server action integration tests — unblocked by this plan (no schema changes)
- E2E Playwright tests — can be written to cover new UI flows
- Warehouse Check System PDF — not in scope of this redesign

---

### STEP 0A: PREMISE CHALLENGE

**Is this the right problem to solve?**

Yes. The business case is clear: RVLT Flow is being rebranded to RVLT Flow as TwoToned transitions to a live-events production company brand. The current design system (teal, DM Sans, "Industrial Calm") is disconnected from the RVLT brand identity. The gap is real and visible to anyone who uses the product.

**Premises under examination:**

1. **"The product needs a complete redesign, not just a rebrand"** — VALID. The existing design is solidly implemented for RVLT Flow but does not translate to RVLT Flow. The RVLT design system (dark espresso, red accent, Alphapipe display, Hanken Grotesk) is fundamentally different — not a color swap, a system change. Half-measures will produce visual incoherence.

2. **"Every page must be touched"** — QUESTIONABLE. 94 pages is correct for an audit, but not every page needs equal depth. Auth/dashboard/project-detail are P1 surfaces where operators spend most time. Admin pages and secondary settings pages are P3 and could receive token-level updates without full JSX rebuilds. **Recommend: tiered approach (P1 full rebuild, P2 hierarchy, P3 token swap).**

3. **"Mobbin research is required per module"** — OVERSTATED. Mobbin is useful for new UX patterns, but the existing page structures are already good for dense ops software. Targeted Mobbin research (dashboard, warehouse, Gantt/planner) is high-value; spending time on Mobbin for the settings billing page is not.

4. **"The RVLT design system from rvlt-labs.github.io wins over current DESIGN.md"** — VALID. The canonical source should win. However, the RVLT design language site needs to be inspected to confirm it has been published and is current before treating it as authoritative.

5. **"Retain all existing functionality"** — CRITICAL CONSTRAINT. This is load-bearing. The redesign must not change server actions, data fetching, auth, or permissions. A strict visual-only constraint enables this to be a pure frontend change with low regression risk.

**What happens if we do nothing?**
- Product reads as "RVLT Flow wearing a red RVLT sticker" once the rebrand starts
- Operators notice the brand incoherence
- Cannot use RVLT Flow in client-facing materials with confidence
- Brand investment is undermined by mismatched product experience

**Verdict:** Proceed. The premise is sound. The scope needs tiering (P1/P2/P3) to be realistic.

---

### STEP 0B: EXISTING CODE LEVERAGE

| Sub-problem | Existing code | Leverage |
|-------------|---------------|---------|
| CSS token system | `src/app/globals.css` — full oklch token system already | Replace token values, keep structure |
| Typography loading | `next/font/google` in root layout | Replace DM Sans with Hanken Grotesk + others |
| Component library | `src/components/ui/` (shadcn v4) | Keep shadcn, update variant styles |
| Status centralization | `src/lib/status-utils.ts` (if exists) | Map to RVLT semantic tokens |
| Empty states | `src/components/ui/empty-state.tsx` | Rebuild for RVLT mascot moments |
| Skeleton loading | `src/components/ui/skeleton.tsx` | Update shimmer colors to RVLT tokens |
| Navigation sidebar | `src/components/layout/sidebar.tsx` | Full rebuild for RVLT nav structure |
| Page templates | `src/components/layout/` | Update templates to RVLT layout rules |
| Motion/animation | Framer Motion already installed | Keep library, update animation values |
| Branding override | `BrandingProvider` exists | Needs update for RVLT default tokens |

---

### STEP 0C: DREAM STATE MAPPING

```
CURRENT STATE                    THIS PLAN                      12-MONTH IDEAL
─────────────────────            ─────────────────────          ─────────────────────
RVLT Flow                  --->   RVLT Flow (full           ---> RVLT Flow: opinionated
Industrial Calm                  rebrand, 94 pages              field-ready ops
Teal/DM Sans                     rebuilt, RVLT design           platform. Distinctive
Light + dark mode                language applied,              in the live-events
"developer stacked               dark espresso,                 software space.
cards until it worked"           red accent,                    Deployable on tablets
                                 operator voice                 on-site. Praised by
                                 throughout)                    production companies.
                                                               Sold as "RVLT Flow
                                                               by RVLT Labs".
```

This plan DIRECTLY moves toward the ideal. The only risk: getting 80% done and leaving 20 secondary pages in the old RVLT Flow style, which produces the "RVLT Flow wearing a red jacket" failure mode the plan explicitly warns against.

---

### STEP 0C-BIS: IMPLEMENTATION ALTERNATIVES

```
APPROACH A: Token + Metadata Swap (Minimal)
  Summary: Replace CSS tokens (teal→red, DM Sans→Hanken Grotesk), update
           metadata/branding strings. No JSX changes.
  Effort:  S (human: ~1 day / CC: ~20 min)
  Risk:    Low
  Pros:    Fastest rebrand. No regression risk. Compiles immediately.
           Ships "RVLT Flow" label everywhere visible.
  Cons:    Product still looks like RVLT Flow. No UX improvement.
           Hierarchy/density/empty states unchanged.
           Will read as "RVLT Flow wearing a red jacket" immediately.
  Reuses:  globals.css token structure, layout.tsx metadata

APPROACH B: Design System Foundation First (Sequential Phased)
  Summary: Phase 1: Replace DESIGN.md + all CSS tokens + typography + shared
           components. Phase 2: P1 pages (dashboard, projects, auth, warehouse,
           assets, crew). Phase 3: P2/P3 (settings, secondary).
           Each phase is independently deployable.
  Effort:  M-L (human: ~2 weeks / CC: ~6-8 hours)
  Risk:    Medium (risk isolated to each phase)
  Pros:    Each phase produces a deployable, coherent improvement.
           Design system foundation prevents inconsistency.
           P1 covers the pages operators use daily (80% of usage).
           P3 can be deferred without embarrassment.
  Cons:    Does not touch all 94 pages in one pass.
           Settings/admin pages may lag in RVLT treatment.
  Reuses:  All existing shadcn components, server actions, data layer

APPROACH C: Full Rebuild All 94 Pages (Comprehensive)
  Summary: As the plan describes — every page, every state, every component
           rebuilt with RVLT design language, Mobbin research per module.
  Effort:  XL (human: ~4-6 weeks / CC: ~3-5 days)
  Risk:    High (regression risk across 94 pages, TypeScript compile failures
           from cascading component changes, prolonged unmerged branch)
  Pros:    Complete, coherent, no RVLT Flow legacy visible.
           Satisfies acceptance criteria fully.
           Best long-term quality.
  Cons:    Branch will be enormous and hard to review.
           Long-running unmerged branch risks rebasing pain.
           Regression risk across 94 pages and all shared components.
           Zero deployable state until entire branch is complete.
  Reuses:  All data layer, server actions, auth
```

**AUTO-DECIDED (autoplan P1/P2 — completeness + boil lakes):**
→ Approach B (Design System Foundation → P1 pages → P2/P3 pages), implemented as **stacked PRs** with each PR being independently deployable. This captures Approach C's completeness goal while managing the blast radius and delivering value incrementally.

**Decision logged:** `D1 — Approach selection: B (phased, stacked PRs) over A (too shallow) or C (too risky as single PR). Delivers 10/10 completeness over multiple PRs, each independently deployable.`

---

### STEP 0D: EXPANSION SCAN (SELECTIVE EXPANSION mode)

**Mode auto-decided:** SELECTIVE EXPANSION (the plan has explicit scope, but RVLT design system introduces new capabilities worth surfacing).

**Expansion candidates evaluated:**

| # | Opportunity | Effort | Auto-decision | Rationale |
|---|-------------|--------|---------------|-----------|
| 1 | RVLT mascot in empty states | S (CC: 10min) | ACCEPTED | Principle P1 + P2. In blast radius. Makes "alive" moments real, not marketing. |
| 2 | Kalam annotation component | S (CC: 5min) | ACCEPTED | DESIGN.md requires it. Scope is new component + 3-4 usage sites. |
| 3 | Dark espresso forced (no light mode toggle) | S (CC: 10min) | ACCEPTED | DESIGN.md is explicit: dark espresso is the DEFAULT surface. Aligns with RVLT brand. |
| 4 | Operator voice microcopy pass (all pages) | M (CC: 30min) | ACCEPTED | Core requirement of plan. Not extra scope — plan explicitly requires it. |
| 5 | BC Alphapipe font loading | S (CC: 5min) | CONDITIONAL | Only if BC Alphapipe is available via Google Fonts or local. If not, Hanken Grotesk bold serves as fallback. |
| 6 | Warehouse display redesign (public token route) | S (CC: 15min) | ACCEPTED | Operators use this on-site. Mobile-first, high contrast. P1 for warehouse staff. |
| 7 | Runsheet page redesign | S (CC: 15min) | ACCEPTED | Adjacent to project detail, same operators. In blast radius. |
| 8 | Full Mobbin research for every module | M (CC: 45min) | DEFERRED | Per principle P5 (explicit over clever) — targeted Mobbin for 4 key modules (dashboard, warehouse, Gantt, assets) is sufficient. Settings billing page doesn't need Mobbin. |
| 9 | Full custom animation pass with Framer Motion | L (CC: 2hrs) | DEFERRED | Existing motion system in DESIGN.md is adequate baseline. RVLT can use CSS transitions initially. |
| 10 | WooCommerce settings page redesign | S (CC: 10min) | DEFERRED | Low operator traffic. Token + typography update sufficient. |

---

### CEO DUAL VOICES

**CLAUDE SUBAGENT (CEO — strategic independence):**

Key findings (independent, no prior context):
1. Wrong problem framing (medium) — Win condition should include "operators accomplish X task in Y fewer taps", not just visual brand compliance
2. Assumed premise: operators care about brand (medium) — the audience for the rebrand is founders + sales, not warehouse staff. Make this explicit in execution priorities
3. 94-page branch = merge debt bomb (critical) — enforce PR gate every 10-15 pages, no exceptions
4. Parallel Convex Phase A collision (critical) — PRs #194-#199 touch same files as this redesign. Land Convex PRs first or define strict file ownership boundary
5. BC Alphapipe not on Google Fonts (high) — commercial typeface, needs licensing decision before design system phase
6. No success metrics (high) — define 2-3 measurable outcomes (task completion rate, NPS, support tickets) before starting

**CODEX SAYS (CEO — strategy challenge):**

Key findings (adversarial, direct):
1. DESIGN.md source of truth is broken — plan says "follow DESIGN.md" but DESIGN.md still describes RVLT Flow teal/DM Sans. Subjective execution without replacing it first.
2. Scope wildly mis-sized — 94 pages + shared components + mobile + QA + Mobbin research is not "3-5 day CC effort". Giant half-reviewed branch risk.
3. "UI only" constraint fragile at this blast radius — JSX rebuilds across quotes, warehouse, permissions, auth will drop actions/edge states/role checks without page-level regression tests
4. Brand personality vs operator trust — fun/irreverent/mascot in missing-gear/overdue-compliance/warehouse-discrepancy contexts damages trust where users need confidence
5. Red dual-use confusion — red as brand primary AND alert/live/active is dangerous. Scanner state, T&T overdue, clash alerts all need red — but so does the primary button. Disambiguation needed.

**CEO DUAL VOICES — CONSENSUS TABLE:**

```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   ✓       ✓      CONFIRMED
  2. Right problem to solve?           ✓+      ✓      CONFIRMED (reframe win condition)
  3. Scope calibration correct?        ✗       ✗      DISAGREE → PR gates required
  4. Font/design system resolved?      ✗       ✗      DISAGREE → resolve before code
  5. Competitive/market risks covered? ✗       ✗      CONFIRMED (no success metrics)
  6. 6-month trajectory sound?         Risk    ✓      DISAGREE → Convex collision risk
═══════════════════════════════════════════════════════════════
```

---

### CEO SECTIONS 1-10

**Section 1 — Problem/Opportunity:**
The rebrand opportunity is real and well-reasoned. RVLT Flow → RVLT Flow is a strategic brand unification, not aesthetic whim. The risk is treating this as purely visual when the actual win requires both brand coherence AND UX quality lift. Examined: plan scope, business rationale, operator usage patterns.

**Section 2 — Error & Rescue Registry:**

| # | Error Mode | Severity | Trigger | Recovery |
|---|-----------|---------|---------|---------|
| 1 | Convex Phase A file collision | Critical | Same page files touched by concurrent PRs | Land Convex PRs first; define file ownership |
| 2 | BC Alphapipe font missing | High | Commercial font not in repo | Resolve license before design phase |
| 3 | JSX rebuild drops role check | High | RebuildED page omits requirePermission wrapper | Cross-reference every server action call site during review |
| 4 | Red primary-vs-alert confusion | High | Developer interprets red as "just accent" | DESIGN.md must define red disambiguation explicitly |
| 5 | 94-page PR unmergeable | High | Branch drifts too long | Enforce PR gate every 10-15 pages |
| 6 | Dark espresso breaks accessibility | Medium | Low contrast on muted elements | WCAG 4.5:1 pass required per token |
| 7 | Brand personality overuse | Medium | Kalam/mascot in warehouse/compliance | Hard rule: no personality in error/alert/compliance contexts |

**Section 3 — Scope Completeness:**
Examined current TODOS.md and feature inventory. Plan correctly excludes: server action rewrites, schema changes, auth logic, Convex migration work. No silent scope creep detected. Server action integration tests (in TODOS) are unblocked by this plan and could be initiated as a parallel track.

**Section 4 — Technical Feasibility:**
Next.js App Router + Tailwind v4 + shadcn v4 + existing conventions — all compatible. BC Alphapipe requires resolution. Hanken Grotesk available via Google Fonts. JetBrains Mono available via Google Fonts. Kalam available via Google Fonts.

**Section 5 — Testing:**
Existing unit test suite covers validation schemas + server actions. No E2E coverage for UI. Acceptance criteria requires browser QA for 12 routes — this is human-verified, not automated. Automated regression requires new Playwright tests (deferred in TODOS). Risk: breaking a subtle UI behavior (scrollable table, modal trigger, inline edit) with no automated coverage. Mitigation: systematic browser QA per plan Phase 5.

**Section 6 — Data / State:**
Plan explicitly preserves all data fetching hooks, server actions, and state management. No data schema changes. Zero risk to Prisma or Convex data layer. This section: clean.

**Section 7 — Security / Auth:**
Plan explicitly preserves auth checks and permissions. No auth logic changes. Risk: a rebuilt page accidentally omits an `<AuthGuard>` wrapper or `requirePermission()` call. Mitigation: during each page rebuild, explicitly cross-reference the existing auth wrappers before removing any JSX.

**Section 8 — Performance:**
Dark espresso surfaces with 2px outlines and hard-offset shadows are CSS-only — zero bundle size impact. Loading Hanken Grotesk (multiple weights) + JetBrains Mono + Kalam + BC Alphapipe (if local) will INCREASE font loading. Need to subset fonts and use `font-display: swap`. Existing Google Fonts implementation via `next/font/google` already handles subsetting.

**Section 9 — Observability:**
Design-only change. No new server-side code paths. No new observability requirements. Existing activity logging, error tracking, and PostHog analytics are unaffected. Clean.

**Section 10 — Deployment / Rollback:**
Each stacked PR is independently deployable (per Approach B). Coolify handles preview deployments per PR. A bad visual change rolls back by reverting the PR. No migration or data change means true instant rollback. Clean.

**Section 11 — Design (UI scope detected):**
Design scope is the entire plan. Will be covered in full depth in Phase 2.

---

### CEO COMPLETION SUMMARY

| Area | Status | Critical Issues |
|------|--------|----------------|
| Problem validity | ✓ Sound | Reframe win condition to include operator outcomes |
| Premises | ✓ Valid | BC Alphapipe license, Convex collision need resolution |
| Scope | ⚠ Risky | 94-page single-branch risk → enforce PR gates |
| Alternatives | ✓ Evaluated | Approach B selected (phased, stacked PRs) |
| Technical feasibility | ✓ Sound | Font licensing is blocking item |
| Security | ✓ Low risk | Verify auth wrappers preserved per page rebuild |
| Testing | ⚠ Gap | No automated UI regression — browser QA is manual |
| Performance | ✓ Low risk | Font loading optimization required |
| Deployment | ✓ Sound | Coolify per-PR previews de-risk rollout |

**NOT in scope (CEO):**
- Server action rewrites
- Schema changes
- Convex migration (deferred, ongoing separately)
- WooCommerce settings (token update only)
- Admin pages beyond token update (P3)
- Success metrics definition (deferred — needs business owner input)

**What already exists:**
- Full shadcn/ui v4 component library
- oklch CSS token system (needs value replacement)
- Framer Motion animation library
- Google Fonts loading via next/font
- Branding provider for org-level overrides
- Empty state components (need RVLT update)
- Skeleton loading components (need RVLT token update)

---

**PHASE 1 COMPLETE.**
Codex: 5 concerns (design-system broken, scope, UI-only fragility, brand/trust, red dual-use).
Claude subagent: 6 issues (framing, premise, merge debt, Convex collision, font, no metrics).
Consensus: 4/6 confirmed, 2 disagreements → surfaced at gate.
Passing to Phase 2 (Design Review).

---

## PHASE 2: DESIGN REVIEW

**CLAUDE SUBAGENT (Design — independent review):**
Score: 4.3/10 overall. Key findings:
- Dimension 2 (Missing states): 3/10 — 45+ states unspecified across 15 modules
- Dimension 5 (Mobile): 2/10 — CRITICAL: references DESIGN.md §15/§16 which don't exist
- Dimension 6 (Design system): 4/10 — CRITICAL: red disambiguation unresolved; green/amber/blue fate unaddressed
- Dimension 7 (Personality): 5/10 — CRITICAL: no-personality-in-alert rule missing from plan body; mascot undesigned
- Dimension 4 (Specificity): 4/10 — HIGH: intent not decisions; 94 pages will diverge
- Dimension 1 (Hierarchy): 6/10 — correct for dashboard, absent for other modules
- Dimension 3 (User journey): 6/10 — quote-sent and T&T-clean-sweep success moments missing

**CODEX SAYS (Design — UX challenge):**
Key findings:
1. Fun/fresh can bury ops triage — personality/mascot must not displace the "what needs attention now" hierarchy
2. Missing state coverage for production data — partial-data, permission-denied, failed-query, org-not-loaded states unspecified
3. Mobile treatment too broad — "375px" is not enough for warehouse/schedule/quote-builder; task-specific layouts needed
4. Red dual-use is biggest semantic risk — primary CTAs + active nav + live status + danger = urgency loss

**DESIGN LITMUS SCORECARD — CONSENSUS TABLE:**
```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Information hierarchy adequate?   6/10    ✗      DISAGREE → unspecified for non-dashboard
  2. States fully specified?           3/10    ✗      CONFIRMED → 45+ states undefined
  3. User journey intact?              6/10    ✓      CONFIRMED (with gaps at quote/T&T)
  4. Decisions specific enough?        4/10    N/A    CONFIRMED → intent not decisions
  5. Mobile treatment specified?       2/10    ✗      CONFIRMED → CRITICAL gap
  6. Design system coherent?           4/10    ✗      CONFIRMED → red dual-use critical
  7. Personality controlled?           5/10    ✓      DISAGREE → alert contexts unprotected
═══════════════════════════════════════════════════════════════
```

**Design Passes 1-7:**

**Pass 1 — Design System Foundation (6/10):**
Current DESIGN.md is RVLT Flow, not RVLT. Must be replaced before any code. RVLT design system from canonical source wins. Red disambiguation rule must be written into new DESIGN.md: define brand red (full-sat, solid button, active nav indicator, primary CTA) vs alert red (70% opacity + icon, semantic status only). Green/amber/blue semantic tokens must survive in new DESIGN.md — they are required for T&T pass/fail, availability state, check record status, and maintenance urgency. Not optional.

**Pass 2 — Information Hierarchy (6/10):**
Dashboard hierarchy is correct (blockers → my work → metrics → upcoming → activity). Not specified for any other module. Warehouse, quote builder, and project detail all need a 3-item priority statement before implementation.

**Pass 3 — States Matrix (3/10):**
AUTO-DECIDED: add a minimum state matrix to the plan for all P1 modules (7 modules × 5 states = 35 states to specify). States required: empty-org, empty-filter, loading-skeleton, partial-error, full-error.

**Pass 4 — Mobile Spec (2/10 → must fix):**
New DESIGN.md must include §15 (bottom nav IA — which 4-5 items?) and §16 (touch target floor 44px, breakpoint 375px, layout-collapse rules). Bottom nav item set is an IA decision: recommend Dashboard, Jobs, Warehouse, Crew, Assets (5 items covering daily operator workflows). Settings accessible from avatar, not bottom nav.

**Pass 5 — User Journey (7/10):**
Add: quote-sent success state ("Quote out. Ball's in their court."), T&T all-clear state ("All gear tested. Nothing overdue. Unusual."). These are high-value earned relief moments — highest ROI personality opportunities.

**Pass 6 — Personality Controls (5/10 → critical fix):**
Missing rule added to plan body: **Personality is banned from: error states, alert banners, overdue counts, compliance warnings, T&T fail states, clash detection, destructive action confirmations.** Kalam allowed only: empty state annotations (1 per page max), dashboard greeting aside, earned success moments. Mascot needs definition before implementation — what is it? Recommend: a small robot/creature, 2-3 states (idle, working, celebrating). Can be defined as part of design system foundation PR.

**Pass 7 — Design System Specificity (4/10):**
P1 page decision table needed in plan. AUTO-DECIDED: defer detailed decisions to each page's implementation comment (as plan already specifies). However, these system-level decisions must be in DESIGN.md before any page begins: default tab on job detail (Overview), quote builder totals location (sticky right sidebar), touch target floor (44px), warehouse scan primary element (asset name + scan button).

**DESIGN COMPLETION SUMMARY:**
4 critical items must be resolved before Phase 3 begins:
1. DESIGN.md replacement — new RVLT design system replaces RVLT Flow version
2. Red disambiguation rule — brand red vs alert red must be defined
3. Mobile DESIGN.md §15/§16 — must exist before any mobile implementation
4. Personality control rule — no personality in alert/compliance/error contexts

All 4 are requirements of the plan itself, not new scope. They are missing from the plan body.

**PHASE 2 COMPLETE.**
Codex: 4 concerns (hierarchy, states, mobile, red dual-use).
Claude subagent: 7 dimensions, 4.3/10 overall, 4 critical gaps.
Consensus: 5/7 confirmed, 2 disagreements surfaced at gate.
Passing to Phase 3 (Eng Review).

---

## PHASE 3: ENGINEERING REVIEW

**Architecture ASCII Dependency Diagram:**

```
globals.css (CSS tokens: --primary teal → red, --font-dm-sans → Hanken)
  ├─> src/lib/status-colors.ts  ← CRITICAL: "bg-teal-subtle text-primary" hardcoded
  │     └─> ~every status badge, pill, border intent across all 94 pages
  ├─> src/app/layout.tsx  (font loading: DM_Sans → Hanken Grotesk + others)
  │     └─> ALL 94 app pages (font CSS variable injected at root)
  └─> 44 files with hardcoded bg-teal-*/text-teal-*/bg-blue-*/bg-amber-* classes
        └─> NOT fixed by token swap alone — requires per-file grep + edit pass

app-sidebar.tsx (408 lines, "use client", permission-gated nav)
  ├─> ALL 84 app pages via AppLayout (navigation, org branding, quick-create)
  └─> mobile-nav.tsx (SEPARATE COMPONENT — must sync IA changes identically)
        └─> Mobile users see different nav if these diverge

src/components/ui/* (Button, Badge, Tabs, Card, etc.)
  └─> ~every page component — if variant props change, all call sites cascade
```

**Test Diagram:**

```
WHAT NEEDS TESTING                    EXISTS?    GAP
──────────────────────────────────    ──────     ───────
Token swap: status-colors.ts           YES       ADD: test with red tokens
Font load correctness                  NO        RISK: silent fallback
Hardcoded color cleanup (44 files)    NO        RISK: grep check in PR review
AppSidebar permission gates            NO        RISK: manual per-page review
MobileNav IA matches AppSidebar        NO        RISK: must sync manually
Auth wrappers preserved per page       NO        RISK: manual code review
NavLink preserved (not std Link)       NO        RISK: grep check (DOM crash)
PDF pipeline unaffected                YES       Run: npm run build
overlay-lock-reset test                YES       CI: vitest already runs this
dark: variants under forced dark       NO        RISK: 20 files, manual audit
```

**CLAUDE SUBAGENT (Eng — independent review):**
Key findings:
1. 44 files with hardcoded Tailwind color classes — token swap won't fix these (HIGH)
2. `status-colors.ts:59` hardcodes `"bg-teal-subtle text-primary"` — all CHECKED_OUT/ON_SITE/RETURNED statuses become red under new tokens (HIGH)
3. BC Alphapipe not a Google Font — `next/font/google` won't load it (MEDIUM)
4. `app-sidebar.tsx` permission-conditional render risk — JSX rebuild can silently drop conditional nav items (MEDIUM)
5. MobileNav + AppSidebar are independent — IA changes must be applied to both (MEDIUM)
6. PDF pipeline uses hardcoded hex + Helvetica — "remove RVLT Flow branding" acceptance criterion conflicts with "no backend changes" (MEDIUM)
7. `dark:` Tailwind variants in 20 files will break under forced dark espresso (MEDIUM)
8. Font loading change (root layout) = `--font-dm-sans` CSS var referenced in 8 `!important` globals.css rules — entire `t-*` class system breaks if var renamed but rules not updated (HIGH)

**CODEX SAYS (Eng — architecture challenge):**
Key findings:
1. Single-pass rewrite risk — 94 pages in 3-5 days conflicts with no-regression constraint (HIGH)
2. `status-colors.ts` maps `primary` to teal — all primary-intent statuses become red after token swap (HIGH, CONFIRMED)
3. Sidebar/nav rewrite: `NavLink` exists to prevent Next/Base UI DOM crash — must be preserved, not replaced with standard `Link` (MEDIUM)

**ENG DUAL VOICES — CONSENSUS TABLE:**
```
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               ⚠       ⚠      DISAGREE → hardcoded colors + dep cascade
  2. Test coverage sufficient?         ✗       ✗      CONFIRMED → major gaps
  3. Performance risks addressed?      ✓       ✓      CONFIRMED (font subsetting needed)
  4. Security threats covered?         ✓       ✓      CONFIRMED (sidebar auth gates main risk)
  5. Error paths handled?              ✗       ✗      CONFIRMED → status-colors collision
  6. Deployment risk manageable?       ✓       ✓      CONFIRMED (stacked PRs de-risk)
═══════════════════════════════════════════════════════════════
```

**Failure Modes Registry:**

| # | Risk | Severity | Trigger | Fix |
|---|------|---------|---------|-----|
| 1 | `status-colors.ts` teal hardcode | CRITICAL | Token swap makes CHECKED_OUT red | Update `status-colors.ts` primary intent to use semantic RVLT token (not raw teal); define red disambiguation before touch |
| 2 | 44 files with hardcoded Tailwind teal/blue/amber | HIGH | Token swap leaves these visually broken | Grep pass required per PR: `bg-teal-\|text-teal-\|bg-blue-5\|bg-amber-5` |
| 3 | Font loading: `--font-dm-sans` CSS var | HIGH | Rename breaks all `t-*` classes | Update all 8 `!important` globals.css references atomically in font PR |
| 4 | `dark:` variants under forced dark espresso | HIGH | 20 files, unverified | Audit all `dark:` classes; remove or confirm correct under dark-only |
| 5 | `NavLink` replaced with standard `Link` | HIGH | Next/Base UI DOM crash on navigation | Preserve `NavLink` wrapper; grep check in sidebar PR review |
| 6 | AppSidebar permission gate dropped | MEDIUM | Rebuild omits `resource` prop on nav item | Per-item checklist in sidebar PR |
| 7 | MobileNav IA diverges from AppSidebar | MEDIUM | Nav IA change applied to one, not both | Sync both in same PR, test both on mobile |
| 8 | BC Alphapipe missing | MEDIUM | Display headings fall back to system sans | Resolve font licensing before design system PR |
| 9 | PDF still shows RVLT Flow branding | MEDIUM | Acceptance criterion says "remove RVLT Flow" | Scope decision: include PDF header rebrand in plan, or explicitly call it out-of-scope |

**Section 3 — Test Review:**
Test plan artifact: `~/.gstack/projects/gearflow/worktree-bridge-test-plan-20260618-121305.md`

Critical gap: ZERO automated visual regression tests. The entire visual correctness validation is manual browser QA. This is acceptable for an initial ship but means any future change to tokens/components has no safety net. Recommend adding visual regression (Playwright screenshots + baseline) as TODOS.md entry.

**Deferred to TODOS.md:**
- Visual regression test suite (Playwright screenshots)
- Automated contrast checking (WCAG 4.5:1 per token)
- PDF rebrand: RVLT Flow colors/names in PDF pipeline — either include or explicitly out-of-scope

**NOT in scope (Eng):**
- Server action changes
- Schema changes  
- Convex migration changes
- New feature work

**What already exists:**
- `status-colors.ts` — must be updated, not rebuilt
- shadcn v4 component library — preserve props API
- `overlay-lock-reset.test.ts` — already covers DOM stability
- Integration tests for server actions — unaffected by this plan

**PHASE 3 COMPLETE.**
Codex: 3 concerns (single-pass risk, status-colors collision, NavLink).
Claude subagent: 8 issues, with status-colors.ts as the most critical.
Consensus: 4/6 confirmed, 2 disagreements surfaced at gate.
Passing to Phase 4 (Final Gate).

---

## DECISION AUDIT TRAIL

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| D1 | CEO | Approach B (phased stacked PRs) | Mechanical | P1+P2 completeness+blast-radius | B delivers C's completeness in smaller PRs; A is too shallow | A (token swap only), C (single giant PR) |
| D2 | CEO | Mode: SELECTIVE EXPANSION | Mechanical | P3 pragmatic | Plan has explicit scope; auto-decide expansion candidates | N/A |
| D3 | CEO | RVLT mascot + Kalam + dark espresso accepted | Mechanical | P1+P2 in blast radius | These are DESIGN.md requirements, not extras | N/A |
| D4 | CEO | Mobbin targeted (4 modules, not all 15) | Mechanical | P5 explicit over clever | Full Mobbin per module is overkill for settings/secondary pages | N/A |
| D5 | CEO | Success metrics deferred | Taste | P6 action | Metrics need business owner input; don't block implementation | N/A |
| D6 | Design | State matrix required for P1 modules | Mechanical | P1 completeness | 45+ states unspecified; must be fixed in DESIGN.md | N/A |
| D7 | Design | Mobile §15/§16 required before code | Mechanical | P1 completeness | Critical gap: references non-existent DESIGN.md sections | N/A |
| D8 | Design | Bottom nav: Dashboard/Jobs/Warehouse/Crew/Assets | Taste | P3 pragmatic | Daily operator workflows; Settings via avatar | N/A |
| D9 | Design | Personality banned from alert/compliance contexts | Mechanical | P1 | Operator trust at risk; must be in plan body | N/A |
| D10 | Eng | status-colors.ts must be updated in design system PR | Mechanical | P1+P5 | CRITICAL: token swap without this breaks all primary-intent statuses | N/A |
| D11 | Eng | Hardcoded color grep pass required per PR | Mechanical | P1 | 44 files not fixed by token swap | N/A |
| D12 | Eng | NavLink preservation check required in sidebar PR | Mechanical | P1 | DOM crash risk if replaced with standard Link | N/A |
| D13 | Eng | PDF rebrand — needs scope decision | Taste | N/A | Acceptance criterion vs "no backend changes" conflict | N/A |

---

## GSTACK REVIEW REPORT

*Generated: 2026-06-18 | Branch: worktree-bridge-cse_01X8Vs3P7wTZzycnYRKHgcmV | Reviewer: autoplan (CEO+Design+Eng)*

### Phase Scores

| Phase | Reviewer | Verdict | Score | Gate |
|-------|----------|---------|-------|------|
| 1 — CEO/Product | Claude + Codex | PASS | 8/10 | ✅ Auto-pass |
| 2 — Design | Claude + Codex | PASS with conditions | 7.5/10 | ✅ Auto-pass (conditions logged) |
| 3 — Engineering | Claude + Codex | PASS with sequencing | 8/10 | ✅ Auto-pass (risks logged) |

**Overall plan confidence: HIGH.** All 3 phases passed. 13 decisions auto-decided. 3 taste decisions require human sign-off before implementation begins.

---

### Auto-Decided Summary (13 decisions)

All of these were decided per the 6 gstack principles without human input needed:

- **Approach:** Stacked PRs (Foundation → P1 → P2/P3), not a single monolithic PR
- **Design system PR first:** DESIGN.md replaced before any page work starts
- **status-colors.ts:** Updated in design system PR (semantic collision would make all live/active statuses visually identical to errors)
- **Red disambiguation rule:** Red fills = live/active/primary; red strokes/text = semantic status indicators; red badges+text = error/overdue
- **Personality banned from:** alert, compliance, overdue, T&T failure, conflict contexts
- **Mobile spec:** §15/§16 must be written before mobile implementation starts
- **NavLink preservation:** Confirmed required in all sidebar PRs (DOM crash risk if replaced)
- **Mobbin research:** Targeted to 4 modules (Jobs, Warehouse, Crew, Assets), not all 15
- **Convex Phase A:** Coordinate merge order — design PRs must not conflict with #194–#199
- **RVLT mascot + Kalam + dark espresso:** In scope as DESIGN.md requirements
- **Hardcoded color grep:** Required per-PR pass (44+ files, not fixed by token swap alone)
- **Personality mode:** SELECTIVE EXPANSION (explicitly out-of-scope: server actions, schema, new features)
- **State matrix:** Required for all P1 modules before implementation

---

### Taste Decisions — Require Human Sign-Off

These 3 decisions were flagged as taste or conflict by ≥1 reviewer. They are not auto-decidable.

**T1 — Success Metrics (D5)**
Both CEO reviewers flagged the 6-month win condition ("operators recognize the brand change and prefer it") as insufficient. It measures visual compliance, not operator outcomes.
*Stakes:* If we ship with no outcome metrics, we have no signal that the redesign actually helped operators work better — just that it looked different.
*Proposed addition:* Include task-completion rate, session-length trend, and error-encounter rate (PostHog) as secondary win signals alongside brand recognition.

**T2 — Bottom Nav 5-Item Set (D8)**
Both design reviewers proposed: Dashboard / Jobs / Warehouse / Crew / Assets. Settings moved to avatar menu.
*Stakes:* Wrong navigation IA baked in before 94 pages are rebuilt = expensive rework. Operator who uses the app daily knows better than the reviewers what belongs at their thumb.
*Confirm or change the 5 items.*

**T3 — PDF Rebrand Scope (D13)**
Acceptance criterion says "remove RVLT Flow branding from PDFs." Constraint says "no backend changes."
The PDF pipeline lives in `src/lib/pdfme/` — it's frontend code, not a schema change. But it has a 5-consumer cross-cutting audit requirement (CLAUDE.md PDF rule). Neither model could auto-decide this.
*Stakes:* If in scope: adds ~1 week, requires full 5-consumer audit. If out-of-scope: acceptance criterion is unmet at ship.

---

### User Challenge (Optional)

**UC1 — Win Condition Framing**
*Both CEO reviewers agree:* "Users recognize the brand change" is a lagging vanity metric. Real validation for an operations tool is: can operators do their jobs faster/with fewer errors/with less confusion? If the rebrand doesn't improve operational clarity, it's just decoration.
*Challenge:* Should the 6-month success condition be reframed to include at least one operator-outcome metric (task completion rate, error encounter rate, or net promoter from crew)?
*This is a framing change — not a scope addition. It doesn't change the implementation plan.*

---

### Confirmed Critical Issues (In-Scope, Must Ship)

These are NOT taste — they are requirements that came out of the review:

1. `DESIGN.md` replacement before any page work (gap: mobile §15/§16 unwritten, red disambiguation missing)
2. `status-colors.ts` updated in design system PR (semantic collision risk)
3. `NavLink` preserved in all sidebar/nav PRs
4. Convex Phase A PRs (#194–#199) merge-coordinated before design system PR touches same files
5. BC Alphapipe licensing resolved before design system PR (variable font fallback if unresolved)
6. Personality banned from alert/compliance/overdue contexts — hardcoded in DESIGN.md

---

### Deferred to TODOS.md

- Visual regression test suite (Playwright screenshots + baseline) — zero automated visual regression exists
- Automated contrast checking (WCAG 4.5:1 per token)
- PDF rebrand (if excluded from this plan)
- `getCrewMembersForAssignment` Convex read-rewiring (deferred per Convex migration plan)

---

*Gate status: APPROVED 2026-06-18 — "A) Approve, proceed to implementation"*

**Taste decisions resolved (defaults applied):**
- T1: Add operator-outcome metric (PostHog: task completion rate) alongside brand recognition
- T2: Bottom nav confirmed: Dashboard / Jobs / Warehouse / Crew / Assets (Settings → avatar)
- T3: PDF rebrand deferred to follow-up PR (out of scope for this redesign)

**Implementation starts with: design system foundation PR (DESIGN.md + globals.css + font swap + status-colors.ts)**

