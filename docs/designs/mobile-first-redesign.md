# Mobile-First Redesign — RVLT Flow

**Status:** Proposed
**Author:** Planning session (Claude), 2026-07-12
**Goal:** Make the web app feel as if it were designed mobile-first, so crew on the
floor can run a job from a phone as fluidly as an ops manager runs it from a desktop.
Data-rich, not dumbed-down. No "turn every table into a card" reflex.

---

## 1. The core reframe

This is **not** a greenfield "add mobile" job. The app already has:

- A mobile app-shell: fixed/overflow-hidden shell, bottom nav (`mobile-nav.tsx`),
  sidebar-as-Sheet on mobile (`ui/sidebar.tsx`), safe-area insets, 44px touch-target
  utility, CI-enforced §15/§16 mobile rules (`mobile-compliance.test.ts`).
- A `DataTable` (`ui/data-table.tsx`) with a built-in card fallback below `md`.
- **A genuinely mobile-first module already shipped: Warehouse.**

The live audit (2026-07-12, prod, 390×844 viewport) found **two separate, universal
problems** that cut across every module — including Warehouse:

- **Problem A — every real table breaks the same way.** Any surface that renders a
  bespoke `<Table>` on mobile wraps item names into 3–6 line stacks, pushes trailing
  columns (price/cost/total, asset tag, location) off the right edge, and fills unused
  cells with "—" noise. This is true of the project equipment editor AND the warehouse
  pull-sheet/pick-list AND detail-page sub-tables. It is the single biggest issue.
- **Problem B — cramped execution.** Even the surfaces that use the *right* pattern
  (warehouse status cards, item rows) feel cramped: tight vertical rhythm, text jammed
  edge-to-edge, no breathing room. Dense-with-data has been conflated with
  crammed-in-spacing.

| Surface | State | Notes |
|---|---|---|
| Dashboard | ✅ Good | 2-col stat grid, quick actions, bottom nav |
| Warehouse landing | 🟡 Right idea | scan-first, stat grid, status-grouped job cards, packed-progress bar — good *structure*, but cramped |
| Warehouse detail (card lists) | 🟡 Right idea | scan-first, icon+count tabs, item cards — but cramped rows, and stepper/tabs overflow |
| **Warehouse pull-sheet / pick-list** | ❌ **Broken** | bespoke table: names wrap 3 lines, "Asset tag" header wraps, "—" everywhere, kit children each a tall row — *same disease as the equipment editor* |
| Assets registry | 🟡 OK | Grid/Table view toggle is a good instinct, but Grid is airy and Table will have Problem A |
| Asset detail | ✅ Good | key-value sections, empty states — this is the one genuinely solid pattern |
| Projects list | ⚠️ Weak | 5 stacked full-width toolbar controls bury the data; cards sparse & tall |
| Project detail hero | ⚠️ Weak | lifecycle stepper + tab bar overflow off-screen |
| **Project equipment editor** | ❌ **Broken** | names wrap 6 lines; Unit/Cost/Total pushed off the right edge; reorder arrows + checkboxes eat horizontal space |

**Corrected conclusion:** Warehouse got the *structural ideas* right (scan-first,
status-grouped cards, bottom nav, progress) but the *execution is unfinished and
cramped*, and the instant it needs a table it breaks exactly like everywhere else. So
Warehouse is **not** a finished reference to copy — it's proof the right instincts
exist, nothing more. The redesign must (1) solve the table problem generically —
including inside Warehouse — and (2) set a new, more spacious density standard that
applies everywhere. This is closer to a genuine redesign than a propagation exercise.

---

## 2. What the best data-rich apps actually do on mobile (Mobbin research)

The user's constraint — "data-rich, don't just turn everything into cards" — is
exactly how the best-in-class apps behave. Patterns worth stealing, with sources:

1. **Frozen identity column + horizontal scroll — the table survives as a table.**
   Yahoo Finance quotes, Attio's spreadsheet, monday.com, Stake financials all pin
   the row label on the left and let data columns scroll sideways. This is the answer
   for comparison/matrix data (financials, ROI, crew planner, line-item totals).
   *(Not cards.)*
2. **User-controlled density via a segmented toggle.** Yahoo's Basic / Details /
   Holdings switch changes how many columns show. **We already ship this**
   (Assets registry Grid/Table toggle) — generalise it.
3. **Rich, dense cards — not a title + one subtitle, and not cramped either.**
   Beli/Attio record cards pack a status pill, a mini metric grid, and inline progress
   into one tappable card *with room to breathe*. Warehouse job cards have the right
   ingredients ("32/34 packed" bar + lifecycle dots) but are spatially cramped — the
   target is that composition at a calmer spacing. The `DataTable` default card is the
   *thin* version — upgrade it.
4. **Filter/sort in a bottom sheet, triggered by a compact chip row.** Beli chips +
   Thrive Market's sort/filter sheet with a "Show 139 items" CTA. This replaces our
   stacked full-width filter buttons.
5. **Sectioned, scannable detail with one big primary action.** Jobber (our closest
   vertical peer — field service) job detail. Our asset detail already matches this.
6. **Scan-first for on-the-floor input.** alias / Crate & Barrel / Under Armour open
   with a camera scanner + manual-entry fallback. Warehouse landing already has a scan
   bar — extract it and extend scan entry to check-in/out and asset lookup everywhere.
7. **Row actions = swipe + long-press menu.** Things 3, Woolworths. Replaces the
   cramped inline icon cluster (chat/edit/⋯) currently squeezed into table rows.
8. **Sticky summary / action bar.** Woolworths "Est. Total" pinned above the nav.
   Perfect for the equipment editor's running total and multi-select actions.

---

## 3. Design principles for this redesign

1. **Mobile-first, not mobile-only.** Design the phone layout first for each surface,
   then progressively enhance up to desktop. Today most surfaces are the inverse
   (desktop table, degraded on mobile).
2. **Dense with data, never cramped in space.** This is the balance the current app
   fails (Problem B). "Data-rich" means *information* density — metric mini-grids,
   inline pills, sparklines, progress bars — NOT *spatial* density. Give every row
   real vertical rhythm, generous internal padding, and breathing room between
   groups. Respect the 11px font floor (DESIGN.md §15) as a floor, not a target: a
   card can carry four numbers and still feel calm if it has room. If it feels
   cramped, it has failed regardless of how much data it shows. Set an explicit
   mobile spacing scale (row min-height, card padding, group gaps) in DESIGN.md §15
   and enforce it.
3. **The right pattern per data shape** (see §4 toolkit). Entity lists → rich cards.
   Comparison/numeric matrices → frozen-column scroll tables. Never force one onto the
   other.
4. **The operator is the primary user.** People on the floor outnumber desk users.
   Optimise the floor flows (warehouse check in/out, equipment prep, scanning, crew
   call times) for one-handed, gloved, outdoors-in-sunlight use: big targets, high
   contrast, scan-first, minimal typing.
5. **One primary action per screen, always reachable.** Sticky bottom action / thumb
   zone. Secondary actions collapse into ⋯ sheets and swipe.
6. **Harvest Warehouse's ideas, not its execution.** It has the right building blocks
   (scan bar, status-grouped cards, progress bars, icon+count tabs). Extract those into
   shared primitives — but re-space and finish them to the new standard as you do,
   rather than cloning the cramped current versions.

---

## 3.5. The floor operator's journey (design for the actual context)

The primary user isn't at a desk. Design each moment for the real conditions.

| Step | Operator does | Real-world friction | What the design must do |
|---|---|---|---|
| Arrive at warehouse/venue | Opens app to today's job | Bright sun, phone in one hand, other hand full of gear | High-contrast espresso surfaces (already ours), 44px targets, thumb-reachable primary action, no hover-only affordances |
| Find the job | Scans the warehouse job list | Glanceable — can't stop and read | Status-grouped cards, packed-progress bar, big "Open" — scan not read (Krug billboard) |
| Pick / prep gear | Works down the line items | Gloves, no keyboard, moving | **Scan-first** (`ScanEntry`), qty steppers not text fields, swipe to check off, sticky progress |
| Hit a snag | Item not found / wrong count | Bad signal in a metal shed | Graceful offline (§3B), "search manually" with code prefilled, edits never lost |
| Confirm & move on | Marks prepped/deployed | Wants certainty it saved | Optimistic update + a clear saved state; if offline, visible "queued" not a silent fail |

Time-horizons (Norman): **5 seconds** — can they tell what job and what's left at a
glance? **5 minutes** — can they pick 40 items without fighting the UI? **5 years** —
does it feel like a tool built by people who've done a bump-in, not a generic SaaS grid?

## 4. The mobile pattern toolkit (build once, apply everywhere)

> The *decision system* behind which primitive to use for which data shape lives in
> its own doc: **`mobile-data-table-framework.md`** (patterns P1–P7 + the decision
> tree + cross-cutting density/alignment/a11y rules). This section is the component
> shopping list; that doc is the "how to choose."

New/upgraded shared primitives in `src/components/ui/` and `src/components/mobile/`.
Each maps to a data shape and replaces an ad-hoc treatment.

| Primitive | Replaces | Used by |
|---|---|---|
| **`StickyTable`** — frozen first (identity) column + horizontal scroll with an edge fade + optional per-column density | raw `<Table>` that only drops columns | equipment editor totals, financials, ROI matrix, crew planner, pull/pick sheets, detail sub-tables |
| **`ViewModeToggle`** (`Cards \| Table`) — presentation axis; comparison surfaces omit Cards | one-size card mode | lists that support both card + table views; generalises the Assets Grid/Table toggle |
| **`DensityToggle`** (`Compact \| Comfortable \| Relaxed`, 44/52/60px) — **separate axis** from view mode; persists per-view (per-user) via a fixed `use-table-preferences` | one-size rows | every list/table |
| **`RichDataCard`** — title + status pill + 2–4 metric mini-grid + optional progress/sparkline + swipe actions | thin `DataTableCards` default | projects, assets, crew, kits, clients, suppliers, locations, maintenance |
| **`FilterChipBar` + `FilterSheet`** — compact scrollable chips open a bottom-sheet with a "Show N" CTA | stacked full-width Type/Status/Columns/Views buttons | every list toolbar |
| **`ScanEntry`** — scan-first input with camera scanner + manual fallback (extract from warehouse) | one-off warehouse-only scan input | warehouse tabs, asset lookup, check-in/out, add-to-job |
| **`MobileTabs`** — horizontally-scrollable, snap-to, count-badge tabs with an overflow affordance; collapses to a Select when >5 | overflowing `Tabs` bars | project detail, warehouse detail, all detail pages |
| **`LifecycleStepper` (mobile variant)** — condensed dots-with-current-label, horizontal scroll, no wrapping | wrapping stepper labels | project detail, warehouse detail |
| **`StickyActionBar`** — pinned above bottom nav; holds primary action, running total, or bulk-select actions | inline buttons that scroll away | equipment editor, forms, bulk selection |
| **`DetailSection`** — key-value section (label left / value right), collapsible | ad-hoc detail markup | already the pattern on asset detail; standardise it |
| **`RowActionsSheet`** — long-press / ⋯ opens an action sheet; swipe-left reveals quick actions | cramped inline icon cluster in rows | equipment rows, all list rows |

**Composition gotcha (from CLAUDE.md):** never portal a Base UI popover/menu inside a
Radix modal `Dialog` (body `pointer-events:none` swallows clicks). Build `FilterSheet`
/ `RowActionsSheet` on the **vaul `Drawer`** or **Radix `Sheet`**, and keep any inner
pickers on Radix (`combobox-picker.tsx`, `tag-input.tsx`).

**Decision to lock:** pick ONE canonical mobile bottom-sheet primitive. Recommend
**vaul `Drawer`** for content/detail/action sheets (drag handle, `max-h-[96svh]`,
safe-area padding already built) and reserve Radix `Sheet` for the nav drawer. Document
it so we stop having two.

---

## 5. Per-surface treatment matrix

Priority tiers by operator impact × current brokenness.

### Tier 0 — Floor-critical, and where the worst gaps are

- **Project equipment editor** (`equipment-tab.tsx`, `equipment-rows.tsx`,
  `crew-panel.tsx`, `services-panel.tsx`, `sub-hire-order-dialog.tsx`).
  ✅ **SHIPPED (v0.24.4.0 cards + v0.24.5.0 card hierarchy):** below `md` the tab now
  renders the three-tier card system — **container cards** (groups / sub-hires / kits,
  `ring-line-2` + glyph + subtotal), same-size **line-item cards** (leaf), and
  recessed **child rows** (containers differ by cue, not size). See the shipped-style table in
  `mobile-data-table-framework.md` §3E and FEATUREDOCS/19. Tap = select, edit/move/delete
  behind the kebab. (Still open vs the original target below: qty stepper inline,
  `StickyActionBar` running total, `RowActionsSheet` swipe, removing the compliance
  allowlist entry.)
  *Original target:* raw dense table, columns off-screen, wrapped names →
  - Mobile: **`PopinRow` per line** (name + qty stepper inline; unit/total folded into
    the pop-in — this is the resolved decision, NOT `RichDataCard`), grouped into
    collapsible category → container sections; kit/accessory children per the §3E
    presentation-tree contract (two indent depths max; null-`childKind` fallback).
  - `StickyActionBar` with the running total + "Add" + bulk-select actions.
  - `RowActionsSheet` for edit/price/delete (replaces the inline chat/edit/⋯ cluster).
  - Add via bottom-sheet forms (`equipment-add-form`, `kit-add-form`, etc.).
  - Desktop keeps the table (progressive enhancement). Remove
    `equipment-rows.tsx` from the `mobile-compliance` allowlist when done.
- **Warehouse workflow** (`pick-prep-tab`, `deploy-tab`, `return-tab`,
  `close-out-tab`, `pull-sheet`, `online-pick-list`, `item-check-form`). *Today
  (corrected):* the pick/prep **tab already renders cards on mobile** (`pick-prep-tab.tsx:163`)
  — it's cramped, not a broken table; `online-pick-list` is a button/list. The genuinely
  **broken table is the `pull-sheet`** (a separate print-style route). *Target:*
  - **Pick/prep, deploy, return tabs → `PopinRow`/card, de-cramped** to the §3.2 spacing
    scale (each has one *primary* mode — pop-in card, NOT also a scroll table).
  - **`pull-sheet` → `StickyTable`** (frozen item column + smart-wrapping §3D) — this is
    the surface that *validates* P2/`StickyTable`. Kill the "—" noise; nest kit children
    per §3E (two depths), not one tall row each.
  - Fix stepper/tab overflow via `LifecycleStepper` + `MobileTabs`.
  - `item-check-form.tsx` (827 lines) → single-column sheet flow.
  - **Integration cost (Codex):** the detail view reads the live `warehouseDetail.bundle`
    (every line + every unit) while `online-pick-list` uses a server action + device-local
    `localStorage` for completion. Unifying/serving these two state paths is real work,
    not incidental.
- **Scan everywhere.** Promote `ScanEntry` to asset lookup and check-in/out, not just
  warehouse landing.

### Tier 1 — Core entity lists (high reuse — one fix propagates)

`project-table`, `asset-table`, `model-table`, `crew-table`, `client-table`,
`supplier-table`, `location-table`, `test-tag-table`, plus `kits/maintenance/activity/
timesheets` pages. All route through `DataTable`, so:
- Upgrade `DataTableCards` → `RichDataCard` (dense, not thin).
- Replace the stacked toolbar with `FilterChipBar` + `FilterSheet`.
- Add `DensityToggle` (Compact card / Comfortable card / Table-scroll).
- **This is the highest-leverage work:** improving `data-table.tsx` once upgrades
  ~12 lists at a stroke.

### Tier 2 — Detail pages

`projects/[id]`, `assets/registry/[id]`, `crew/[id]`, `clients/[id]`, `suppliers/[id]`,
`locations/[id]`, `assets/models/[id]`, `kits/[id]`.
- Header: sticky, with one primary action; `LifecycleStepper` mobile variant.
- Tabs: `MobileTabs` (scroll/snap, collapse to Select > 5).
- Body: `DetailSection` key-value blocks (asset detail is the reference).
- Inline sub-tables → `StickyTable` (frozen col) or `RichDataCard` list per shape.
- Verify the `DetailSidebar` actually stacks below on mobile per page.

### Tier 3 — Matrix / grid surfaces (frozen-column scroll, never cards)

`roi/fleet-roi`, `crew/planner`, `bookings/booking-calendar`, `assets/categories`.
- `StickyTable`: pin the row label, horizontal-scroll the periods/cells, edge fade.
- These legitimately stay tabular — this is the Yahoo/Stake pattern.

### Tier 4 — Forms & wizards

`project-wizard`, add/edit line-item dialogs, `model-form`, all `*/new` + `*/[id]/edit`.
- Dialogs → full-height bottom sheets on mobile (single column, sticky submit).
- `FormPageLayout` already does `grid-cols-1 sm:grid-cols-2` — extend the pattern;
  large inputs, numeric keypads for qty/price, sticky primary CTA.

---

## 6. Foundation / infrastructure work

1. **Breakpoint hooks.** Today it's binary at 768 (`useIsMobile`). Add a
   `useBreakpoint()` / tablet-band awareness if Tier 2/3 need the 768–1024 rail band.
   Prefer CSS-breakpoint swaps over JS where hydration flash matters (match
   `data-table.tsx`'s approach).
2. **Extract Warehouse primitives** (`ScanEntry`, status-grouped card list, progress
   bar, icon+count tabs) into `src/components/mobile/` so they're reusable, not
   warehouse-local.
3. **Canonical bottom sheet** decision (vaul Drawer) — §4.
4. **Extend `mobile-compliance.test.ts`** to assert the new patterns (no off-screen
   numeric columns without `StickyTable`; toolbars use `FilterSheet` not >2 stacked
   full-width controls) and burn down the allowlist.
5. **Perf.** These panels are huge (`equipment-tab` 1788 lines, warehouse page 2500+).
   Phones are weaker — virtualise long lists (line items, item rows, registry) and
   lazy-mount off-screen tabs.
6. **Keep IA in sync.** Any nav change touches BOTH `mobile-nav.tsx` and
   `app-sidebar.tsx` in the same PR (§16).

---

## 7. Phased roadmap

Each phase ships independently and is dogfoodable on prod. **Sequencing is
vertical-slice-first, and the slice is warehouse pick/prep (resolved in eng review after
a Codex challenge):** the editor was the wrong wedge — it's a back-office quoting surface
(prices, tax in Postgres, sub-hires), 3,000+ lines, tangled with the in-flight Convex
read migration. Warehouse pick/prep is the *actual* floor-crew execution flow, less
entangled, and its pull-sheet/pick-list tables are genuinely broken. Prove the pattern
there, on the real "person on the floor," before the hard editor case.

- **Phase 1 — Vertical slice: warehouse pick/prep (3–4 sprints — right-sized after
  Codex).** Broad slice, honestly estimated (the warehouse detail orchestrator is 3,197
  lines; prep branches across bulk/serialized/kits/nested/accessories/containers; and the
  detail bundle vs `online-pick-list` localStorage state paths must be reconciled). Build
  the primitives it needs: de-cramp pick/prep to `PopinRow`/cards, **`StickyTable` on the
  `pull-sheet`** (the surface that actually validates P2), `ScanEntry` (extract the scan
  bar), `ViewModeToggle` + `DensityToggle` (+ fixed per-user persistence),
  `StickyActionBar` (progress + prep), `MobileTabs`/`LifecycleStepper` (overflow fix).
  Ship, dogfood on the floor against **explicit acceptance thresholds**
  (below). Standalone primitives — no `DataTable`/`ColumnDef` dependency.
- **Phase 2 — Extract + generalize.** Promote the validated primitives; build the
  `ColumnDef` mobile hints now they're proven (NOT a universal auto-infer — see
  constraints); `ScanEntry` everywhere.
- **Phase 3 — Lists (1 sprint).** Upgrade `DataTable` card mode + toolbar → ~12 lists.
  Projects-list toolbar bloat first.
- **Phase 4 — The equipment editor (the hard case, 2+ sprints).** Now that the pattern is
  proven and primitives exist, take on the 3,000-line editor: P4 pop-in + P6 expandable,
  additively behind the `md` swap, removing `equipment-rows.tsx` from the compliance
  allowlist. Reference mockup: `equipment-editor-target.png`. Sequenced AFTER the
  Convex read/write migration for pricing settles, so UI vs migration failures are
  separable.
- **Phase 5 — Detail pages + matrix + forms.** `MobileTabs`/`DetailSection` across `[id]`
  pages; `StickyTable` for ROI/planner/calendar; dialogs → bottom sheets.
- **Phase 6 — Perf + (optional) durable offline.** Data-layer windowing + virtualise long
  lists; final `mobile-compliance` sweep. Durable offline (IndexedDB + drafts) only if the
  floor demands it — its own scoped project, not assumed here.

---

## 7.5. Engineering constraints (from eng review)

Hard constraints the implementation must honour, surfaced in `/plan-eng-review`:

- **Sticky positioning composes inside the shell, not the viewport.** The mobile shell
  is `position:fixed; inset:0; overflow:hidden` with `<main>` as the scroll container
  (`overflow-x-clip`). `StickyActionBar` and sticky table headers must anchor within the
  surface's scroll container and offset above the 56px bottom nav +
  `env(safe-area-inset-bottom)` — not `position:fixed` to the viewport (which the mockup
  used in isolation). P2 horizontal-scroll tables must scroll inside their own container
  (the shell clips page-level x-overflow).
- **Dense surfaces: fix the DATA layer, not just the DOM.** `DataTable` mounts table AND
  cards (cells render 2×) — so render mobile-only via a JS breakpoint (guard the hydration
  flash) for dense surfaces. But render-virtualization alone is insufficient (Codex): the
  Convex `*.bundle` queries (e.g. `equipmentTab.bundle`) fetch the *entire* line-item
  graph and ship it to the phone — virtualizing rendered rows does nothing for payload,
  read limits, or reconstruction cost. **Pair virtualization with windowed/paginated
  fetch at the bundle layer.** No virtualization dependency is installed yet; hierarchical
  variable-height virtualization (expand, nested kit rows, selection across unmounted
  rows, focus/scroll anchoring) is real architecture, not a checkbox.
- **Cell functions stay pure across all render modes.** A `ColumnDef.cell` now runs in
  table + cards + pop-in (up to 3×). No effects, queries, analytics, or hard-coded
  `id`/`htmlFor` in a cell. Enforce with a test.
- **Editor rewrite (now Phase 4) is additive, not a rewrite.** When the editor's turn
  comes, build the new mobile layout behind the existing `md` breakpoint swap in
  `equipment-tab.tsx`/`equipment-rows.tsx`; desktop table stays untouched. Add-then-delete
  keeps the diff reviewable. Sequence it *after* the Convex pricing read/write migration
  settles so UI failures and migration failures stay separable (Codex).
- **`DocumentLineItem` shape is frozen.** The redesign is presentational and must not
  change the line-item data shape — it feeds 5 PDF consumers (CLAUDE.md). If any field
  changes, the 5-consumer PDF audit is mandatory before merge.

**More corrections from the Codex challenge (fold into Phase 1):**
- **`use-table-preferences` is per-table `localStorage`, not per-user** — shared warehouse
  devices leak one operator's density/view to the next, and its `reset` doesn't clear the
  persisted `view` (violates our reset rule). Fix scoping (per-user/org, or explicit
  per-device with operator awareness) and the reset bug *before* building `DensityToggle`
  on top of it. Verified in `src/lib/use-table-preferences.ts`.
- **Blank cells: semantics, not a blanket rule.** "Kill the `—`" means remove *noise* — a
  cell that's empty because the field doesn't apply renders nothing. But blank can mean
  unavailable / not-assigned / failed-to-load; those get an explicit, meaningful token,
  not a bare dash and not silence. Prioritize fields so meaningful blanks are rare.
- **`ColumnDef` is not a universal card generator.** Rich cards need domain-authored
  hierarchy (title/status/primary-control/metric grouping/actions) — that can't be
  reliably inferred from table-cell JSX + `{priority, mobile, align, mono}`. `ColumnDef`
  gains *hints*; each surface's card is authored, with the hints as defaults it can
  override. Don't force one abstraction to drive table + cards + pop-in for every surface.
- **CI checks are cheap regression guards, not usability proof.** Static assertions (no
  raw `ui/table.tsx` without a wrapper, no dash-noise, mono+right-align on numerics) catch
  *regressions* but cannot prove a surface doesn't overflow or is usable. Pair them with
  real interaction tests + the acceptance thresholds below; expect an allowlist and treat
  it as debt, not done.
- **Phase 1 acceptance thresholds (define before dogfood, or the wedge proves nothing):**
  target job size (e.g. 200+ line items), device floor (e.g. a 3-year-old mid-tier
  Android), render/scroll budget (frame time), task-time benchmark (prep N items), save
  latency, error rate, and a rollback criterion.

**Test spine (Phase 1 ships with):** jsdom smoke test per new primitive; a cell-purity
check (static lint/API-narrowing where a smoke test can't prove absence of effects);
`use-table-preferences` per-user persistence + reset-clears-view tests; failed-save +
offline-banner state tests; an E2E for the pick/prep flow (scan → check off → progress →
prep) and the pull-sheet rendering a large kit-nested job; and **the regression gate =
removing the relevant warehouse surface from the `mobile-compliance` allowlist**.

## 8. Risks & conventions to respect

- **Don't shrink text for density** — 11px floor (§15). Gain density through layout,
  not smaller type.
- **Tokens only** — no hardcoded hex/shadow; consume `--paper/--ink/--red/...` and the
  `text-*`/`t-*` utilities. Red fill vs tint disambiguation is load-bearing (§1).
- **No all-caps** (§5.2). No non-red accents, no gradients, hard offset shadows only.
- **Radix vs Base UI composition** — `asChild` for Radix overlays, `render` for Base UI
  shells; never Base UI popup inside a Radix modal Dialog.
- **PDF pipeline** is downstream of the line-item shape — if the editor redesign changes
  any `DocumentLineItem` field, audit all 5 consumers (CLAUDE.md).
- **44px touch targets** that shrink to `sm:h-8` on desktop — the existing house pattern
  in `data-table.tsx`.
- **Both nav files in sync** on any IA change.

---

## 9. Decisions (resolved 2026-07-12 via /plan-design-review)

1. **Canonical bottom sheet:** vaul `Drawer` for content/detail/action sheets, Radix
   `Sheet` for the nav drawer.
2. **View mode + density are two separate controls** (Codex): `ViewModeToggle`
   (`Cards | Table`, presentation) and `DensityToggle` (`Compact | Comfortable |
   Relaxed`, row height). Default = Cards + Comfortable (52px); comparison/matrix surfaces
   omit Cards. Both persisted per view, per user.
3. **Tablet band (768–1024):** corrected — the existing swap (`useIsMobile`,
   `data-table` card swap) cuts over at **768**, so 768–1024 already renders the *desktop*
   layout. v1 keeps that 768 cutover; genuinely making 768–1024 behave as mobile needs a
   new breakpoint/hook and is deferred. (The earlier "tablet inherits mobile" was
   inconsistent with the 768 swap — this is the honest version.)
4. **Equipment editor:** P4 pop-in rows + P6 expandable children; inline qty stepper,
   deeper edits in a sheet — per the approved mockup.
5. **Type accent:** neutral mono badge, no colored edges; color reserved for status +
   red primary action.
6. **Offline:** honest graceful-only — no offline-reads claim (Convex cache is 5-min
   in-memory, not durable). Everywhere: offline banner + loud recoverable write failures.
   Durable offline (IndexedDB + service worker + drafts) is a separate scoped project if
   the floor needs it, not part of this redesign.

**Still genuinely open (not blocking):**
- **Scope of "mobile-first":** keep desktop as the richer power-user surface (plan
  assumes this), or later converge desktop toward the mobile IA (single primary action,
  sheets) for consistency? Revisit after Phase 1 ships and we can feel both.

---

## Approved Mockups

| Screen/Section | Mockup | Direction | Notes |
|---|---|---|---|
| **Warehouse pick/prep (Phase 1 target)** | `~/.gstack/projects/gearflow/designs/mobile-warehouse-pickprep-20260712/warehouse-pickprep-target.png` (+ `.html`) | scan-first + fixed lifecycle stepper + count tabs + pop-in item rows (asset tag/location folded in) + kit expand + sticky prep-progress/action bar | **The Phase-1 build reference.** Fixes the live audit's overflowing stepper/tabs and the pull-sheet's off-screen tag/location columns. On real RVLT tokens. |
| Project equipment editor (Phase 4 target) | `~/.gstack/projects/gearflow/designs/mobile-equipment-editor-20260712/equipment-editor-target.png` (+ `.html`) | P4 pop-in rows + density toggle + filter chips + sticky total/Add bar, on real RVLT tokens | The reference for "dense but calm, not cramped." Built from `globals.css` tokens. Note: the editor is now **Phase 4**, not the first slice — this mockup is the eventual target; the Phase-1 wedge is warehouse pick/prep. |
| Equipment editor — nested groups/kits/accessories | `~/mobile-mockups/3-equipment-nested-kits-groups.png` (+ `.html`) | collapsible group + category headers with subtotals; kit parent expanded (connector rail, "Kit contents"); accessory parent with children shown by default ("Travels with this item") | The nesting model (§3E of the framework). Shows how 4-level hierarchy collapses into section-headers + one indent level. |
| Scrollable data table (Notion-style) | `~/mobile-mockups/4-scrollable-table-notion-style.png` (+ `.html`) | frozen `Item` column (wraps to 2 lines) + horizontal-scroll numeric columns + edge fade + "↔ N cols" hint + `Cards/Table` toggle | Proves tables are a first-class, good-looking option (P2), not a fallback. Reference for smart-wrapping (§3D) + the frozen-column pattern. |

Open item: mockups for the rich data card at 3 densities and the filter sheet still to be
built (same HTML-from-tokens method — the AI mockup
generator was skipped because it produces off-brand generic visuals and needs an API key).

## Appendix — audit evidence

Screenshots captured 2026-07-12 at 390×844 on prod (`flow.rvlt.app`), read-only:
`/tmp/mobile-audit/` — 01 dashboard, 02 projects-list, 03 project-detail,
04 equipment-tab (broken table), 05 warehouse-list, 06 warehouse-detail,
07 warehouse-items (cramped cards), 08 assets-registry, 09 asset-detail,
10 warehouse pull-sheet (broken table — same disease as the equipment editor).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | outside voice | Independent 2nd opinion | 2 | issues_found | Pass 1: wedge→warehouse, offline corrected. Pass 2: §3E nesting rewritten to real data model, view/density split, StickyTable owns scroller, wrapping-vs-virtualization lanes, Phase 1 → 3–4 sprints |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 8 issues; scope resequenced; wedge switched to warehouse pick/prep |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 6/10 → 9/10, 6 decisions resolved |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** switched the vertical slice from the equipment editor to warehouse pick/prep;
  corrected the offline claim (Convex cache isn't durable); found the `use-table-preferences`
  per-device/reset bug; flagged data-layer (not just DOM) scaling.
- **UNRESOLVED:** 1 (desktop-IA convergence — deferred, non-blocking).
- **VERDICT:** ENG + DESIGN CLEARED — ready to implement Phase 1 (warehouse pick/prep).
