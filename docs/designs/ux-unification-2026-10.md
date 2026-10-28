---
status: PROPOSED
updated: 2026-10-27
---
# UX unification — one list, one row, one menu, works on a phone

> _Owner: Jayden Nawotka · Last reviewed: 2026-10-27 (review quarterly — POLICY.md R-5.5)_

**Mockups:** https://claude.ai/artifact/HHjfzi1NUL5PEQDQMxM6KU (private canvas, 11
artboards: Equipment desktop + phone + line editor sheet, Logistics desktop + phone
day mode, Warehouse job desktop + phone pack mode + scan sheet, the floor board, the
shell at three widths, and the primitives every surface is built from).

**Clickable prototypes** (state-driven HTML, every action wired, Undo on every write):
- Job › Equipment: https://claude.ai/artifact/BdwR4bNbiNMLSvfRAByEwC — v2 (§7): the
  live tab cleaned up with every feature on the row, accessory rows + editor,
  search-first add, one edit sheet, the shortfall → sub-hire sheet, order rows and
  the order sheet, plus the earlier inline editing and drag and drop.
- Logistics: https://claude.ai/artifact/E36tnBkGL9obdikUQ5mbXf — v2 (§8).
- Finance: https://claude.ai/artifact/7ByfxnbtsgQTJdiwvvo1CY — v2 (§8b).
- Job › Overview + page header: https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo — v1 (§6b).
- Tasks & notes (Tasks + Notes + Files merged): https://claude.ai/artifact/BrLBitu3c2V4uixLQbXCNE — v1 (§8c).
- Warehouse job: https://claude.ai/artifact/Mt8p55xkPkkexVWPC5eaGU — **locked
  2026-10-27** (§9.2, §9.4, §9.5). Three earlier directions (case board, pick walk,
  scanner-first) were prototyped and rejected in favour of "the live page, cleaned up".

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

**Phone pass (2026-10-28, all job prototypes).** The phone views were desktop
layouts collapsing into a column; this pass treats the phone as its own
surface, on every job tab:

- **A tab strip under the phone header** (`Overview · Equipment 44 · Logistics
  · Finance · Tasks & notes 9/14`), scrolling, the active tab filled — today a
  phone has no way between tabs except the desktop tab row squeezed in.
- **One sticky primary action in thumb reach**, above the bottom nav: `+ Add
  line` (opens the search-first add as a bottom sheet), `+ Add service ▾`,
  `+ Invoice ▾`, `+ Add task` (opens the task sheet), `Advance to …` on
  Overview. The toolbar's primary button is hidden on phone so there is one.
  Footer totals stop being sticky; the action bar takes that slot.
- **Touch targets**: row ⋯ always visible and 40 px; rows 60 px minimum;
  every input 16 px so iOS does not zoom; menus and dialogs are bottom sheets.
- **Logistics facts** become a two-column grid instead of a horizontal scroll;
  day chips and lanes stay; cards keep the call time in mono.
- **Finance** keeps the 2×2 money tiles with text links, notices as left-rule
  lines, quotes and invoices as rows.
- **Tasks & notes** keeps a sticky `Tasks · Notes · Files · Discussion` chip row
  under the tab strip to jump between sections.
- **Warehouse** was built phone-first already (scan dock, big Prep / Pack /
  Deploy buttons) and is untouched here.

## 6b. Job › Overview and the page header — v2 proposal (prototype 2026-10-27 · calm revision, awaiting a yes)

Overview is the job's home and the page header is the one thing every tab
shares, so they are designed together. What is live: a hero with no dates and
no status pill (status shows only through the stepper), an `Edit` that leaves
for a four-step wizard page, a lock chip whose "jump to the lock" scrolls to
an id that no longer exists, a ⋯ status menu with no permission gate, and an
Overview body of two finance cards, a four-tile money strip and four context
cards. **The readiness checklist the docs describe was deleted on 2026-10-17
(commit `6bbdee8`) and never replaced** — the rules module and the Convex
query survive with no UI consumer. The page's own comments, CLAUDE.md and
FEATUREDOCS/69 still describe it.

**The home has to be calm.** The first cut put every feature on screen at once
(three header pills, a nine-row checklist with a button per row, a four-tile
money strip, two dense finance cards, four context cards) and read as busy.
The revision keeps every capability but shows the job in one column, in
prose, with everything else one click away: a sentence of state, the three
things to sort, two quiet money lines, three facts columns, four lines of
recent activity. No cards, no tiles, no per-row buttons — hairlines, small
caps labels and text links. Red appears once (a blocker), amber only as a
dot. Width is capped so the eye has a single line to follow.

- **Header.** Title row: name · status pill · a small lock glyph when pricing
  is locked (its menu says who, when, what is read-only, and unlocks). Meta
  line: number · client · **rental dates · days**. Actions: one primary
  `Advance to …`, `Documents ▾` (warehouse paperwork + labels + call sheet +
  timeline, and a pointer to Finance for quote/invoice PDFs — never a live
  render of those), `Edit`, ⋯ (Comments & discussion with its blocking count
  · Warehouse page · Runsheet · Versions · Duplicate · Save as template ·
  Cancel; Reactivate / Delete only when cancelled). Open incidents and the
  version are no longer header pills: incidents are a line in the readiness
  list, the version lives in ⋯ and under `V`. `Edit` becomes a sheet of
  the Basics (name, code, type, client, contact, description, tags, discount
  and tax rate shown locked when pricing is) — the wizard stays for creating a
  job. **Status is not a field in it**: the wizard's Status select bypasses
  every gate `updateStatusNative` runs (accepted quote, blocking comments, the
  confirm snapshot) and goes.
- **Progress** is a thin eight-segment line with tiny labels (done = ink,
  current = red, upcoming = hairline) and a `Set status ▾` text link under it;
  on the phone only the current label shows. It keeps the 8 stages and shows
  the sub-status under a two-status stage (`Quote · quoted`).
  Every move runs the same gates in the same order: prep/dispatch moves
  blocked by an unresolved blocking discussion show *why* and a link to it;
  entering Confirmed runs the confirm-impact preview (`Confirming this job
  will create a gap` — models that would go hard-overbooked, crew not yet
  confirmed, "a heads-up, not a block"); Confirmed/Completed take the snapshot
  and raise the lock, said in the toast. `Awaiting payment` keeps the derived
  three-step strip (Quote accepted · Invoice sent · Paid) with one line of why
  it exists. Cancelled replaces the stepper with the off-pipeline notice plus
  `Set status ▾` and `Delete project…`. The ⋯ menu gets the `project:update`
  gate the Advance button already has; `Awaiting payment` is spelt from the
  shared label map (the page's local map misses it).
- **One quiet strip, only when it matters**: viewing a non-live version
  (draft, editable on Equipment and Finance, "this page always shows the live
  job", `Make v2 live` with its dialog, `Back to live`). The pricing lock is
  the header glyph, not a strip — the amber banner on every tab was the
  loudest thing on the page and said the same sentence every time. `V` opens
  the version menu: every version, `New version from v3`, `Compare`,
  `Manage…`.
- **Readiness comes back first, as a sentence and a short list**: the
  headline is the verdict (`Prep is held` / `Not ready for prep yet` / `Ready
  for prep`), the lead is the blocker in words with one link to fix it, then
  the three most important things to sort as text rows (`and 3 more ›`
  expands), and one micro line naming the checks that are clear. Computed live
  from the rules that still exist plus three new rows, each linking to the tab
  that owns it: gear (short / would be short if a pencilled job
  confirms / not checked without dates), double-booked assets, services short
  of crew, crew unconfirmed, unpriced lines, packing, **blocking discussions
  (prep held)**, **overdue tasks**, **paperwork on file** (risk assessment,
  PO). `unknown` never counts as clear.
- **Money is two lines, not four tiles and two cards.** Quote: `$23,880 · v3
  accepted Thu 6 Nov · PO 77812`, the drift note under it (`2 lines added
  since · +$640 · see what changed ›`), text links `PDF · New version ·
  Finance ›` (or `Send quote` / `Record accept` when that is the next move).
  Invoicing: the derived state in words (`Deposit paid · $5,970 of $23,880`,
  `$17,910 outstanding · INV-0042 due …`, `Nothing invoiced yet`), the next
  step under it (`Balance $17,910 to raise after bump out`, or a draft waiting
  to be issued), links `+ Invoice ▾ · Record payment · Finance ›`. Margin is
  off by default (⋯ shows it). Replaces the Equipment / Services / Crew /
  Total strip, which belongs on Equipment and Logistics. Draft invoices never
  count as invoiced; `Deposit paid` is added to the invoicing states (today a
  paid deposit reads as `Draft`); settling every issued invoice at Awaiting
  payment auto-confirms with the live toast copy. One invoicing derivation,
  not two (`deriveInvoicingState` and `computePaymentProgress` disagree on
  credit notes and drafts today).
- **Three facts columns, editable in place**: When (rental, load in / load
  out, `Edit dates` → the same dates sheet Logistics uses, with "move services
  and crew calls with the window" and the confirmed-job availability
  re-check), Where (venue, address with `directions`, access note, `Edit` →
  venue, address, access, site contact), Who (site contact and phone, PMs with
  `+`, crew count with unconfirmed → Logistics). Then **Recent**: four lines
  of activity, `All activity ›`, `Discussion ›`. The facts stay shaped once in
  `project-context.ts` for the rail on the other tabs.
- **Phone:** the same column at 16 px gutters; a scrolling tab strip under the
  header; the progress line with only the current label, `Advance` below it
  full-width; the readiness sentence is the first screen.

**Prototype:** https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo

## 7. Job › Equipment — v2 proposal (prototype 2026-10-27, awaiting a yes)

> **Calm pass (2026-10-28).** Applied to this tab's prototype after the home:
> the Overview header (name · status · lock glyph; number · client · dates;
> `Documents ▾ · Edit · ⋯`), no card boxes, the toolbar reduced to words with
> the active view underlined, chips and status pills become a dot and a word,
> tags become muted text, row buttons become text links, ⋯ appears on hover,
> section rows lose their background band, green is kept for confirmed /
> paid dots only and red for shortages and crew gaps. Every control and
> flow is unchanged.

Same approach as the warehouse: the live tab's structure stays (header, stepper,
version strip, tab row, context rail, `Add ▾`, one table, hover actions, inline
cells, checkbox selection + bulk bar, drag and drop) and every feature that landed
since the rebrand gets a visible, consistent home on the row. Two **views** on one
toolbar (List · Client view; packing stays its own tab, D3 withdrawn), `Find`, `Filter ▾` (All · Short ·
Unpriced · Sub-hire · Optional · Hidden on documents · Needs review), ⋯ (Show cost &
margin, Sync accessories, Sync kits, Expand/Collapse) and `+ Add` (`A`).

### 7.1 The row
Columns: select · Item · **Availability** (new: `2 of 10 free`, `Short 2`, `External ·
Scene Change`, `30 to sell`) · Qty · Unit · [Cost · Margin] · Total · actions. The
Item cell carries the name, the kind tag (Kit · Group · n · Sub-hire · Custom · Sale ·
new stock / from fleet · Container) and the state the live tab keeps invisible:
**Optional**, price hidden / `price shown` inside a combined category, `ROI` excluded,
`Needs review` / `Follow up`, Prepped / Out, the sub-hire order's status pill, `added
after lock`. The sub-line holds serials assigned, the planned case, the accessory
summary (`accessories 3`, the included count only), the sub-hire order
(`SH-0012 · via Scene Change · 23% margin`), the note and `price set by hand`. One
contextual primary action: `Sub-hire 2` on a short line, `Confirm order` on a draft
sub-hire, `Price it` on an unpriced line. Category headers gain count, `n short` /
`n unpriced` / `Combined price` pills and a derived subtotal; delete asks and offers
Undo. A pinned **Services on documents** section at the bottom shows the billable
services with a link to Logistics, so the tab's total matches the quote.

The ⋯ menu is one list for every kind: Edit (E) · Edit accessories · Serials ·
kind-specific (kit price / itemised, sale source, open the order) · Sub-hire the
shortfall · Move to… (M) · Duplicate · Client documents (Show/Hide this price inside
a rollup, Mark optional) · Reporting (Exclude from ROI) · Collaboration (Needs
review, Follow up, Comment) · Delete (D, with Undo instead of no confirm).

### 7.2 Accessories — the same rows the packer sees
One row per accessory under its parent (gear lines too, not only kits): included
circle · name · `×n per unit` · **DEFAULT / OPTIONAL** tag · planned case · qty
(`per × line qty`) · `no charge` · state (Included / Added / Removed · reason) · ⋯
(remove with a reason, put back, change the per-unit quantity, pack into a case,
sync from the catalog). Clicking an included DEFAULT asks for a reason chip
(Client supplies · Not needed · Out of stock · Other…); the reason prints on the row
and in the log, exactly as on the floor (§9.5). One **Accessories editor** (from the
row's `Edit accessories`, the ⋯, or the Edit sheet's own section) lists defaults
and optionals with the same circles, per-unit steppers and reason fields, plus
`Sync from catalog`. Optionals not added stay out of the table (`1 optional not
added` under the rows). An accessory can be planned into a different case from its
parent, which is what the warehouse then shows under that case.

### 7.3 Adding — search first, details after
`+ Add` opens one popover (a sheet on phones): a search box, kind chips (All · Gear ·
Kits · Sub-hire · Custom · Sale · Templates) and a `to <category or group> ▾`
target. Results show availability and rate; a model already on the job says
`already ×4 here → ×5` and **combines** on Enter; an **asset tag** resolves to its
model with the serial assigned; free text offers `Add “…” as a custom line` and
`Sub-hire “…”`; Templates add a group with its members; Sale results show the sale
price. Enter adds one and keeps the popover open; a **Just added** strip holds the
last four with qty steppers, a `Short n · sub-hire` chip when the add overbooks, and
`Details` into the Edit sheet. Price, discount, notes, placement and accessories are
edited after adding (inline or in the sheet), never in the add form. The live
dialog's five tabs, two modes and three sections go.

### 7.4 Editing — one sheet, inline first
Qty, unit price, discount (`10%` or `85`), description (custom lines), notes, member
qty and sub-hire cost/charge are inline on desktop. The **Edit sheet** is one layout
for every kind, in sections: Item (qty with live availability, serials + Assign),
Pricing (unit, charged per day/week/hour/flat, discount $/%, tax override, Xero
coding), Client documents (show this price in a rollup, optional), Reporting
(exclude from ROI), Placement (category, group, planned case), Accessories (the
editor above), Notes. Under the pricing lock the money fields are disabled with a
`Pricing locked · Unlock` badge; unlocking is logged and offers Undo. Groups get the
same sheet with bundle price + suggested, discount, members with show-on-documents
switches. Bulk edit: charged, discount, optional, note, each behind its own switch.

### 7.5 Sub-hires — from shortfall to supplier and back
- **Shortfall → order in one sheet.** `Sub-hire 2` on a short line opens a sheet
  prefilled with the model, the shortfall, the job's hire window, the supplier chips
  (each showing its last cached rate for this model), **cost prefilled from that
  rate**, **charge prefilled from the line's own rate**, a live margin, and the
  choice between adding to an open draft order with that supplier or starting a new
  one. `Keep 2 from stock and sub-hire 2` splits the line. `Show on quote` / `Show as
  sub-hired` are set here. Submit lands the sub-hire line next to the original with
  Undo; the live "Sub-hire n units instead" link (closes the dialog, prefills
  nothing) goes.
- **On the row**: a sub-hire line or group shows the Sub-hire tag, the order's status
  pill (Draft · Confirmed · On hire · Returned · Cancelled), `SH-0012 · via
  supplier · n items · margin`, `External · supplier` in Availability, charge in
  Unit with cost beneath, and `Confirm order` as its primary action while draft.
  Members show cost and charge per day with inline edit.
- **Orders section** (replaces the "Sub-hire orders (n)" card): a pinned section at
  the end of the table, one row per order: number · supplier · status · PO · paid ·
  dates · items · cost · charge · margin, the next lifecycle action inline (Confirm
  order → Mark on hire → Mark returned) and ⋯ (open, add item, status, create PO,
  payment, attach, duplicate, cancel). `+` starts an order.
- **Order sheet**: header with the status trail, Cost / Charge / Margin tiles, the
  items with their placement and quote flags (Edit opens the sub-hire line sheet),
  `Add an item`, and the paperwork block (Create PO, supplier ref, payment segmented
  control, files). The sub-hire line sheet carries cost/charge/margin, pricing type,
  on quote / as sub-hired and placement, and is **not** gated by the pricing lock.
- **Margin everywhere it matters**: the footer shows sub-hire charge and margin, the
  Breakdown shows sub-hire charged on and confirmed cost, and `Show cost & margin`
  adds both columns (only sub-hire rows carry a cost).

### 7.6 Phone
Same list, 56 px rows (name + tags, state sub-line, total, `×qty` tap-to-step, ⋯);
accessory rows under an expanded parent; tap a row for the Edit sheet as a bottom
sheet; `+ Add` is the same search sheet; the orders section and services section
are rows. Menus are sheets without keyboard hints.

**Prototype:** https://claude.ai/artifact/BdwR4bNbiNMLSvfRAByEwC (v13, every flow
above wired with Undo).

## 8. Job › Logistics — v2 proposal (prototype 2026-10-27, awaiting a yes)

> **Calm pass (2026-10-28).** Applied to this tab's prototype after the home:
> the Overview header (name · status · lock glyph; number · client · dates;
> `Documents ▾ · Edit · ⋯`), no card boxes, the toolbar reduced to words with
> the active view underlined, chips and status pills become a dot and a word,
> tags become muted text, row buttons become text links, ⋯ appears on hover,
> section rows lose their background band, green is kept for confirmed /
> paid dots only and red for shortages and crew gaps. Every control and
> flow is unchanged.

The live tab's structure stays (`Add service ▾` by type and template, Generate,
Import, a date-grouped timeline, the services money summary, the Project crew
table) and gets the same clean-up as Equipment and the warehouse: the service
cards become rows, every fact gets one home, and crew can finally be worked from
the service they are on.

- **Dates on the page.** A facts strip above the card: Rental · charged, Load in,
  Load out, Venue (with the access note), Site contact. Each opens its editor in
  place. Moving the project window offers to **move the services and crew calls
  with it** (delivery and bump in follow load in; bump out and pickup follow load
  out) and re-checks availability as a heads-up, never a block. Today dates live
  only in the edit wizard and nothing moves when they change.
- **One timeline, lanes instead of cards.** Day headers (`Tue 11 Nov · load in`,
  with the day's service count, crew on, crew needed and charge) and one row per
  service: When (call window, plus the truck's own `drop 07:00` / `collect 06:00`
  for transport) · Service (type glyph, title, **status pill that is a menu**,
  note) · Where (address + directions, vehicle + trips) · Crew (role pill, avatar
  stack ringed by status, `3 of 4 · 1 needed`, `3 to offer`) · Charge (with cost
  and margin for managers, `on quote` / `internal`) · one primary action (`Pick 1
  crew` → `Send 2 offers` → `Confirm` → `Confirm`) · ⋯. Lane chips (All ·
  Transport · Site · Labour · Needs crew) and a `needs you` chip (`3 services short
  of crew · 4 offers to send · 1 unanswered`) replace scrolling for problems.
- **Two new service types: Client pick up and Client drop off.** The client
  moving the gear themselves is a service like any other, so it gets a row on
  the timeline, a crew call and a place on the call sheet — today it is a note
  in someone's head. Both sit in the Transport lane and the add menu groups
  them under `Client moves it` (next to `We move it` and `On site`). The sheet
  swaps Where for **Who collects / Who drops off**: the location is fixed to our
  warehouse counter, the client contact name, phone and vehicle + rego are
  captured (`Use the site contact` prefills), and the truck time becomes
  `Client collects at` / `Client drops off at` — the crew window above it is who
  staffs the counter. Default role Warehouse, 1 needed, no charge (the client
  is doing the transport; a handling fee can be typed). The warehouse page
  shows the job as a client collection / client return instead of a truck.
  Data: two new `projectServices.type` values (`CLIENT_PICKUP`,
  `CLIENT_DROPOFF`) plus client contact name / phone / vehicle fields on the
  service; phase derivation treats them as Handover / Return.
- **Crew from the call.** A service expands to its crew rows (avatar, name,
  preferred / clash tags, phase and window, **status pill as a menu**, rate, `Send
  offer` / `Resend` / `Confirm`, ⋯) and an `Add crew · 1 needed` row. **Pick
  crew** is one sheet: members sorted preferred → available → pencilled → booked,
  each with its availability for that day and rate, role filter on by default,
  `Request availability instead` for first-come-first-filled. Nothing blocks a
  double-booking; it is named on the row.
- **The service sheet** keeps every live field in five sections: When (date,
  window, truck time with its hint), Where (address, `Use venue`, vehicle with
  the org's recent vehicles, trips), Crew (role, needed stepper, assigned rows
  with rate and per, `Pick crew`, `Send offers`, `Confirm all accepted`), Money
  (charge, cost from crew rates or typed, live margin, role charge rate with
  `use $2,400`, the pricing lock), Notes. A new service with a headcount opens
  the picker on save.
- **The crew table** gains the column it was missing: **Service**. Rows show
  name (with preferred / no-email tags), role, service, when, availability,
  rate, status pill menu, ⋯ (Edit assignment, Send offer, .ics, Remove with
  Undo). Phase group headers stay. The summary counts active assignments and
  the labour estimate includes service-linked crew (today it excludes them).
  `Offer all · n`, `Message crew`, `Request availability`, `Call sheet` stay.
- **Dialogs**: Send offers lists who gets what, flags clashes and members with
  no email (skipped, call them); Message crew prefills venue, access, contact
  and schedule; Request availability shows who is eligible before sending; the
  call sheet picks days, role or one person and prints the access note and
  contact at the top.
- **Footer**: `On quote · Cost · Margin` once; the three-figure card and the
  per-card trio go. The ⋯ holds Show cost & margin, Generate missing, Import,
  timeline PDF, runsheet.
- **Phone = day mode.** Day chips (with a red count where crew are needed),
  cards with the call time in 18 px mono, status, where + Directions, note,
  crew avatars and one primary action; tap a card for the service sheet. The
  crew list for that day sits beneath with status pills. The separate read-only
  `/runsheet` page becomes this.

**Prototype:** https://claude.ai/artifact/E36tnBkGL9obdikUQ5mbXf

## 8b. Job › Finance — v2 proposal (prototype 2026-10-27, awaiting a yes)

> **Calm pass (2026-10-28).** Applied to this tab's prototype after the home:
> the Overview header (name · status · lock glyph; number · client · dates;
> `Documents ▾ · Edit · ⋯`), no card boxes, the toolbar reduced to words with
> the active view underlined, chips and status pills become a dot and a word,
> tags become muted text, row buttons become text links, ⋯ appears on hover,
> section rows lose their background band, green is kept for confirmed /
> paid dots only and red for shortages and crew gaps. Every control and
> flow is unchanged.

The live tab is a vertical stack with no containers: stale-pricing bar, quote
rail, invoice ledger, divider, billing row, financial summary, operational P&L.
Raw enum pills (`SENT`, `ISSUED`), two different "Outstanding"s, two margins, no
due dates on invoice rows, no overdue state, and the Xero connection visible
only as a per-row badge. The clean-up keeps the order (workflow first, reference
figures after) and gives each thing one shape.

- **The position in four tiles** at the top: **Quote** (version, frozen total
  inc GST, status pill, accepted date + reference or validity countdown, the one
  next action: Send / Mark accepted / Create v4) · **Invoiced** (of the total,
  invoicing state in words: Not started · Deposit paid · Awaiting payment ·
  Partially paid · Paid in full, `$19,701 not yet raised`, `Invoice ▾`) · **Paid**
  (of issued, outstanding with the next due or **overdue** invoice, `Record
  payment`) · **Margin ex GST** (percentage, bar, revenue and costs). The Overview
  cards read the same derivations.
- **Notices**: stale auto-pricing with `Recalculate`; drift against the document
  the client holds with `See what changed` and `Create v4`. Nothing else
  interrupts.
- **Quotes and Invoices side by side.** Quote rows: `v3` · human status (Draft ·
  Sent · Accepted · Declined · Expired · Recalled · Superseded) · Live tag ·
  label · frozen total · `sent 4 Nov to Priya Shah · accepted 6 Nov · ref PO
  77812` · validity with days left (warn inside 7 days, expired in red) ·
  lineage (`2 invoices from v3: INV-0041 $6,567, …`) · `Mark accepted` / `Send` ·
  PDF or Preview draft · ⋯ (view, compare with the job now, rename, chase,
  decline, recall, raise an invoice, delete draft). Clicking a row opens the
  revision viewer (`vs previous` / `vs the job now`). Invoice rows: number or
  `Deposit (draft)` · kind tag with its % · **one status pill that folds payment
  in** (Draft · Issued · Overdue · Part paid · Paid · Void · Credit) · Xero chip ·
  total · `issued 6 Nov · due 20 Nov` or `3 days overdue` or `paid 8 Nov` ·
  payments listed beneath with Void · `Issue` / `Record payment` / `Push to Xero` ·
  PDF · ⋯ (credit note, void, delete draft with a confirm and Undo).
- **Dialogs**, all from the live set, cleaned: Send (date, valid-for with the
  computed `valid until`, contact defaulting to the project's, notes, combine
  services, the summary from the job now, Preview draft; handover with Download
  PDF, Copy summary, the status move); Mark accepted (date, reference); Recall
  and Decline with reasons; Rename; Partial invoice (segmented % / $, the
  client's default, live amount, over-remaining guard); Issue (invoice date, due
  from the client's terms, notes, **Push to Xero after issuing**; handover with
  the `Move to Invoiced` offer for a balance or full invoice); Record payment
  (balance prefilled, date, method, reference, notes, the Xero read-back note);
  Void invoice and Void payment with reasons; **Credit note** (the server verb
  that has no UI today); Billing period (weeks + days, reset to derived, locked
  with pricing).
- **Financials** in two columns: Revenue (equipment, sale, services, sub-hire
  charged on, subtotal, discounts, GST from the org setting, total inc GST) and
  Costs (services & labour, confirmed sub-hire orders, maintenance, sale cost of
  goods, total) with **one margin, ex GST**, the groups-priced warning and a
  `Show group pricing` breakdown. The billing period is a line in the card's
  sub-heading with `change`, not its own row.
- **Xero** as one line: connected tenant, whether the client is mapped, invoices
  synced / to push / failed, `Push n`, `Check payments now`, Settings. Payments
  reconciled in Xero show on the row as `from Xero`.
- **Lock and versions**: the header chip opens the lock explanation and unlocks
  (logged, Undo); the version menu is the live one. Creating the next version
  unlocks pricing on it and leaves the client's document untouched; recalling a
  version restores the previous one to the status it had.
- **Phone**: tiles 2 × 2, the two cards stacked, rows wrap their pills, dialogs
  are bottom sheets.

**Prototype:** https://claude.ai/artifact/7ByfxnbtsgQTJdiwvvo1CY

## 8c. Job › Tasks & notes — merging Tasks, Notes and Files (prototype 2026-10-27 · calm revision, awaiting a yes)

Three tabs become one. Today Tasks is a bare list (add box, tick, edit
dialog; no filters, no inline edits, and the server's bulk and reorder
mutations have no UI), Notes is three textareas with a Save button each
(and crew notes print on nothing — the call sheet and runsheet print the
per-service notes, not the project's), and Files is a drop zone and a row
list with no category, no uploader or date, no download for anything but
images and no undo on Remove. None of the three writes to the Activity rail.
The project-level discussion lives behind a header button nobody finds. The
merged tab gives each of these a visible home on one screen, keeps every
field, and adds the obvious missing moves.

- **Calm, like the home.** The first cut was four cards each with a toolbar,
  chips, pills and a button per row. The revision keeps every capability and
  drops the chrome: four sections with small-caps headings and a count,
  hairline rows, one text control per heading (`Open ▾`, `Select`, ⋯;
  `Upload`; `v3 · live ▾`), meta as muted words that are themselves the
  menus (click the assignee to reassign, the date to re-date, the category to
  change it), ⋯ only on hover, notes as borderless text that gains a left rule
  on focus, the add row a bare line, red only on `overdue` and `Blocking`.
  The header is the Overview's (name · status · lock glyph; number · client ·
  dates; `Documents ▾ · Edit · ⋯`).
- **One tab, `Tasks & notes`**, badge `9/14` as today plus a red count of
  overdue tasks. Desktop is two columns: tasks then files on the left,
  notes then discussion on the right. The `?tab=tasks|notes|files` deep
  links all land here (readiness checks and the My tasks page keep
  working); phone shows the same four as segments at the top of the tab.
- **Tasks grouped by when, not by status.** Overdue (red), Today (amber),
  Tomorrow, This week, Later, No date, then a collapsed `Done · 9 · 1
  cancelled`. Chips `Open · Mine · Done · All` and a search. The add row
  sits at the top of the list (title, ↵ to add, `Due ▾` and `Assign ▾`
  chips to set them before adding). Each row: completion circle, title,
  `High`/`Low` tag, `In progress ▾` only when it is (To do is the default
  and needs no label), a one-line description, **link chips**, assignee
  (avatar, name, `crew` tag, click to reassign), due (click for Today /
  Tomorrow / load in / show day / load out / pick / clear), ⋯. Every write
  gets a toast with Undo. Select mode turns the circles into checkboxes
  and a bulk bar (Assign · Due · Mark done · Delete) uses the existing
  `bulkUpdate`/`bulkDelete`; a drag grip uses the existing `reorderNative`.
- **A task can be linked** to a file on this job, a service or an
  equipment line, so "confirm the PO" points at the PO and "print call
  sheets" points at Bump in. The link is a chip on the row and shows on
  the file's row in return. Data: a small `projectTaskLinks` table (or the
  parked `workItemLinks`), nothing on the task row itself.
- **Task sheet** keeps every live field (title, description, assignee from
  team + crew, due, status, priority) and adds the links and a history
  line (added by · when · done when). Delete asks nothing and offers Undo.
- **Notes: three cards with their audience on the label**, not in a
  placeholder: `Client notes · prints on the quote & invoice`, `Crew notes
  · prints on the call sheet & runsheet`, `Internal notes · only us · never
  printed`. Save on blur or ⌘↵ with a `Saved · Sam · Thu 6 Nov` /
  `Unsaved` line and a `136 / 5,000` counter; client notes get a Preview
  that renders the **bold** / *italic* / bullets the documents print. A
  version menu (`v3 · live ▾`) shows the notes as captured in an earlier
  version, read-only, instead of swapping the whole tab. Two behaviour
  changes ride with this: crew notes actually print at the top of the
  call sheet and runsheet (today nothing prints them), and note saves
  record `updatedBy`/`updatedAt` and write an Activity event.
- **Files: a category per file, who and when, open, download, rename,
  undo.** The row is thumbnail or type badge, name, a category chip that is
  a menu (the existing `ProjectMediaType` enum — Floor plan, Site map,
  Client brief, Risk assessment, Contract · PO, CAD, Photo, Quote, Invoice;
  today everything is written as `OTHER`), size, uploaded by · when, ⋯
  (Open, Download, Rename, Change category, Attach to a task, Remove with
  Undo). Chips `All · Documents · Photos`. The drop strip names the
  accepted types and the 50 MB cap; phone adds `Take a photo` (camera
  capture, like the warehouse). **Also on this job** lists, read-only, the
  files that live on other tabs — the sent quote and issued invoice PDFs,
  sub-hire attachments, incident photos — each with its origin tag and an
  open link, so one place answers "what documents do we have for this
  job" without moving any of them. Removing a file clears any task link to
  it; a category guess from the file name is editable on the row.
- **Discussion moves onto the tab.** The project-level comment threads
  (today the header `Comments` button) render under the notes: compose
  with `@ Mention ▾` and a `Blocking · holds prep & dispatch` switch,
  threads with author, age, mentions, the blocking pill, reply count,
  inline replies and `Resolve` / `Block prep`; resolved threads fold away.
  Line-item threads stay on their rows on Equipment and are counted here
  (`On line items · 2 open ↗`). The header keeps a count badge that jumps
  here. Nothing about who may block or resolve changes.
- **Readiness** gains two rows the rail can show on every tab: overdue
  tasks and blocking discussions (prep held). Task, note and file writes
  start writing `activityEvents` so the Activity rail finally shows them.
- **Phone:** the same four sections stacked, with a sticky `Tasks · Notes ·
  Files · Discussion` chip row that jumps to each; files get the camera
  button. The task sheet and every menu are bottom sheets.

**Prototype:** https://claude.ai/artifact/BrLBitu3c2V4uixLQbXCNE

## 9. Warehouse

> **Calm pass (2026-10-28).** The locked warehouse job page gets the same
> visual pass as the job tabs, with its structure, scan pipeline and gates
> untouched: the stage strip becomes words with counts (active one
> underlined, the progress bar thinned), the toolbar's checks / case / find
> controls become words with the active case underlined, status pills a dot
> and a word, tier tags muted text, serial chips hairline, row actions text
> links on desktop (the phone keeps its large Prep / Pack / Deploy buttons),
> section and case headers lose their bands, the footer is one muted line.
> The scan dock and the one primary action are the only loud things left.

### 9.1 The floor (`/warehouse`)
A board, not a hub: title, the `ScanDock` with scope (This job · Any job), a
**Returns mode** button, four tiles (To pack · Out on site · Coming back · Overdue)
and three columns — **Pack today & tomorrow** (sorted by truck time), **Out on
site**, **Back · to close out**. Each job card is the same card: number, stage pill,
name, client, truck time + vehicle, progress bar with `24 of 42`, who is packing,
primary action (Open · Start pack · Chase · Close out), ⋯. The "Actions ▾ → Mark
deployed / returned / completed" manual overrides leave the card (they ignore item
state); they stay in the job ⋯ as an admin action with a confirmation.

### 9.2 The job (`/warehouse/[projectId]`) — locked 2026-10-27
The live page's structure stays; the clutter goes. Operators know it and the
experience is sound, so this is a clean-up, not a re-think (three alternative
directions were prototyped and rejected — see the prototype link above).

- **Header**: back · number · status pill · truck time + vehicle + dock · title ·
  `Documents ▾` · `View project ↗` · ⋯ (print pull slip, labels, expand/collapse,
  admin overrides). The job-level facts stay in the header; nothing else does.
- **One stage row.** The stepper and the six tabs merge: Pick · Prepped · Deployed ·
  Returned · De-prepped · Close-out, each a clickable tab carrying its count, with a
  thin progress bar underneath. No separate non-clickable stepper.
- **One card** holding, top to bottom: the scan box (camera button beside it; the
  placeholder names the stage's verb — "Scan or enter asset tag to prep…"), the
  **result line** for the last scan (tone-coloured left edge, tag, name, what
  happened, Undo), then two toolbar rows:
  - **Row 1**: `Checks` segmented control (As I scan · Bulk after, with a `Run checks ·
    n` button when any are pending) · `Packing into` case chips with packed counts
    (the active case is the highlighted chip; a sealed case refuses to be active) ·
    `+ New` · right: the `n need you` chip (filters to shorts, failed checks, missing
    accessories, damage) · Find.
  - **Row 2**: the stage's actions, left-aligned like the live page. Pick: **one
    `Prep ▾` split button** (replaces the three Prep / Prep without accessories /
    Prep accessories only buttons — §9.5). Prepped: `Deploy all · n` · `Move to…` ·
    `Move to Pick`. Later stages: `Receive all · n` / `De-prep all · n`.
- **One table**: select · Item · Asset tag · case · Qty · Status · actions. Pick
  groups by category (sorted by shelf); Prepped onward groups by **case**, each case
  header carrying kind, packed count, Sealed / Packing pill, Active pill and a ⋯
  (seal, make active, print label, unpack everything, remove). The row is a `LineRow`:
  name, kit tag, planned-case tag, sub-line (serialised/bulk count · shelf · check on
  prep · short + PO due · accessories summary), one contextual primary action (`Prep
  8`, `Prep + acc.`, `Pack 2 accessories`, `Deploy 6`, `Receive 2`) and ⋯.
- **Child rows** under an expanded line: kit members with verify circles, the unit
  chips (tag · case, tinted by stage, failed checks marked), and one row per
  accessory (§9.5). A kit scan verifies the member it matched; `Prep` on an
  unverified kit asks once (Verify first · Prep anyway).
- **Drag and drop** on the Prepped tab: a line or an accessory row dropped on a case
  header moves there; dropping a parent takes the accessories that share its case
  with it; the Loose header takes things out of a case.
- The containers **right rail is gone**: the case chips in the toolbar and the case
  headers in the table carry everything it held. Planned vs packed stays visible on
  the row (`Planned → VID-04` tag on Pick) and prepping into "Loose" no longer
  overrides the plan (`containerId` only sent when the packer chose a case).
- Condition on return is recorded per row through the return check / row sheet, the
  same way on the job page and in Returns mode.
- The online pick list's localStorage ticks go; "picked" is the `Pick → Prepped`
  transition. The pull-sheet route becomes the print view of the same list.
- **Scan outcomes, one pipeline**: a tag on this job preps / deploys / receives /
  de-preps for the current stage; a case tag makes that case active; an already-done
  unit says so and offers `Move to <active case>` only when it is somewhere else; a
  tag from another job offers "Add to this job and prep it" (the PM is told);
  an unknown tag offers type-the-tag or register. Every write lands in the result
  line with Undo. Scanning a parent with a prep check opens the check inline first
  ("As I scan") or queues it ("Bulk after").

### 9.3 Returns station
Becomes **Returns mode**: the same `ScanDock` with scope Any job, the same `ScanStrip`,
the same row sheet for condition, and the "Everything out" board rendered with the same
job cards. Single-asset and bulk returns gain Undo because they go through the one
pipeline. The board subscribes live instead of a manual refresh.

### 9.4 Phone pack mode — locked 2026-10-27
The same page, not a different app: phone header (back · title · number · status ·
truck time · ⋯) · the stage row as one horizontally scrolling strip · the scan box
with the camera button (camera opens a sheet with the reticle and the stage + active
case pinned over it) · result line · `Checks` · case chips · `n need you` · the
stage action. Rows are 60 px: name, kit tag, shelf · planned case · accessories
summary, a big count, one 36 px primary button (`Prep` / `Pack` / `Deploy` / `Receive`),
⋯. Prepped groups by case like the desktop table, with relocated accessories as
their own rows. Tapping a row opens the **row sheet**: status + case tags, name, tags
and count, **accessories first** (one line each with tier, state, case and a `Pack` /
`Move` / `Pack anyway` button), `Pack into` case chips, the unit chips, `More…`, and
one primary action. `BulkBar` above the bottom nav when anything is selected.
Offline scans show as neutral result-line entries, never silent.

### 9.5 Accessories on the floor — locked 2026-10-27
The prep-with / prep-without / accessories-only trio was the messiest part of the
live page. The rule set that replaces it:

- **An accessory is a row under its parent**, never a modifier on the parent's
  button. Each row shows: verify circle (empty · half when partly packed · tick ·
  struck when skipped · ✕ when missing) · name · `×n per unit` · tier tag
  **DEFAULT** / **OPTIONAL** · `added` when the PM added it · case column (`not with
  parent` when it sits in a different case) · qty (`7/12` while split) · state pill ·
  one action · ⋯. Vocabulary: **To pick · Packed · In BATT-01 · Out · Back ·
  Missing · Skipped · reason**.
- **One `Prep ▾` button**, context-aware. Parent still to pick: `Prep n + accessories`
  (default) / `Parent only · accessories stay to pick` / `Choose which…`. Parent
  already packed: `Pack accessories with the parent` (into the parent's case) / `…
  into the active case` / `Choose which…` / `Unpack parent`. The row's own primary
  button is the same default (`Prep + acc.`, then `Pack 2 accessories`).
- **Scanning an accessory packs it** into the active case and the result line says
  which parent it rides with and `n of m packed`. A bulk accessory's bin barcode asks
  how many. An accessory can live in a different case from its parent (batteries in
  the battery box) — the row says so, the Prepped tab lists it under that case as
  `accessory of <parent> · parent in LX-04`, and it still deploys and returns with
  the parent.
- **Scanning a parent packs its accessories silently** unless something is split or
  skipped; then one sheet lists each accessory with where it is and Pack / Later /
  Pack anyway / Keep, plus **"Remember for the next n <units>"** so a six-beltpack
  line asks once. `Parent only` is the sheet's secondary action.
- **Skipping** a DEFAULT accessory on the floor needs a reason chip (Still charging ·
  Out of stock · Client supplies · Not needed); the reason prints on the row and in
  the activity log. `Pack anyway` reverses an office skip and keeps the note in the
  log.
- **Deploy gate**, only when an accessory is unpacked or skipped: a checklist, one
  row per accessory, `Pack now` / `Leave`; a DEFAULT left behind asks why (same
  chips, `Other…` with a note); packed accessories read "deploys with the parent ·
  nothing to do"; unverified ones are one line in the footer, not a block.
- **Return check**, only when accessories went out: tick what came back (`All back`
  shortcut); anything unticked is reported missing on that parent, shows as a
  `Missing` state on the row and on the close-out summary with "charge the client?".
- **Cascade**: deploy / receive / de-prep move the parent's accessories with it
  whatever case they are in; unpacking a parent leaves its accessories where they are
  and says so.
- The footer carries the accessory tally separately: `accessories: 30 packed · 11 to
  pick · 1 skipped`.

Open on this (§12, D8–D10): bulk accessory verification on count vs per scan,
whether managers skip the reason or get it prefilled, and whether "remember" is per
job or per session.

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
| 3 | Warehouse job page | Stage row replaces tabs + stepper; one card, one table (category on Pick, case from Prepped); `ScanDock` + result line; one scan pipeline with Undo + tone for every result; case chips + case headers replace the rail; accessory rows + `Prep ▾` + scan sheet + deploy gate + return check (§9.5); phone pack mode + row sheet; delete the localStorage pick list; the Returned-tab chip bug | L |
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
| D3 | Packing tab becomes a view of Equipment | **Withdrawn 2026-10-27** — the Packing view came out of the Equipment prototype; the tab stays and gets the drag-and-drop case planning on its own | — |
| D4 | Runsheet route is replaced by Logistics day mode on phones | Yes — one rendering of one data set | Keep both |
| D5 | Mira moves to the top bar | Yes | Keep the floating button, raise it above the bulk bar |
| D6 | Manual "Mark deployed / returned / completed" leave the floor cards | Yes, into the job ⋯ with a confirm | Keep on the card |
| D7 | "Projects" → "Jobs" in every label (routes unchanged) | Yes — the bottom nav and "New job" already say it | Rename the bottom nav to Projects |
| D8 | Bulk accessories (batteries, pouches) verify on **count** at the bin barcode, not one scan per unit | Yes — they carry no tag; the bin barcode + "how many" is one scan | Per-unit scan of a shared bin code |
| D9 | Managers deploying with a DEFAULT accessory left behind get the reason **prefilled** from the office note, still editable | Yes — one tap, still logged | Managers skip the reason entirely (today's `logAccessoryCheckoutOverride` behaviour) |
| D10 | "Remember for the next n" on the scan sheet is scoped to the **job** | Yes — the choice is about this job's gear | Per packer session |

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
