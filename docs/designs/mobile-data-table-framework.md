# Mobile Data Framework — Tables & Data-Heavy Info on Small Screens

**Status:** Proposed framework (research-backed)
**Date:** 2026-07-12
**Purpose:** A reusable decision system for rendering tables and dense data on mobile,
so every surface in RVLT Flow makes the *same* good choice instead of each one
improvising (and mostly failing — see `mobile-first-redesign.md`). This is the
"how" that the redesign initiative applies.

The one rule this whole framework serves: **match the pattern to the shape of the
data, not to the viewport.** "It's small, make it a card" is the reflex that produced
both the broken tables and the thin cards we have today.

---

## 0. Research basis

**Mobbin (real shipping apps):**
- Frozen identity column + horizontal scroll: [Yahoo Finance quotes](https://mobbin.com/screens/ace84469-f482-4b6d-b596-b73747ea3834), [Attio spreadsheet](https://mobbin.com/screens/d7a5338e-91c0-43d0-8340-8323b0f0ee00), [monday.com grouped table](https://mobbin.com/screens/3423eb72-4d52-4265-9638-4b8a181da785), [Stake financials](https://mobbin.com/screens/77320dc0-6981-4a9d-933b-c7866fd098ae), [F1 leaderboard](https://mobbin.com/screens/c974df1a-4351-40b9-99ff-107e25f770e2)
- "Just pick fewer columns and it fits" (no scroll, calm): [Binance history](https://mobbin.com/screens/ee4e243c-b96e-49b5-98dd-35e1508d365e)
- Density / view toggle: [Yahoo Basic/Details/Holdings](https://mobbin.com/screens/a0b3c704-17ac-4db6-a05d-0e69fedb2978), [Strava stats](https://mobbin.com/screens/efcd45c0-1947-4ec3-959d-0135bb025ab5)
- Rich cards: [Beli](https://mobbin.com/screens/271c991c-2c37-4e29-b40b-e74b1179591f), [Attio records](https://mobbin.com/screens/e80e455a-1a15-4a3c-8f94-5845dd9e2f2f)
- Filter/sort bottom sheet + chips: [Thrive Market](https://mobbin.com/screens/6eee050b-2d5e-4bb2-bd82-edeaf19389b9), [Beli chips](https://mobbin.com/screens/271c991c-2c37-4e29-b40b-e74b1179591f)
- Expandable rows / progressive disclosure: [Craft collection](https://mobbin.com/screens/7fe5abce-7bed-4358-8163-54d787174092), [StubHub](https://mobbin.com/screens/4322ebb5-d1f4-4363-bd96-7203eb56da60)
- Sectioned detail (field-service peer): [Jobber job detail](https://mobbin.com/screens/536351e7-656d-444e-867d-38eb7f48e146)
- Scan-first entry: [Crate & Barrel SKU scan](https://mobbin.com/screens/4c587eb7-af4b-4bbc-9160-1f9c5fc653d3)

**Web / engineering canon:**
- [Adrian Roselli — Under-Engineered Responsive Tables](https://adrianroselli.com/2020/11/under-engineered-responsive-tables.html) & [A Responsive Accessible Table](https://adrianroselli.com/2017/11/a-responsive-accessible-table.html): the **accessibility constraint** — `display:block`/flex reflow of a `<table>` strips its semantics in screen readers; you must re-add ARIA roles or keep a real table.
- [Smashing — Accessible Responsive Tables](https://www.smashingmagazine.com/2022/12/accessible-front-end-patterns-responsive-tables-part1/)
- [DataTables column priority](https://datatables.net/extensions/responsive/priority) & [jQuery Mobile column-toggle](https://api.jquerymobile.com/table-columntoggle/): the **priority-columns** pattern.
- [SAP UI5 pop-in tables](https://ui5.sap.com/sdk/docs/topics/38855e06486f4910bfa6f4485f7c2bac.html): the **pop-in** pattern (columns fold into a labeled block inside the row; importance High/Medium/Low decides order; ≥1 column always stays out of pop-in).
- [Pencil & Paper — Enterprise Data Tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables): density scale, freeze/sticky, alignment, bulk-on-select, state preservation + reset.
- [UXmatters — Designing Mobile Tables](https://www.uxmatters.com/mt/archives/2020/07/designing-mobile-tables.php), [Pencil & Paper mobile tables](https://medium.com/design-bootcamp/designing-user-friendly-data-tables-for-mobile-devices-c470c82403ad).

---

## 1. The pattern catalog

Seven patterns. Each has a data shape it's *for*, and failure modes it causes when
misapplied.

### P1 — Horizontal-scroll table (naive)
The whole table in an `overflow-x:auto` box. Easy; it's what our raw `ui/table.tsx`
does. **Failure mode:** the identity column scrolls away, so a user scrolled to the
"Total" column can't tell which row they're on; trailing columns are invisible until
discovered. **Verdict: never ship P1 alone.** It's only acceptable as the substrate
for P2.

### P2 — Frozen identity column + horizontal scroll ★ (first-class — make it nice)
Pin column 1 (the name/label) with `position:sticky; left:0`; the rest scroll under a
soft edge-fade + a "↔ N cols" hint. Optionally pin a trailing summary column (Total).
Used by Yahoo, Attio, monday, Stake, F1, Craft, Bear.
**A real, good-looking table is an encouraged choice, not a fallback** (product
direction, 2026-07-12): don't squish everything into cards — let the user scroll
sideways like Notion. The bar is "make it look nice," per §3D. Offer it via the
`Cards / Table` density toggle on entity lists, and use it by default for genuinely
tabular/comparison data (financials, ROI matrix, crew planner, pull/pick sheets,
line-item pricing).
**Don't** card-ify data whose whole value is cross-row/column comparison.

### P3 — Priority columns + user column toggle
Assign each column an importance (1..n). Auto-hide lowest-priority columns as width
shrinks; expose a "Columns" control so users pick what they see. Persist the choice.
(DataTables/jQuery-mobile pattern; our `DataTable` already has column visibility —
this formalises it with *priority* + persistence.)
**Use for:** wide entity tables where different users care about different columns
(asset registry, crew, clients) — pairs with P2 or P6.

### P4 — Pop-in (fold columns into a labeled block within the row) ★
As width shrinks, lower-importance columns don't disappear or scroll — they reflow into
a small labeled key/value block *inside the same row*, under the primary column. One
column always stays out of the pop-in. (SAP UI5.) This is the sweet spot **between a
table and a card**: still a real `<table>`/list row, but no horizontal scroll and no
data loss.
**Use for:** editable line items (equipment editor), warehouse item rows — where you
want name + one or two live values inline, and the rest (unit price, cost, tag,
location) folded but present.

### P5 — Transform to rich cards (collapse by row)
Each row becomes a card: title + status pill + a 2–4 value metric mini-grid + optional
progress/sparkline + swipe/⋯ actions. **This is our `DataTable` card mode — but the
current version is thin.** Rich, not thin; calm, not cramped.
**Use for:** entity **browse** lists where the user scans and taps through (projects,
kits, maintenance). NOT for data you compare column-to-column.

### P6 — Expandable rows (progressive disclosure)
Compact row shows the 2–3 must-see fields; tap a chevron to expand inline (or open a
detail sheet) for the rest. (Craft, StubHub; Pencil & Paper "inline expansion".)
**Use for:** long lists where most rows are scanned but any row might need depth
(asset registry rows, line items with sub-details, kit parents → children).

### P7 — Shorten: pick the right few columns (no scroll at all) ★
Often the best answer: choose the 3–4 columns that actually matter on a phone and let
the table simply fit. Right-align numbers, give rows real height, done. (Binance
History — 4 columns, fits, calm, still a table.)
**Use for:** any table where the desktop 8-column view is 4 columns of vanity. Ask
"what would a person on the floor actually read here?" first — frequently P7 removes
the need for P2/P3/P4 entirely.

---

## 2. The decision framework

Ask these in order. First match wins.

1. **Is it a comparison/matrix?** (values across a fixed axis: periods, metrics,
   dates, cells) → **P2** (frozen column + scroll), optionally P7 to trim. Never cards.
2. **Can it be honestly shown in ≤4 columns on a phone?** → **P7** (just fit it).
   Do this before reaching for anything fancier.
3. **Is it editable line-item data** (qty/price/total per row, add/remove) → **P4**
   (pop-in) with a **sticky totals + action bar**, and **P6** for kit/accessory
   children.
4. **Is it an entity browse-list** the user scans and taps → **P5** (rich cards) with a
   **density toggle** (P5 ⇄ P7 table). Add **P3** if power users need column control.
5. **Does any row need deep detail** → add **P6** (expand inline) or route to a
   **detail sheet**.
6. **Default / unsure** → P7 first, then P2. Reach for P5 cards only when the row is
   genuinely an entity you browse, not a data record you compare.

A surface can combine patterns (e.g. equipment editor = P4 pop-in rows + P6 expandable
kits + sticky action bar). The framework picks the *primary* structure.

---

## 3. Cross-cutting rules (apply to every pattern)

**Spacing — dense with data, never cramped (the Problem-B fix).**
Adopt an explicit mobile density scale (from Pencil & Paper, tuned to our 44px targets):
- Compact 44px row / Comfortable 52px / Relaxed 60px, user-selectable, **persisted**
  (via `use-table-preferences`) with a **reset**.
- Card internal padding ≥12px; ≥8px between cards; ≥16px between groups.
- 11px is the font *floor* (DESIGN.md §15), not the target. Density comes from layout,
  not shrinking type.

**Numbers & alignment.**
- Right-align all numeric columns; left-align text. Match header alignment to content.
- Use **Geist Mono** (`--font-mono`, already our convention) for qty/price/IDs/tags so
  digits line up and `$1,111` doesn't look bigger than `$999`.

**Sticky context.**
- Sticky header row on scroll; **sticky footer for totals/rollups**; frozen first
  column in P2. Sticky primary-action / running-total bar above the bottom nav.

**Kill the noise.**
- Empty cells: remove *noise*, not *meaning*. A field that simply doesn't apply renders
  nothing (our tables are full of dash-noise). But a blank that means unavailable /
  not-assigned / failed-to-load gets an explicit, meaningful token — never a bare "—" and
  never silent. Prioritize fields so meaningful blanks are rare.
- No zebra striping when rows have interactive/hover/selected states — use hairline
  dividers or card separation (Pencil & Paper).
- Center-align cell content up to 3 lines; top-align at 4+.

**Actions.**
- Bulk-select actions appear only after selection. Row actions via swipe + long-press/⋯
  **action sheet**, not an inline icon cluster jammed into the row.

**Filter / sort.**
- Compact scrollable **chip row** → opens a **bottom-sheet** with a "Show N" CTA.
  Never a stack of full-width filter buttons (the current Projects-list mistake).

**Accessibility (hard constraint — Roselli).**
- Keep a real `<table>` (or ARIA-correct roles) for P1–P4/P7. If a pattern reflows via
  `display:block`/flex (P5 cards, P4 pop-in), **re-apply ARIA** table/row/cell roles or
  build it from non-table semantics deliberately — don't half-break a `<table>`.
- Every interactive target ≥44px; scan/number inputs get the right mobile keyboard
  (`inputmode="decimal"` for price/qty).

**State preservation.**
- Density, visible columns, sort, and view (card vs table) persist per view and per
  user, with a visible **Reset to default**.

---

## 3A. Card & row anatomy (content hierarchy)

Every rich card / pop-in row reads in three tiers, so the eye lands in the right order
(Krug's scan test). Bind each tier to a DESIGN.md type role:

- **Primary (land first):** the identity — item/entity name. `text-sm`/`t-row-title`
  weight 600, `--ink`, full width, wraps to max 2 lines then truncates.
- **Secondary (the one number/state that drives a decision):** status pill (`--ok/
  --warn/--t-out` soft tints) + the single most-actioned control (qty stepper, or the
  headline value). Right side of the top row.
- **Tertiary (folded, on demand):** the pop-in key/value block — `Unit`, `Total`, tag,
  location — labels in `--faint` 11px, values in **Geist Mono** `--ink-2` (Total in
  `--ink` 600), right-aligned. Below a hairline `--line` divider.

Rule: if a field isn't tier 1 or 2, it belongs in the pop-in (P4) or an expand (P6) —
never crammed into the top row. Reference: `equipment-editor-target.png` (§ Approved
mockup in `mobile-first-redesign.md`).

## 3B. Interaction states (specify for every data surface)

The current app ships mostly the happy path. Each pattern must define all six. For
floor crew, **offline and error are not edge cases — they are Tuesday** (loading docks,
metal sheds, regional venues kill signal).

| State | Cards / list (P5) | Editor rows (P4/P6) | Scan entry |
|---|---|---|---|
| **Loading** | Skeleton rows at the chosen density (not a centered spinner) — preserve layout, no reflow | Skeleton line rows; totals bar shows a shimmer, not $0.00 | Camera viewfinder with "Point at a barcode" hint |
| **Empty** | Warm empty state (Kalam annotation OK per DESIGN §, primary action e.g. "Add first item") — never a bare "No items" | "No line items yet — Add or scan gear" + big Add | "Nothing scanned yet" |
| **Error** | Inline retry row ("Couldn't load — Retry"), keep any cached rows visible | Failed save: row keeps edited value, red `--t-out` "Not saved — tap to retry" chip; never silently revert | "Not found: <code> — search manually" with the code prefilled |
| **Offline** | Banner "Offline — showing last synced 4m ago"; reads work from cache | Edits queue locally, row shows a subtle "pending sync" dot; **decision D-offline below** | Scans queue; count badge "3 queued" |
| **Partial** | Loaded page + "Load more" / infinite scroll sentinel | Kit parent loaded, children lazy on expand | n/a |
| **Success** | Optimistic insert with a brief highlight; toast for undo | Total animates to new value; saved dot → check | Item drops into the list with a highlight |

**Never** block the whole screen on one failed cell. **Never** show a spinner where a
skeleton preserves layout. **Never** revert a user's typed value without telling them.

**Offline (resolved, eng review — corrected after Codex challenge):** we do **not** claim
offline reads. Convex's cache is a ~5-minute *in-memory* subscription cache, not durable
storage — a reload, process eviction, or expired auth loses it, so "cached reads work
offline" is false without IndexedDB + a service worker. So the honest scope is:
- **Ships everywhere:** a clear "you're offline" banner, and write failures that are loud
  and recoverable on reconnect (retry). Note "never lose a typed value" only holds within
  a mounted session — a true durable-draft guarantee needs local persistence, so don't
  over-promise it across navigation/refresh.
- **Real durable offline** (IndexedDB drafts + service worker + offline-auth) is a
  separate scoped project, taken on only if the floor genuinely needs it — not a
  side-effect of this redesign. The queue+sync column above is that future project's
  target, not a redesign deliverable.

## 3C. Breakpoint → pattern matrix

Today the code is binary at 768. Make the intent explicit:

| Surface class | Phone <768 | Tablet 768–1024 | Desktop >1024 |
|---|---|---|---|
| Entity list | P5 rich cards (Comfortable) | P5 cards 2-up OR fitted table (P7) | full table |
| Editable line items | P4 pop-in rows + sticky bar | P4 pop-in OR condensed table | full table |
| Comparison / matrix | P2 frozen-col scroll | P2 frozen-col scroll | full table |
| Wide entity table | P7 fit / P2 scroll | P3 priority columns | full table + all columns |
| Detail sub-table | P6 expand / P2 mini | P2 mini-table | inline table |

Reality check: the existing swaps cut over at **768**, so today 768–1024 renders the
*desktop* column, not the tablet column above. The tablet column is aspirational and
needs a new breakpoint/hook to deliver — deferred (see `mobile-first-redesign.md` §9 #3).
For v1, read the tablet column as "= desktop."

## 3D. Smart wrapping — cells grow, never overlap

The non-negotiable for on-screen tables (P2/P7): **nothing overlaps, ever.** The
mechanism (proven by Craft and Bear on Mobbin — a long text column wraps and the whole
row grows, while the date/number columns stay compact):

1. **Every column has an explicit `min-width` / `max-width`.** No column may collapse to
   zero and bleed into its neighbor. Numeric columns are sized to content; text columns
   get a sensible max.
2. **Text wraps, numbers don't.** Text/identity columns: `white-space:normal;
   overflow-wrap:anywhere`. Numeric/short columns: `white-space:nowrap`, right-aligned,
   Geist Mono.
3. **Row height is `auto`, driven by the tallest cell**, with `vertical-align:top` so
   wrapped lines stack downward — the row grows, cells never spill sideways. (Matches
   Pencil & Paper: center-align ≤3 lines, top-align at 4+.)
4. **The frozen column wraps internally** (identity to ~2 lines) on a *solid* background
   + right-edge shadow, so scrolling columns pass under it, never through it.
5. **Truncate with ellipsis only on secondary meta**, never on the primary identity;
   a truncated cell exposes its full value on tap.
6. **44px minimum row height** even for single-line rows (touch target).

Sortable columns get a header affordance (arrow, like Binance/monday); tap header to
sort, long-press a cell for cell/row/column actions (Craft pattern) where relevant.

**Wrapping vs virtualization is an either/or — pick the contract per surface (Codex):**
auto-height wrapping rows and row-virtualization fight each other. Three lanes, don't mix:
1. **Native P2 table** (wrapping + sticky column): **no row virtualization** — keep the
   real `<table>` layout and **window/paginate the *data*** instead (fetch fewer rows).
2. **Virtualized card / pop-in list**: measured/estimated row heights + explicit
   expand behavior — this is where virtualization lives.
3. **Virtualized table-grid** (only if a surface truly needs both huge N and columns):
   a separate implementation, likely not a native `<table>`. Avoid unless forced.
§3D's auto-height assumption holds only in lane 1; don't retrofit virtualization onto it.

## 3E. Nested data on mobile (groups, categories, kits, accessories)

**⚠️ The real data model (verified against code — Codex, 2026-07-12), not the tidy
version:** the actual shape is `Category → mixed ProjectGroup / SubHireGroup → Line item`
(the group axis sits *under* category, and groups are a mix of two kinds), **plus**
standalone category items and uncategorised/orphan groups. `isKitChild` is the **generic
structural-child flag** — it covers kit members, accessories, AND sub-hire children
alike, and any such row is hidden from flat rendering (`equipment-rows.tsx:269`). Two
sharp traps:
- **`childKind` (`KIT | ACCESSORY`) is NOT reliably set** — current kit creation writes
  `isKitChild`+`parentLineItemId` but leaves `childKind` null (`projectLineItems.ts:505`).
  A renderer that switches on `KIT|ACCESSORY` mishandles every legacy/current kit child.
  **Rule: classify by parent *context* + `childKind`, with a null-kind fallback** (child
  of a kit line with null `childKind` ⇒ treat as `KIT`).
- **Parent kind is multi-axis, not one enum** — a sub-hire child is still a sub-hire
  source; an accessory parent is detected *by having `ACCESSORY` children* (no `kitId`);
  a kit child can itself contain a nested kit. Use the existing row descriptors
  (`equipment-row-descriptors.ts`), don't invent a new single enum.

**Presentation-tree contract** (normalize to this before rendering, so the messy source
maps to a clean UI): `section` (category) → `container` (ProjectGroup | SubHireGroup |
accessory-parent | kit-parent) → `line` → `child edge` → `unit`. Then:

- **Sections + containers → collapsible headers with subtotals** (accordion), not
  indentation — this turns depth into scannable sections. Handle orphan/uncategorised as
  their own "Ungrouped" section.
- **Parent → child → up to TWO indent levels**, not one. Nested kits are real (child →
  grandchild; `kit-child-rows.tsx`, and the read layer reconstructs two child depths in
  `warehouse-detail-reconstruct.ts:143`). Cap at two, with a connector rail; beyond that,
  push into a detail sheet rather than deeper indent.

Child-visibility:
- **Kit contents collapse by default** ("Show N kit items") — a bill of materials opened
  on demand.
- **Accessory children show by default** ("Travels with this item") — inseparable, not
  gated by `showKitChildren`; hiding them misrepresents what ships.
- **Sub-hire children** follow the same `isKitChild` hide-from-flat treatment but keep
  their sub-hire-source identity in the child row.

Reference: `mobile-first-redesign.md` § Approved Mockups → equipment-nested mockup (note:
the mockup shows the simplified 2-device idea; the contract above is the authoritative,
code-accurate version it must be built to).

**Shipped card style (v0.24.5.0 — the built expression of the tree above).** The equipment
tab renders three visually-ranked card tiers so depth reads without heavy indentation:

| Tier | What | Surface | Distinguishers |
|---|---|---|---|
| **Container** | ProjectGroup, SubHireGroup, kit-parent, accessory-parent | `bg-card` + `ring-1 ring-line-2` (heavier edge) | leading glyph (`Container`/`Handshake`/`Package`), `font-medium` title, qty·total summary, chevron |
| **Line item** (leaf) | plain line | `bg-card` + `ring-1 ring-line`, `py-2` | smaller `text-table-cell` title, no glyph; grouped members get an `ml-3` left inset to nest under their container |
| **Child** | kit member / accessory | `bg-paper-2/40`, no ring, `pl-6` | most recessed; tag + `Accessory` badge |

Rule of thumb: **containers are the prominent "shelves," line items are a size step down,
children recede.** Selection is `ring-2 ring-red` on any tier. Keep every tap target ≥44px
even when the leaf padding shrinks (`min-h-11`). Implemented by the row components
self-branching on `useIsMobile()` (see FEATUREDOCS/19), primitives in `equipment-cards.tsx`.

## 4. How it maps to our stack

| Framework piece | Component (new or existing) | Notes |
|---|---|---|
| P2 frozen-col scroll | **`StickyTable`** (new) | `position:sticky` col + edge-fade. **Owns its single scroll container — do NOT wrap `ui/table.tsx`** (it already renders an `overflow-auto` wrapper, `table.tsx:5`; wrapping = nested scrollers, clipped fades, sticky header on the wrong element). |
| P3 priority columns | extend `ui/data-table.tsx` column visibility + `use-table-preferences` | add `priority` to `ColumnDef`, persist |
| P4 pop-in rows | **`PopinRow`** (new) or a `DataTable` `popin` mode | importance per column; ≥1 stays out |
| P5 rich cards | upgrade `DataTableCards` → **`RichDataCard`** | metric mini-grid, progress, swipe |
| P6 expandable rows | **`ExpandableRow`** (new) | chevron → inline expand or detail sheet |
| P7 shorten | column config per surface | choose mobile columns explicitly in each `*-table.tsx` |
| **View mode** (presentation) | **`ViewModeToggle`** (new): `Cards \| Table` | Separate axis from density. Comparison/matrix surfaces do NOT expose Cards. |
| **Density** (row height) | **`DensityToggle`** (new): `Compact \| Comfortable \| Relaxed` | 44/52/60px, persisted via `use-table-preferences`. Orthogonal to view mode. |
| Filter chips + sheet | **`FilterChipBar` + `FilterSheet`** (new, vaul Drawer) | replaces stacked toolbar |
| Sticky totals/actions | **`StickyActionBar`** (new) | above bottom nav |
| Row action sheet | **`RowActionsSheet`** (new, vaul Drawer) | swipe + long-press |
| Numbers | `--font-mono` (Geist Mono) | already the convention |
| Tokens/spacing | DESIGN.md §15 density scale | tokens only, no hardcoded px in components beyond the scale |

Extend `ColumnDef` in `data-table.tsx` so a single column definition drives **all**
breakpoints: `{ priority, importance, mobile: 'primary'|'popin'|'hidden', align,
mono }`. Then a surface picks a *mode* (`table | scroll | popin | cards`) + density,
and the framework renders the right pattern from one definition. That is what makes
this a framework and not twelve bespoke fixes.

**CI:** extend `mobile-compliance.test.ts` to assert: no raw `ui/table.tsx` on a route
without `StickyTable`/pop-in/cards wrapper; no `—` empty-cell placeholders; toolbars
don't stack >2 full-width controls; numeric columns use mono + right-align.

---

## 5. Anti-patterns (what today's app does — stop doing these)

- **Naive column-drop / P1 alone.** Hiding columns with `hidden md:table-cell` and
  letting the rest overflow off-screen (equipment editor, pull-sheet). → P2/P4/P7.
- **Dash-noise.** "—" in every empty cell. → render nothing.
- **Thin cards.** Title + one subtitle masquerading as "mobile-friendly." → P5 rich.
- **Cramped everything.** Right patterns, no breathing room (warehouse cards). → §3 density scale.
- **Stacked full-width filter buttons** eating the first screen. → chip row + sheet.
- **Inline icon clusters** (chat/edit/⋯) crammed into a row. → swipe + action sheet.
- **`display:block` reflow that silently breaks screen readers.** → keep table semantics / re-add ARIA.

---

## 6. Worked examples (our surfaces)

- **Equipment line-item editor** → P4 pop-in (name + qty inline; unit/cost/total fold)
  + P6 (kit/accessory children expand) + `StickyActionBar` (running total, Add, bulk).
- **Warehouse pull-sheet / pick-list** → P7 (item, qty, tag, location is already ≤4 —
  just fit it) rendered via P2 frozen-col so the item name stays put; kill the dashes;
  children fold via P6.
- **Financials / Fleet ROI / Crew planner** → P2 pure (frozen label, scroll periods).
- **Projects / Assets / Crew / Clients lists** → P5 rich cards default, `DensityToggle`
  to P7 table, `FilterChipBar`+`FilterSheet`, P3 column control for power users.
- **Asset / project detail sub-tables** → P6 expandable rows or P2 mini-tables by shape.

---

## 7. Decisions (resolved 2026-07-12)

1. **Default mobile density: Comfortable (52px)**, with Compact (44) and Relaxed (60)
   opt-ins, persisted per view.
2. **Default list view on phone: rich cards (P5)** + density toggle down to fitted
   table (P7). Global default; per-view persistence remembers overrides.
3. **Equipment editor: P4 pop-in + P6 expandable together** (resolved by the approved
   mockup) — name + qty inline, unit/total in the pop-in, kit children behind an
   expand. Inline qty stepper; deeper edits (price override, notes) open a sheet.
4. **Type indicators are neutral** (mono text badge, e.g. `Kit · 6 items`) — no colored
   left-edge. All color reserved for status + the red primary action (DESIGN.md
   red-only rule). Reflected in `equipment-editor-target.png`.
5. **Offline: honest graceful-only.** No offline-reads claim (Convex cache is 5-min
   in-memory, not durable). Everywhere: offline banner + loud, recoverable write failures.
   True durable offline (IndexedDB + service worker + drafts) is a separate scoped project
   if the floor needs it, not a redesign deliverable.
6. **Tablet (768–1024): renders desktop for v1** (corrected — matches
   `mobile-first-redesign.md` §9 #3). The existing swaps cut over at 768, so 768–1024 is
   desktop today; a genuine tablet-as-mobile band needs a new breakpoint/hook and is
   deferred. Column customization (P3) stays a desktop/tablet affordance; phone uses
   view-mode + density, not per-column toggles.
