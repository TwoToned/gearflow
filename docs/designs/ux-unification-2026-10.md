---
status: PROPOSED
updated: 2026-10-24
---
# UX unification — one list, one row, one menu, works on a phone

> _Owner: Jayden Nawotka · Last reviewed: 2026-10-24 (review quarterly — POLICY.md R-5.5)_

**Mockups:** https://claude.ai/artifact/HHjfzi1NUL5PEQDQMxM6KU (private canvas, 11
artboards: Equipment desktop + phone + line editor sheet, Logistics desktop + phone
day mode, Warehouse job desktop + phone pack mode + scan sheet, the floor board, the
shell at three widths, and the primitives every surface is built from).

This is the second UX pass since the RVLT rebrand (`docs/designs/ux-ui-redesign.md`,
2026-06). That pass restyled the app and set the design language. Since then
accessories v2, packing containers, group disclosure, category rollup, sub-hire
orders, durable scan intake, versioning and the money phase have each landed with
their own UI. Each one is correct on its own and each one looks and behaves a little
differently from the one before it. This document is the plan to pull them back into
**one** vocabulary, **one** row, **one** action model and **one** mobile strategy.

It is a design spec, not a build plan. §11 sequences the work; each phase gets its own
`/autoplan`.

---

## 1. What is wrong today (evidence)

Surveyed 2026-10-24 against `main` at `e1e50bb`. File paths are the current
owners of each behaviour.

### 1.1 The same thing, drawn five ways

| Thing | Where | How it looks |
|---|---|---|
| Gear stage | `warehouse/page.tsx` cards | 5-dot stepper, prepped = amber, returned = green, ends "Closed" |
| Gear stage | `warehouse-lifecycle.tsx` | stepper, prepped = blue, returned = amber, de-prepped = green, ends "De-prepped" |
| Gear stage | `prep-status-badge.tsx` | "Prepped" = green `Badge ok`, "Pulled" = blue override, "Needs prep" = amber |
| Gear stage | Deployed tab | `StatusIndicator` pill "Deployed" |
| Gear stage | Returned tab | reuses `DeployTab mode="deprep"` so returned gear shows a green **Prepped** chip (bug) |
| Warehouse module hue | landing chip | lime; DESIGN.md and the returns page say teal |
| "Not in a case" | Packing tab / warehouse tabs / rail + PDFs | "Not planned" / "No container" / "Loose" |
| Row actions | Equipment tab | hover-only icon cluster + ⋯ on every row kind, four different action sets |
| Row actions | Warehouse tables | checkbox + bulk bar only; one-off row buttons (Report issue, Move to Returned) |
| Row actions | DataTable lists | no standard pattern; inline icons on three lists |
| ⋯ icon | 17 files | `MoreHorizontal` on most, `MoreVertical` on the warehouse job page |
| Module name | sidebar vs bottom nav / "New job" | "Projects" vs "Jobs" |
| Module name | sidebar vs route, palette, breadcrumb | "Schedule" vs "Availability" |
| Labour tab | tab / empty state / button | "Labour & logistics" / "No logistics yet" / "Add service" |

### 1.2 State you cannot see

On the Equipment tab a line can be excluded from ROI, hidden on documents, have its
price hidden in a rollup, be optional, or carry a manual price. None of these shows on
the row; you learn them by opening the ⋯ and reading which way the label points
(`equipment-rows.tsx`). The packing plan (`plannedContainerId`) is invisible in the
warehouse, and the warehouse page sends `containerId: null` whenever "Loose" is active,
which overrides the plan (`convex/lib/fulfillment.ts:1037`) — so the PM's plan may never
apply. Failed deploy/return scans through the durable intake play no tone and raise no
toast; they bump a counter inside a collapsed `<details>` (`scan-intake-status.tsx`).

### 1.3 Menu diving

- Eight ways to add something to a job (`UnifiedAddDialog` × 5 kinds,
  `AddGroupToolbarDialog`, `AddCategoryDialog`, category/group kebab entries, the
  `?modelId` deep link). Three ways to edit a group price. Three ways to edit a line's
  accessories.
- Dates are edited only through the four-step wizard behind header **Edit**; the
  Logistics tab cannot move a load-in time.
- Crew can only be added inside the service dialog (`services-panel.tsx`); the crew
  table's empty state says "scroll up".
- The warehouse job page is six tabs plus a non-clickable stepper showing the same
  counts (`warehouse/[projectId]/page.tsx`, 3,697 lines, three scan pipelines).
- Call sheet is reachable from two menus; manifest from one of them; the pull-sheet
  route is reachable from none.

### 1.4 Mobile

- One breakpoint (`md`, 768). DESIGN.md §15's tablet tier (768–1024 icon rail) is not
  implemented; the sidebar collapses only by hand.
- No scan entry point outside a warehouse page; the landing hero's scan field only
  filters the project list (`convex/scanLookup.resolve` has no UI caller).
- Warehouse: six tabs scroll sideways with no affordance, tab triggers and container
  chips are under 44 px, mobile labels are "In" / "Prep" / "Move", no accessory
  selection on cards.
- Equipment tab cards have no inline editing and "+ Add" only adds equipment.
- Settings is reachable on a phone only through the hamburger sheet (DESIGN.md says
  the avatar menu).
- Mira's floating button is the only floating element and sits over list content.

### 1.5 Dead or orphaned

`add-service-dialog.tsx` (no importer), `/warehouse/[projectId]/pull-sheet` (no link),
`/notifications` and `/changelog` (no link), the online pick list's localStorage ticks
(a second "picked" truth), `hasExpandableUnits` (computed, unused), the
`prepStatus === "PREPPED"` branches in `equipment-rows.tsx` (unreachable value).

---

## 2. Research

### 2.1 Market

| Product | What they do that matters here | Source |
|---|---|---|
| Rentman | Phone app is the warehouse: pack with photos + serials, scan marks packing progress, several people pack one slip at once, cases group gear, damage logged from the phone. Reviewers still find kit scanning confusing and the phone app behind desktop ("can't change planned items on the go"). | [rentman.io mobile](https://rentman.io/rentman-mobile-app), [App Store](https://apps.apple.com/app/id998730270), [Capterra reviews](https://www.capterra.com/p/144616/Rentman/reviews/), [Software Advice](https://www.softwareadvice.com/retail/rentman-profile/reviews/) |
| Current RMS | Accessories are products in their own right, tagged Default / Mandatory / Optional on the parent; an "Accessories" section appears under the product the moment it is added to an opportunity; nest four deep. Companion app pairs by QR. | [help: accessories](https://help.current-rms.com/en/articles/1518548-choose-accessories-when-adding-products-to-an-opportunity), [inclusion types](https://help.current-rms.com/articles/1518555-what-s-the-difference-between-default-mandatory-and-optional-accessories) |
| Flex5 | Tablet-first rewrite; prep screen with a left-hand subtotal list; pull sheets prepped from tablet and phone; customisable dashboard. | [rAVe: Flex5 tablet](https://www.ravepubs.com/flex-rental-solutions-announces-flex5-tablet-debuts), [Flex5 UI preview](https://www.flexrentalsolutions.com/?p=1019) |
| Cheqroom | QR check-out is the praised part; the phone app "lags the web app" and the reservation → checkout flow confuses people. | [Capterra](https://www.capterra.com/p/140824/CHEQROOM/reviews/?page=3), [GetApp](https://www.getapp.ca/software/106723/cheqroom) |
| MCS picking app | Checklists with tick boxes / dropdowns / photos, mandatory per admin; pickers assigned; picking tasks filtered by date, depot, priority. | [LSi](https://lsionline.com/mcs-adds-equipment-picking-feature), [IRN](https://www.internationalrentalnews.com/news/mcs-launches-picking-equipment-app/8032986.article) |
| Jobber | 2024: a **More** tab gathering secondary modules; Dec 2025: edit details on the page instead of opening new screens. | [Jobber updates](https://productupdates.getjobber.com/48223-welcome-to-the-new-jobber), [product updates](https://productupdates.getjobber.com/page/10) |
| Warehouse scanning (general) | Validate on device, log the exception the moment it happens, queue offline and replay, guided prompts, sub-second response. | [Cleverence](https://www.cleverence.com/amp/articles/business-blogs/mobile-scanner-picking-6283/), [picking UX](https://www.cleverence.com/amp/articles/business-blogs/software-picking-5274/) |
| Responsive tables | Priority columns + a table/card toggle beats either alone; sticky first column; tables for cross-record comparison, lists for one-line records. | [uxdesign.cc](https://uxdesign.cc/how-to-design-data-tables-for-phones-7ed6b04da10), [Ramotion](https://www.ramotion.com/blog/mobile-tables-design/), [Setproduct](https://www.setproduct.com/blog/data-table-ui-design) |

The pattern across the category: the desktop product is the planning tool and the phone
is the warehouse tool, and every reviewer complaint is about the seam between them
(kits that scan confusingly, plans you can't change on the phone, a flow that reads
differently in each place). Flow already has the model for both; this pass closes the
seam.

### 2.2 Mobbin references (structure, not styling — DESIGN.md §10)

| Pattern we adopt | Reference |
|---|---|
| Scanner with "last scanned" line and a **Review N scans → Apply** step | [Shopify inventory scanner flow](https://mobbin.com/flows/32f9bd70-e1b2-471b-b273-126e453b50a4), [scanned items review](https://mobbin.com/screens/b0ddb2c2-476b-4f3b-a01b-8ea0b38957d7) |
| Scan history under the viewfinder | [Best Buy](https://mobbin.com/screens/5683ae1f-b4a4-46cf-a78a-0323cf5d48ea), [UNIQLO](https://mobbin.com/screens/62fa4fba-988b-4c80-9ed6-94ba9fcfd38d) |
| Checklist with Scan / Add tiles and one sticky CTA | [Target list](https://mobbin.com/screens/0d21d035-6c86-4b97-8b87-38b20a0b5fd8) |
| Job detail on a phone: header, two primary actions, tabs, bottom nav | [Jobber job](https://mobbin.com/screens/1717a0a9-386f-4bfc-a4f6-3d9550db0778) |
| Row action sheet with grouped items and Delete last | [monday.com](https://mobbin.com/screens/934eb64d-5479-4f6d-8c6f-3e28434f4f57), [Google Drive](https://mobbin.com/screens/364e5cb6-eb04-43f4-b4a5-7fe8e4f64862), [Fiverr](https://mobbin.com/screens/5867b796-cce0-47cd-9002-43a2848266d8) |
| Detail sheet with facts + Edit / Delete | [Revolut](https://mobbin.com/screens/dec89aaa-a97e-448e-808f-aefed60efea1) |
| Multi-select with a bottom bulk bar on a phone | [Revolut Business cards](https://mobbin.com/screens/6aca5eb9-0825-46e1-bef9-e26f6fba1018) |
| Filter chips with counts on a phone list | [Jira Cloud](https://mobbin.com/screens/af81eee3-c1ca-488b-921f-6ac2f6645e4f), [GitHub](https://mobbin.com/screens/32898ffc-75d9-474b-af72-4f09258b1249) |
| Vertical stage stepper for an order | [IKEA](https://mobbin.com/screens/423d9b74-1ffb-486f-b8ea-ca5c2ddc4481), [Temu](https://mobbin.com/screens/e1d8ce2c-803a-4d25-9a50-e6ae800ce852) |
| Line items grouped into sections with per-section totals | [HoneyBook](https://mobbin.com/screens/105f5259-a5e3-475f-8a0e-a94d34d8a2bf), [Programa](https://mobbin.com/screens/3c107357-bc30-473f-b699-f5701149b59a), [Jobber quote](https://mobbin.com/screens/97afbf4c-d79e-436f-b0f3-2835b5117098) |
| Nested rows with a per-row ⋯ | [Midday](https://mobbin.com/screens/bbd8aade-bb21-4c0e-8eb9-9d50ea45f220), [Quicken](https://mobbin.com/screens/2aa52db4-b273-4e90-abb6-8e4edf333bcc) |
| Floating bulk bar over a selected list | [ClickUp](https://mobbin.com/screens/e9639493-e0a6-46c9-93d1-d3189cbdc3c7), [Aboard](https://mobbin.com/screens/e67b8815-2571-4945-9090-94520c88e5fa) |
| Detail page with a properties rail | [Linear](https://mobbin.com/screens/f4cd410f-b1b4-49fe-a247-80071f69ba1e), [Xero project](https://mobbin.com/screens/38b60b12-690a-41c4-a2f0-59a08dc39bf1) |

---

## 3. Principles

1. **One row.** Equipment lines, pack items, services, crew calls, containers and
   assets all render through one `LineRow`: select · kind glyph · title + tags + state
   glyphs · facts · status · one primary action · ⋯. Desktop draws it as a table row,
   phone as a 56–64 px list row. Same fields, same actions.
2. **One menu.** Every ⋯ opens the same `ActionMenu` — a dropdown on desktop, a bottom
   sheet on phone — with fixed groups in a fixed order: Edit · Organise · Documents ·
   Reporting · Danger. Actions that don't apply are absent, never greyed out.
3. **State is visible.** Anything the menu can toggle shows on the row as a glyph with
   a tooltip (§5.4). No hidden booleans.
4. **Hover is never the only affordance.** Checkboxes and the ⋯ are always rendered
   (muted); hover just brightens them. The phone has no hover.
5. **Edit in place, create in a sheet.** Quantity, price, discount, dates, times and
   container are edited where they are shown (inline on desktop, a row sheet on
   phone). Dialogs are for creating things and for destructive confirmations only.
6. **One vocabulary.** One name per module, per stage, per state, used in the nav, the
   chips, the PDFs and the toasts (§4).
7. **The phone is a first-class warehouse tool, not a shrunk desktop.** Scan is one tap
   from anywhere; a scan has one pipeline and one feedback rule; everything a packer
   does is reachable with a thumb.
8. **Nothing floats over content on a phone.** No FABs; the bottom nav owns Scan, the
   top bar owns Mira and search.

These restate DESIGN.md §15/§16/§3 rather than replace them. Where this document
changes a DESIGN.md decision it says so in §12.

---

## 4. Vocabulary (single source: `src/lib/vocabulary.ts`, new)

| Concept | One word | Replaces |
|---|---|---|
| A job | **Job** | Project (sidebar, breadcrumbs, routes stay `/projects`) |
| Gear availability calendar | **Schedule** | Availability (route stays `/availability`) |
| The labour tab | **Logistics** | Labour & logistics / Add service / No logistics yet |
| The warehouse landing page | **The floor** | Warehouse hub |
| Gear not in a case | **Loose** | Not planned / No container |
| The planning tab for cases | folds into Equipment › **Packing** view | Packing tab |
| Gear stages | **To pick · Prepped · Out · Returned · De-prepped · Closed** | Pick / Prepped / Deployed / Returned / De-prepped / Close-out, Pulled, Needs prep, Deployed |

Stage colours (DESIGN.md §3 intents, applied once):

| Stage | Intent | Why |
|---|---|---|
| To pick | neutral | nothing has happened yet |
| Prepped | info | packed and waiting |
| Out | **live** (solid red) | it is the CHECKED_OUT state §1 reserves solid red for |
| Returned | warning | work remains (de-prep, checks, exceptions) |
| De-prepped | success | done |
| Closed | neutral outline | archived |

Problems are always a word in `error` tint: **Short 2**, **Overdue 2 d**, **No driver**,
**Missing**. "Needs you" items are `warning`: **Needs check**, **Unpriced**, **4 of 5**.

The floor board, the job stage filter, every row chip, the Equipment tab's fulfilment
badge, the warehouse TV display and the PDFs read from this one table. The three
colour schemes in §1.1 go away.

---

## 5. The primitives

All live in `src/components/ui/` and are the only way to build the surfaces in §6–§9.

### 5.1 `LineRow`
Props: `kind` (gear · kit · group · subhire · custom · sale · container · service ·
crew · asset), `title`, `subtitle`, `tags[]`, `glyphs[]` (§5.4), `facts[]` (typed:
availability, qty, money, time, place, people), `status` (§4), `primary?` (one
button), `menu` (an `ActionMenu` spec), `children?` (one level: kit members,
accessories, group members, bulk units, assigned crew), `selectable`, `expanded`.
Desktop renders a `<tr>` with the facts as columns (the parent decides which facts
become columns); phone renders a list row with facts collapsed into the subtitle and
the first money/qty fact on the right. A child row is 44 px and has no actions.

### 5.2 `ActionMenu`
A spec object `{ groups: [{ title, items: [{ label, kbd?, danger?, when }] }] }` built
by one function per row kind (`src/lib/row-actions/*.ts`) so the project and the
warehouse share the gear menu. Renders as `DropdownMenu` on desktop, `Drawer` (bottom
sheet, 48 px items) on phone. Keyboard shortcuts `E` / `M` / `D` stay.

### 5.3 `StatusPill` and `StageFilter`
`StatusPill` reads the §4 table; nothing else maps a stage to a class. `StageFilter`
is the row of count chips (`To pick 18 · Prepped 24 · Out 0 …`) that replaces both the
six tabs and the non-clickable stepper on the warehouse job page. Clicking a chip
filters the one list.

### 5.4 State glyphs
Price hidden · Hidden on documents · Excluded from ROI · Optional · Manual price ·
Needs check · Planned → case · Accessories modified. 18 px tag with a tooltip; the
same glyphs appear on the Equipment tab, in the Client view and on the warehouse row.

### 5.5 `AddBar`
A command-style input docked under a list: typing searches models, kits, assets,
suppliers and templates at once; kind chips narrow it (Gear · Kit · Sub-hire · Custom ·
Sale on Equipment; Delivery · Pickup · Call · Labour · Misc on Logistics). Enter adds
with smart defaults (qty 1, auto-price, the current category); a second Enter opens the
row editor for anything else. Replaces `Add ▾`, `UnifiedAddDialog`'s five kinds,
`AddGroupToolbarDialog`, `AddCategoryDialog` and the kebab "Add …" entries. The dialogs
stay as the "more options" step behind the row editor, not as entry points.

### 5.6 `FooterTotals` and `BulkBar`
Totals render once per tab, in the list footer, derived (§7 of FEATUREDOCS/74 —
never stored). `BulkBar` is the one bulk surface: desktop sits at the list footer,
phone sits above the bottom nav. Its actions come from the same `ActionMenu` spec
filtered to `bulk: true`.

### 5.7 `ScanDock` and `ScanStrip`
One scan input (keyboard wedge + camera button) with the active target inside it
("Packing into → LX-04 ▾") and a mode toggle (Prep as I scan · Check only). `ScanStrip`
shows the last scans as pills: success (with Undo when the write is reversible),
warning (needs a check — Run check), error (not on this job — Add & prep), neutral
(saved on device · syncing). One pipeline: every warehouse scan goes through the
durable intake and every result goes through `announceWarehouseWrite`, so tone, strip
entry and Undo are decided in one place.

### 5.8 `RowEditorSheet`
The phone's answer to inline editing: full-row tap opens a sheet with qty stepper,
price, discount ($/%), total, availability notice with the sub-hire shortcut, and
drill-ins for accessories, serials, notes, and the rest of the menu. Save is one
mutation (`patchNative`), the same one the desktop inline cells call.

### 5.9 `DetailHeader`
The job page and the warehouse job page share one header: title, status pill, lock
chip, version chip, meta line (number · type · client · dates · PMs), actions, and the
lifecycle as a row of stage pills. The warehouse variant swaps the meta line for the
packer's facts (loads out when, which truck, who is packing).

---

## 6. Shell and navigation

### 6.1 Desktop (≥ 1024)
220 px rail (DESIGN.md says 220; code says 248 — fix the code). Items keep their module
hue. Order: Dashboard · Jobs · Finance · Schedule · Crew · Assets · Warehouse · Test &
tag · Maintenance · More (Clients · Suppliers · Locations · Activity) · Settings ·
avatar. "My tasks" leaves the rail (DESIGN.md D10C already says so; the code still has
it). Breadcrumb becomes a real trail: `Jobs › #2341 Hilton gala › Equipment`, each
segment a link.

### 6.2 Tablet (768–1023)
Automatic icon rail (72 px, icon + 11 px label, flyout for sub-pages). Today this
exists only as the manual ⌘B collapse. Detail pages drop to one column at this width;
the context rail stacks below.

### 6.3 Phone (< 768)
Bottom nav: **Home · Jobs · Scan · Warehouse · More**. Scan is the raised centre
button; More opens a sheet of module tiles (Crew, Assets, Schedule, Finance, Test &
tag, Maintenance, Clients, Suppliers, Locations) plus Settings and Account. This
changes DESIGN.md §16 (Crew and Assets leave the bar; Scan joins it) — see §12.

Scan is context-aware: on a warehouse job it acts on the current stage; anywhere else
it looks the tag up (`convex/scanLookup.resolve`, which finally gets a caller) and
offers "where it is · which job · open". Returns mode is Scan with scope "any job".

Mira moves from a floating button to a top-bar icon on every width. Search is one
field (⌘K / the phone icon) with the existing `@` pages, `/` commands and date modes.

---

## 7. Job › Equipment

One list, three **views** (segmented control in the toolbar):

- **List** — the operator's editing view. Sections are categories; each section
  header carries count, a derived subtotal, an availability summary chip (`1 short`)
  and the rollup state (`Itemised` / `Combined price` pill). Columns: select · Item ·
  Availability · Qty · Unit · Total · actions; **Cost** is a toolbar toggle. Group
  rows show the bundle price with "bundle" and a `Suggested $X` ghost when unpriced;
  members show "in bundle". Kit and accessory children are one level deep;
  accessories render as a single compact child line (`Accessories · SB900B ×8 · UA844
  added · ~~4U case~~ client supplies · Edit`) rather than N look-alike kit rows. A
  sub-hire shows **once** as a group row (`PO-118 · draft · via Scene Change · 18%
  margin`); the separate "Sub-hire orders" card goes.
- **Packing** — the same lines grouped by planned container, with a container card
  per case (kind, tag, nesting, planned vs packed counts) and drag or ⋯ "Move to" to
  re-plan. Replaces the Packing tab. "Loose" is the last section.
- **Client view** — exactly what the next quote prints: rollups collapsed, hidden
  lines gone, disclosed group members listed, prices as the client sees them. The
  Overview's quote card links here. This is where the invisible toggles in §1.2
  become checkable.

Toolbar: view switch · filter chips with counts (All · Short · Unpriced · Sub-hire ·
Optional) · text filter · Cost toggle · ⋯ (Sync accessories, Sync kits, Reorder
categories). Footer: `AddBar` · Group / Category / Container chips · `FooterTotals`
(Gear · Services · Discount · Total ex GST).

Row actions (the gear `ActionMenu`): Edit line (E) · Edit accessories · Serials ·
— · Sub-hire the shortfall (only when short) · Move to… (M) · Duplicate · — · Hide /
Show price on documents · Hide / Show on documents (group members) · — · Exclude /
Include in ROI · — · Delete (D). The inline primary action is contextual: `Sub-hire
2` on a short line, nothing on a healthy one.

Inline editing stays on desktop (qty, unit, discount, notes). Phone: full-row tap →
`RowEditorSheet`. Selection: always-visible checkboxes; phone has a Select mode
button in the toolbar. Drag-to-reorder stays (long-press on phone).

Category delete gets a confirmation (it has none today). Dialog titles move to
sentence case.

### 7.1 Accessories specifically
- One entry point: **Edit accessories** on the line (menu or the child line's Edit).
  The accordion inside Edit item and the standalone plan dialog collapse into one
  sheet: defaults ticked, optionals unticked, "removed" items struck through with
  their reason, and "Sync from catalog" per line.
- The typed-reason gate when unticking a default stays (it is a business rule) but
  the reason is shown on the row afterwards (`client supplies`).
- Accessories are visually distinct from kit members: a teal **Accessory** overline
  on the child line and the parent tag reads `Accessories 3/4`, not a kit badge.
- The same child line, with verify circles, is what the packer sees (§9), so an
  accessory looks the same on the quote and on the floor.

---

## 8. Job › Logistics

The tab is renamed **Logistics** and gets three things it lacks today:

1. **Dates on the page.** A facts strip at the top: Rental · Load in · Load out · Venue
   access, each editable in place (date/time popover). Editing a date runs the
   existing `useDateMoveGate` and then **re-times linked services and calls** (today
   moving dates leaves them where they were — §1.3 "Regenerate does not regenerate").
2. **One schedule, three lanes.** A single list grouped by day (`Tue 11 Nov · Load in`)
   with lane filter chips: Transport (delivery, pickup, sub-hire returns), Site (bump
   in, show calls, bump out), Crew open (calls with unfilled slots). Each service is a
   `LineRow`: time · what (type glyph, title, duration, where) · where / vehicle · crew
   (avatar stack + `1 needed`) · charge · status · primary action (`Offer 1 more`,
   `Assign driver`, `Receive`) · ⋯. A call expands to its crew lines, each a child row
   with rate, window, status pill and a `Resend` / `Pick crew` / `Request
   availability` action — so crew can be added **from the call**, not only from the
   service dialog.
3. **Money once.** The footer shows On quote · Cost · Margin; the per-card charge/cost/
   margin trio and the "Services financial summary" card go. The Overview strip and
   Finance keep their own copies because they answer different questions.

Vehicle stays free text in the data for now, but the UI treats it as a chip with the
org's recent vehicles as suggestions. Sub-hire pickup and return trips appear in the
Transport lane as planned rows (today they appear nowhere).

**Phone = day mode.** The Logistics tab on a phone is the Runsheet: day chips, one
card per call with the time in 18 px mono, where + directions, crew avatars, one
primary action (Manifest · Offer 1 more · Message crew) and ⋯. `/projects/[id]/
runsheet` becomes a redirect to `?tab=logistics` on phones and goes away as a separate
rendering (it keeps its own copy of the type labels today).

---

## 9. Warehouse

### 9.1 The floor (`/warehouse`)
A board, not a hub: title, the `ScanDock` with scope (This job · Any job), a
**Returns mode** button, four tiles (To pack · Out on site · Coming back · Overdue)
and three columns — **Pack today & tomorrow** (sorted by truck time), **Out on
site**, **Back · to close out**. Each job card is the same card: number, stage pill,
name, client, truck time + vehicle, progress bar with `24 of 42`, who is packing,
primary action (Open · Start pack · Chase · Close out), ⋯. The "Actions ▾ → Mark
deployed / returned / completed" manual overrides leave the card (they ignore item
state); they stay in the job ⋯ as an admin action with a confirmation.

### 9.2 The job (`/warehouse/[projectId]`)
- `DetailHeader` (warehouse variant) · `StageFilter` with counts and a progress bar ·
  one card holding the `ScanDock`, the `ScanStrip` and **one** table.
- The table groups by category in **To pick** (with a Shelf column, sorted by shelf
  walk when the org has locations) and by container from **Prepped** onward. Every row
  is a `LineRow` with the stage pill and one primary action for the stage (`Prep 8`,
  `Prep kit`, `Deploy`, `Return`, `De-prep`). Kit members and accessories are child
  rows with verify circles, on desktop **and** phone (today phones have no accessory
  selection).
- The right rail is **Containers**: one card per case (tag, kind, nesting, progress,
  `Planned:` line, Sealed / Packing / Planned pill, ⋯ with Rename · Move into · Unpack
  · Print label · Remove) plus Loose, and a **Needs you** list (checks due, shorts,
  arrivals). The mutations for rename / unpack / remove exist
  (`use-project-container-writes.ts`) and finally get UI.
- Planned vs packed is visible on the row (`Planned → VID-04` glyph) and in the rail,
  and prepping into "Loose" no longer overrides the plan: `containerId` is only sent
  when the packer chose a case.
- Condition on return is recorded per row through the scan sheet / row sheet, the same
  way on the job page and in Returns mode (today it is a global select on one and a
  post-hoc per-row action on the other).
- The online pick list's localStorage ticks go; "picked" is the `To pick → Prepped`
  transition. The pull-sheet route becomes the print view of the same list.

### 9.3 Returns station
Becomes **Returns mode**: the same `ScanDock` with scope Any job, the same `ScanStrip`,
the same row sheet for condition, and the "Everything out" board rendered with the same
job cards. Single-asset and bulk returns gain Undo because they go through the one
pipeline. The board subscribes live instead of a manual refresh.

### 9.4 Phone pack mode
Header with the packer's facts · stage chips · sticky `ScanDock` with the active case
chip and Check-only toggle · one-line `ScanStrip` · 64 px rows with big `0 / 8` counts
and a 36 px `Prep` button on the right · `BulkBar` above the bottom nav. A scan opens
the scan sheet: tag, model, where it sits on the job, the prep check inline (Fail /
Pass, Pass all), **Pack into** case chips, Where it's been · Swap · Report, and one
primary `Prep into LX-04`. Offline scans show as neutral strip entries, never silent.

---

## 10. Everything else, briefly

- **DataTable** lists adopt `LineRow`'s mobile card and `ActionMenu` for their row
  actions; the three ad-hoc inline icon sets go.
- **Asset detail / model detail** headers become `DetailHeader`.
- **Dashboard** is unchanged; its job cards become the §9.1 card.
- **Notifications** page gets a "See all" link from the bell; **changelog** links from
  Settings › General.
- **Tasks · Notes · Files** tabs are unchanged in this pass.

---

## 11. Phases

Each phase is one `/autoplan`. Nothing here changes a Convex schema except 2c.

| # | Phase | Scope | Effort |
|---|---|---|---|
| 0 | Vocabulary + tokens | `vocabulary.ts`, one stage→intent table, rename Projects→Jobs and Availability→Schedule in nav/palette/breadcrumb, sidebar 220, tablet icon rail, `MoreHorizontal` everywhere, dead code in §1.5 removed | S |
| 1 | Primitives | `LineRow`, `ActionMenu` (+ per-kind specs), `StatusPill`, `StageFilter`, state glyphs, `AddBar`, `FooterTotals`, `BulkBar`, `RowEditorSheet`, `DetailHeader`; jsdom smoke tests that open every menu and sheet | M |
| 2a | Equipment tab on the primitives | List view, section subtotals, glyphs, one sub-hire row, accessories as one child line + one editor, AddBar, totals footer, phone row sheet, category-delete confirm | M |
| 2b | Packing view + Client view | Packing tab → view; container cards with rename/move/unpack; Client view = document structuring applied in the tab | M |
| 2c | Plan-honouring prep | `containerId` only sent when chosen; `Planned →` glyph in the warehouse; a test that a planned line preps into its planned case when the packer has no active case | S |
| 3 | Warehouse job page | `StageFilter` replaces tabs + stepper; one table; `ScanDock`/`ScanStrip`; one scan pipeline with Undo + tone for every result; containers rail; phone pack mode + scan sheet; delete the localStorage pick list; the Returned-tab chip bug | L |
| 4 | The floor + Returns mode | Board, cards, scope-aware scan dock, live returns board, Undo on all returns, `scanLookup.resolve` wired | M |
| 5 | Logistics | Dates on the page with linked re-timing, three lanes, crew from the call, money once, runsheet → phone day mode, sub-hire transport rows | L |
| 6 | Shell | Bottom nav with Scan + More sheet, Mira to the top bar, real breadcrumb trail, DataTable lists on the primitives, Settings in More | M |

Docs in the same PR as each phase (POLICY.md R-5.2): FEATUREDOCS/10, 12, 19, 25, 31,
32 (retire), 39, 47, 48, 52, 60, 69, 83, DESIGN.md §15/§16, CLAUDE.md's composition
notes, and the `rvlt-flow` skill where a stage name changes.

---

## 12. Decisions that need a yes

These change something DESIGN.md or a FEATUREDOC states today. The mockups assume
the recommended option.

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| D1 | Bottom nav gets **Scan** in the centre and **More**; Crew and Assets move into More | Yes — half of warehouse work is on phones (TODOS "Mobile-First Overhaul") and there is no scan entry today | Keep §16's five and add a floating scan button (breaks "nothing floats") |
| D2 | Stage colours: Out = solid red (live), Returned = amber, De-prepped = green | Yes — it is the §1/§3 mapping applied literally | Keep the landing page's amber/green |
| D3 | Packing tab becomes a view of Equipment | Yes — same lines, one list, no tab to find | Keep the tab, restyle it |
| D4 | Runsheet route is replaced by Logistics day mode on phones | Yes — one rendering of one data set | Keep both |
| D5 | Mira moves to the top bar | Yes | Keep the floating button, raise it above the bulk bar |
| D6 | Manual "Mark deployed / returned / completed" leave the floor cards | Yes, into the job ⋯ with a confirm | Keep on the card |
| D7 | "Projects" → "Jobs" in every label (routes unchanged) | Yes — the bottom nav and "New job" already say it | Rename the bottom nav to Projects |

---

## 13. Acceptance

- Every row on Equipment, Logistics, the warehouse job page, Returns mode and the
  DataTable lists is a `LineRow`; `grep -c "DropdownMenuTrigger" src/components` drops
  to the `ActionMenu` implementation plus the header menus.
- One `stage → intent` table; `StatusIndicator` / `PrepStatusBadge` / inline
  `bg-out-soft` overrides for stages are gone.
- Every toggle in a row menu has a glyph; the Client view matches the quote PDF for
  the regression fixtures.
- At 375 px: no horizontal page scroll, every tap target ≥ 44 px (the existing
  `mobile-compliance.test.ts` extended with the stage chips and strip buttons), a
  packer can prep a kit with accessories, pack it into a case, run a check and undo
  it without leaving the job page.
- A scan that fails, waits for signal, or needs a check is visible within one second
  on every warehouse surface.
- A planned container is honoured when the packer has no active case (2c test).
- The warehouse job page is under 800 lines after phase 3.

---

## 14. Out of scope

Vehicles as an entity, venue access as structured data, multi-warehouse, bulk-tub
containers, a packer queue across jobs, drag-to-pack on phones, and PDF restyling.
Each is a sensible follow-up once the primitives exist.
