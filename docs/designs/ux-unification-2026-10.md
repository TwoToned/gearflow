---
status: PROPOSED
updated: 2026-11-04
---
# UX unification — one list, one row, one menu, works on a phone

> _Owner: Jayden Nawotka · Last reviewed: 2026-10-27 (review quarterly — POLICY.md R-5.5)_

**Mockups:** https://claude.ai/artifact/HHjfzi1NUL5PEQDQMxM6KU (private canvas, 11
artboards: Equipment desktop + phone + line editor sheet, Logistics desktop + phone
day mode, Warehouse job desktop + phone pack mode + scan sheet, the floor board, the
shell at three widths, and the primitives every surface is built from).

**How to redesign the next surface:** [`ux-redesign-playbook.md`](./ux-redesign-playbook.md)
— the method, the language, the surface patterns, the prototype kit
(`docs/designs/prototype-kit/`) and a brief per remaining surface.

**Clickable prototypes** (state-driven HTML, every action wired, Undo on every write):
- Job › Equipment: https://claude.ai/artifact/BdwR4bNbiNMLSvfRAByEwC — v2 (§7): the
  live tab cleaned up with every feature on the row, accessory rows + editor,
  search-first add, one edit sheet, the shortfall → sub-hire sheet, order rows and
  the order sheet, plus the earlier inline editing and drag and drop.
- Logistics: https://claude.ai/artifact/E36tnBkGL9obdikUQ5mbXf — v2 (§8).
- Finance: https://claude.ai/artifact/7ByfxnbtsgQTJdiwvvo1CY — v2 (§8b).
- Job › Overview + page header: https://claude.ai/artifact/RatKsWfTmDJLJHmn6mb7Zo — v1 (§6b).
- Tasks & notes (Tasks + Notes + Files merged): https://claude.ai/artifact/BrLBitu3c2V4uixLQbXCNE — v1 (§8c).
- Jobs list: https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd — v1 (§9b).
- Assets registry: https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw — v1 (§9b).
- Home (+ My tasks, Notifications, Activity): https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR — v1 (§6c).
- Job › Packing + Versions: https://claude.ai/artifact/HSAZTyzfjG2A7sCjUe9wsM — v1 (§7b).
- New job wizard + job edit sheet: https://claude.ai/artifact/GgtKxc5WZP33gXihgFTB9B — v1 (§7c).
- Warehouse floor + Returning mode: https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA — v1 (§9c).
- Asset detail + asset forms: https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s — v1 (§9d).
- Model detail: https://claude.ai/artifact/47miWruJVsednbzrFPij2b — v1 (§9e).
- Crew, Clients, Suppliers lists: https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa — v1 (§9f).
- Models, Kits, Locations, Maintenance, Test & tag, Sales stock, Overbookings lists: https://claude.ai/artifact/D7N5PmXKrkcY2gzZXWeuvc — v1 (§9g).
- Crew planner + Timesheets: https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui — v1 (§9h).
- Scan · Check + Test & tag: https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX — v1 (§9i).
- Finance hub: https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom — v1 (§9j).
- Settings (index + Team): https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8 — v1 (§9k).
- Forms (every create and edit sheet): https://claude.ai/artifact/REMbu5TYg5Nx6iJJoPLuGy — v1 (§9l).
- App shell (sidebar, tablet rail, ⌘K, Mira, phone nav + More): https://claude.ai/artifact/B4JAamBGiX6ypauLucopa2 — v1 (§6d).
- People records (client, crew member, supplier, supplier order): https://claude.ai/artifact/D8UV81TDFpMEeUBxf2apUX — v1 (§9m).
- Gear records (location, kit, maintenance job, T&T, category): https://claude.ai/artifact/PDsjUdku2seVZAWfNC6W61 — v1 (§9n).
- Schedule (jobs + gear timeline): https://claude.ai/artifact/49jbSumcZhVdCU9ZA3nqdm — v1 (§9o).
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

## 6c. Home › Dashboard, My tasks, Notifications, Activity — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/3d6zqfosL5hYRvXLBYLnhR — desktop 1440 and phone 390, every control wired (four views switched by words in the head / chips on phone; stat words with deep-link targets; Needs me and On now rows with ⋯; setup panel dismiss, page ⋯ toggle and Undo; Customise… dialog with 11 widget switches and Reset; My tasks tick + Undo, due menu, select mode with shift-range and bulk `Done n` / `Set due…`, Done strip, New task; Notifications mark read / unread, range select, bulk, Mark all read, Undo, empty state; Activity Mine·Today·All, Actor/Action/Entity filters, search, saved views, record scope, Export, pager / Show more).

### 6c.1 Why
`/dashboard` (`src/app/(app)/dashboard/page.tsx`) is a card grid: four tiles, a chip tray, three list cards and two checklist cards, each with its own border and shadow (`dashboard-card.tsx`), so Home is the busiest page in the app and the opposite of Overview. Three findings. The stat tiles link to bare routes (`stat-tile-widgets.tsx:71,86` both `/projects`), so the number you clicked is gone on arrival. "On the floor now" is described as org-wide but reads `useNativeHome().myProjects` (`on-the-floor-now-widget.tsx:71`), and "All activity" lands on the audit log while the widget shows scans and tests (`recent-activity-widget.tsx:29`) — two different feeds under one name. The three secondary pages are the old pattern: `/notifications` has a per-row `Dismiss` button and `Dismiss All` (`notifications/page.tsx`), `/my-tasks` completes with no undo and cannot create, `/activity` is a six-column DataTable of an audit trail nobody reads as a table.

### 6c.2 The page
Calm like Overview: no card chrome, hairlines, dot-words. Head: a greeting, the date and org, the four views as words (`Home · My tasks 8 · Notifications 6 · Activity`, active underlined), the one primary `+ New job`, page ⋯ (Warehouse, Add gear, Setup panel, Customise…). Below it, in order: the setup panel (when anything is undone), four stat words, two columns **Needs me** and **On now**, a second band **My tasks** and **Coming up**, then **Recent activity**.
- **Stat words.** `14 Active jobs · 2 Overdue returns · 41 Gear deployed · 9 Crew booked`. Each is a link to the list segment it counts, target in a tooltip (`Jobs list · ?seg=out&overdue=1`). Overdue prints red only when non-zero. The utilisation meter becomes `65% of 63 out`.
- **Needs me** is the union of the lists' exception segments, derived and never stored: dot-word flag + mono id, one muted line, the destination at the right (`Overview ›`, `Finance ›`, `Logistics ›`, `Overbookings ›`, `Asset ›`). Six shown, `and 2 more ›`. Row ⋯: Open, the list segment it came from, Copy link.
- **On now** is three groups: On the floor, Out today (truck times, mono), Due back (overdue prints as a red dot-word). Group names link to the floor.
- **Setup panel.** Finish setup and Get started merge into one left-ruled panel listing only what is undone with a segmented progress hairline; it hides when nothing is undone. `Dismiss` (the panel's own word) toasts with Undo; the page ⋯ `Setup panel` brings it back, which the live dismissal cannot.
- **Recent activity** keeps its data (scans, tests, maintenance) in the Discussion rendering: dated groups, initials, one sentence, clock time.
- **Customise….** The grid is no longer the default. The dialog lists the 11 live widgets with a switch each (each maps to one piece of Home), `Reset to default` (toast + Undo) and `Arrange on a grid…`, which opens today's drag-and-resize board with the saved arrangement intact.

### 6c.3 My tasks, Notifications, Activity
- **My tasks.** Strip `Open 8 · Done 2`; open tasks grouped Overdue / Today / This week / Later / No date with mono counts. The round tick completes with an Undo toast (same circle as Tasks & notes). Select tasks… (⋯) swaps ticks for checkboxes, shift-click ranges, bulk bar `Done 4 · Set due…`. Row ⋯: Open on the job, Mark done, Set due…. Primary `+ New task` (job or Personal, due) closes the gap that personal tasks exist but cannot be added here.
- **Notifications.** Strip `Unread 6 · All 10`, grouped Today / Yesterday / This week / Earlier. Row: title, dot-word type + one muted line, time. Always-on checkboxes, shift-range, bulk `Mark read 4` / `Mark unread n`; primary `Mark all read` (hidden at zero; the empty state says `All caught up`). Opening a row marks it read, as today. Everything is Undo-able. Live "dismiss" is renamed "mark read" (it is a per-user server dismissal that self-prunes when the cause clears).
- **Activity.** Strip `Mine · Today · All`; filter words `Actor ▾ Action ▾ Entity ▾`, search, `Views ▾`, `Record: #2340 ✕` for the live `entityType/entityId` scope (row ⋯ › `Only #2340`), Export CSV in ⋯. Dated rows: `Name did X`, muted `Action · Entity`, an `agent` dot-word for API-authored writes (live Actor badge), time at the right. No primary: it is read-only. Desktop pager `60 events · 1–25`; phone `Show 25 more`.

### 6c.4 Phone
Phone header `Home` + `Mon 9 Nov · Two Toned Productions`, ⋯ as a bottom sheet; sub-views get a back chevron. The four views are a scrolling chip strip under the header. One column in the same order; the stat words are a 2×2 grid; rows are 60–64 px with a 40 px ⋯ always visible; the destination word is dropped (it is the first ⋯ item). The sticky primary is `+ New job` / `+ New task` / `Mark all read` above the bottom nav (Home item active); the bulk bar replaces it while anything is selected; Activity has none. Menus and dialogs are bottom sheets; the grid option is desktop-only.

### 6c.5 Code
Reuses the kit's strip, filter words, pager, `openMenu` / `openDialog` / `toast`, bulk bar, `.dotw`. In the app: stat words and Needs me read the same hooks (`useNativeDashboardStats`, `useNativeBlocking`, `useNativeOverbookingCounts`, `useNativeOrgFinanceCounts`, `useNativePendingCrewOffers`); the default layout is a plain component, `DashboardGrid` only mounts from Customise. Targets come from one `LIST_SEGMENTS` map shared with the lists' own strips (R-3.1). Notifications/My tasks/Activity adopt the §9b shell; `DashboardCard` chrome and the chip tray go. The old per-row Dismiss and `Dismiss All` go.

Decisions raised: D14–D18 (§12).

---

## 6d. Shell — sidebar, rail, top bar, ⌘K, Mira, bell, phone nav — v1 proposal (prototype 2026-11-05, awaiting a yes)

**Prototype:** https://claude.ai/artifact/B4JAamBGiX6ypauLucopa2 — desktop 1440, tablet rail 1024 and phone 390, every control wired (sidebar items, sub-page toggle, collapse + ⌘B + auto rail ≤ 1023 with flyouts, org switcher with Undo, user menu with theme words and shortcuts, breadcrumb trails for four page types, ⌘K palette with recents, number/name/date search, `@` pages, `/` actions, arrows and Enter; Mira panel with Confirm, Dismiss, Undo, New chat and the write-access switch; bell with mark-read, Mark all read and Undo; phone bottom nav, camera sheet, More sheet with drill-down, full-screen search, header; "Signed in as" switch showing the permission gates; the D1 alternative).

### 6d.1 Why
`src/components/layout/*` and `(app)/layout.tsx`. Findings: the top bar shows one non-link title that drops id segments, so a job page reads "Projects" (`top-bar.tsx:45-60`, labels still "Projects"/"Availability" at :34,:30); the phone has no Scan, no gating and reaches Test & tag, Maintenance, Clients only through a hamburger drawer (`mobile-nav.tsx:34-40`), and the theme toggle is `hidden sm:flex` so it is unreachable there (`top-bar.tsx:104`); Mira is a `fixed bottom-20 right-4` FAB over every page, on top of the bulk bar (`mira-launcher.tsx:42`). Also: 13 sub-rows always inline in the sidebar, 248 px width against DESIGN's 220 (`(app)/layout.tsx:46`), ⌘B collapse is not in the shortcuts list, the bell reads mentions only while `/notifications` reads a derived feed, and ten prototypes each hand-roll their own nav and bottom-nav hrefs.

### 6d.2 The page (desktop)
- **Sidebar 220.** Brand, org row (the switcher), three hairline groups in main spec §6.1 order: Home · Jobs · Finance · Schedule | Crew · Assets · Warehouse · Test & tag · Maintenance | More: Clients · Suppliers · Locations · Activity. Settings, the user row and `‹ Collapse ⌘B` sit at the foot. Icons keep their module hue; the active row is a tint, never a red fill. Sub-pages show under the active module and on a hover `›` toggle (so all 13 stay reachable, none shout). Gated items are absent, never greyed.
- **Rail 72** at ≤ 1023 automatically and by `Collapse`/⌘B at any width (remembered). Icon + 10.5 px label; click opens a flyout (`Open Assets`, sub-pages); `More` holds the four secondary items; the org row becomes initials.
- **Top bar** (56): a real trail `Jobs › #2341 Hilton Sydney gala dinner › Equipment`, each segment a link, last one ink; then the search field `Search or jump to… ⌘K`, `Mira`, and the bell with a mono count (no filled badge, no `9+`).
- **Org switcher** is the sidebar head; the user menu is personal: Account settings, My crew profile (when linked), Theme `Dark Light` words, Keyboard shortcuts, Sign out last and red. Switching org toasts with Undo and lands on Home; role per org changes the gates.
- **Home** placeholder shows only what the shell needs.

### 6d.3 ⌘K — search first
- Empty: **Recent** (5) then **Actions** (New job `N`, Scan, New asset, New client; on a job or asset page an `On #2341` group first).
- Typing matches job number (`2341`, `#2341`), asset tag (`aura 01` = AURA-01), name words, contact names (`priya`), grouped Jobs / Assets / Models / Clients / Crew / Suppliers / Locations, best group first, four rows each and `Show all 7 in Assets ›`. A date (`14/11`, `14 nov`) lists the jobs on that day. `@` pages, `/` actions (also bare `/` opens it), kept from live.
- ↑ ↓ move, Enter opens the highlighted row, Esc closes, ⌘K toggles. Row = mono id, name, muted sub, dot-word status, mono dates. Opening a row moves it to the top of Recent. Nothing matching says `Nothing matches “…”` with the next step.
- Gates apply (no New job for a viewer). Drill-down (`Shift+→`) stays as live.

### 6d.4 Mira (D5)
A `Mira` word in the top bar toggles a 384 px panel under it: hairline left edge, no shadow, overlays the page, Esc closes. Discussion rendering: initials, one sentence, tool lines in mono, no bubbles. A `danger: high` call stops at a left-ruled **Confirm** card: operation, args, estimate, `Confirm` (ink, not red) and `Dismiss`, plus the line "Mira cannot approve this itself". Confirm replays the stored call as the user, toasts and has Undo; with org write access off the card says so and has no button. ⋯: New chat, Mira settings, write access (prototype of the org setting). The panel header names the page Mira is looking at. Per CLAUDE.md, no `confirm` parameter is ever model-visible.

### 6d.5 Bell
Count + menu of dated rows (unread dot, title, dot-word type, one muted line, time), `Mark all read` with Undo, `All notifications ›` to Home. Open = mark read. Open question: live bell is mentions-only; this assumes it shows the same feed as Home › Notifications.

### 6d.6 Phone
- Header per page: back chevron + title + one identity line (the trail's last segment; chevron goes to the parent crumb), then `⌕`, Mira, bell with count, ⋯. These are the only icon buttons allowed (global chrome, aria-labelled).
- **Bottom nav (D1): Home · Jobs · Scan · Warehouse · More.** Scan is a 50 px red circle raised 8 px inside the bar, so it never overlaps the 44 px sticky primary above (checked: 2 px clear). Gated: a role without warehouse loses Scan and Warehouse (live bar is ungated). Active = red; More is active on Crew, Assets, Settings pages.
- **Scan** opens the camera sheet from the tap (copied from the Scan prototype); outside a job it looks the tag up and offers `Open asset ›`.
- **More sheet** (88 %, 48 px rows): user head (taps to account menu with Theme and Sign out), Plan: Schedule, Finance `1 overdue`, Overbookings `5 overbooked`, Job templates; Crew and gear: Crew 28 ›, Assets 605 ›, Test & tag `4 overdue` ›, Maintenance `20 open · 5 overdue`, Locations 13, Returns `2 overdue`; People: Clients 26, Suppliers 13; Account: Activity, Settings ›. › rows drill to Open X + sub-pages. Replaces the hamburger drawer.
- **Search** is a full-screen sheet: input 16 px, `Cancel`, word chips `@ Pages  / Actions  Scan a tag`, 58 px rows. Mira is a full-height sheet, the bell a bottom sheet.

### 6d.7 D1's alternative, and why not
Alternative: keep Home · Jobs · Warehouse · Crew · Assets and add a floating Scan button. The prototype's "Bottom nav" switch shows it: the button sits on top of the sticky primary and the last row's ⋯ (checked: overlaps), and it breaks principle 8 "nothing floats". Crew and Assets are the cost of D1: they move to More (two taps), which is the right trade because Scan is the daily verb and Crew/Assets are looked up.

### 6d.8 What every other prototype changes when D1 is accepted
- Kit `shell.html` `.bottomnav`: Assets item becomes `More` (button, opens the More sheet), icons become SVG, centre Scan keeps `.scan` but 50 px / -9 px; `assemble.mjs` `__NAVASSETS__` argument goes (More is active on Crew, Assets, Settings).
- `core.js`: `renderNav` list (Dashboard -> Home, Maintenance coral, More group) and a shared `moreSheet()`; better, ship the shell as one `shell.js` module (the sidebar, top bar, crumbs, bottom nav) so the ten pages stop rewriting `.bottomnav a` hrefs and `.crumb` (finance, floor, home, model, packing, planner, scan, wizard, settings, people).
- Per prototype: `#assets` href rewrites become `data-act="more"`; the Scan prototype's `a[href="#scan"]` hook stays; Assets list and Gear lists set `More` active instead of `Assets`; phone headers adopt search / Mira / bell icons; top bar gains `Mira` and the bell.

### 6d.9 Code
Compose: one `NAV` table (`src/lib/nav.ts`: key, label, hue, url, resource, subs, group, count source) feeding `AppSidebar`, the rail flyouts, `MobileNav`'s More sheet and the palette's `@` pages (R-3.1); `Breadcrumbs` built from route segments plus a per-page `useBreadcrumbs` entity label, replacing `getPageTitle`; `ScanSheet` reused from the Scan surface; `MiraLauncher` becomes the top-bar word and `MiraPanel` loses `fixed bottom-20`. `use-mobile.ts` and the kit disagree (768 vs 859): pick one constant. Goes: the FAB, the hamburger drawer on phone, `segmentLabels` "Projects"/"Availability", My tasks rail item.

Decisions raised: D65–D70 (§12).

---

## 7. Job › Equipment — v2 proposal (prototype 2026-10-27, awaiting a yes)

> **Calm pass (2026-10-28).** Applied to this tab's prototype after the home:
> the Overview header (name · status · lock glyph; number · client · dates;
> `Documents ▾ · Edit · ⋯`), no card boxes, the toolbar reduced to words with
> the active view underlined, chips and status pills become a dot and a word,
> tags become muted text, row buttons become text links, ⋯ appears on hover,
> section rows lose their background band, green is kept for confirmed /
> paid dots only and red for shortages and crew gaps. Every control and
> flow is unchanged.

> **Rows select with checkboxes, no per-row action link** (2026-11-04). The
> `Sub-hire 2` / `Confirm order` / `Price` links in the row go; the row's
> `● Short 2` status and its ⋯ keep the single-line verbs. Checkboxes are
> always on, on the phone too (the select-mode toggle is gone), and the bulk
> bar carries the actions for the ticked lines: `Edit… · Move to… · Exclude
> from ROI · Delete` plus, when they apply, `Sub-hire N short` (opens the
> sub-hire sheet for the shortfall) and `Confirm N orders`. On the phone the
> bulk bar replaces the sticky `+ Add line` bar while anything is ticked.

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

## 7b. Job › Packing and Versions — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/HSAZTyzfjG2A7sCjUe9wsM — desktop 1440 and phone 390, every control wired (drag a line onto a case, tick + shift-tick + `Plan into…`, row and case ⋯, add / rename / seal / delete case with Undo, search and filter words, version chip menu, Versions tab rows, Compare sheet with side pickers, Make live dialog with conflicts and Undo, Save as new version, rename, delete, `V`).

### 7b.1 Why
Live: `src/components/projects/packing-tab.tsx` (194 lines), `versions-panel.tsx`, `version-strip.tsx`, `version-switcher.tsx`, `finance/make-live-dialog.tsx`. Findings: (1) planning is one native `<select>` per row, one line per write, silent on success, no bulk, no undo (`packing-tab.tsx:57-71,153-157`); drag was deferred (`:140-144`). (2) A packed line's select is disabled and reads "Not planned" while the line sits in its packed case's bucket (`:59-60`) — the plan and the reality contradict on screen. (3) Rename and delete container have hooks (`use-project-container-writes.ts:23-24`) but no UI; the tab carries no count. (4) Versions is a right Sheet opened from the header pill or `V` (`versions-panel.tsx:235`); Compare is a separate page mode launched only from the pill menu, and the panel's own docstring still calls Compare a stub (`:28`); Make live shows no preview of what follows (`make-live-dialog.tsx:85-89`).

### 7b.2 The page
Header, desktop tab strip and phone strip are Overview's, with two entries added: `Packing 36/44` (planned/total, derived, like `Tasks & notes 9/14`) and `Versions 3`. The tab row carries the tab's one red primary on the right: `+ Add case` / `Save as new version` (the live page already shares that row with the active tab's action). The version chip `v3 · Live ▾` sits in the meta line; viewing a draft shows the quiet info strip with `Make v2 live` / `Back to live`, and Packing follows the viewed version (live passes `versionId`).

**Packing.** Left, sticky: one dashed **Unplanned** card (8). Right: **case cards** in two columns (LX-02, LX-04, VID-04, BATT-01): name mono, kind muted, `11 lines · 3 packed`, a header checkbox that selects the card, ⋯ on hover. Rows are 46 px: title, muted `Category · Kit · Sub-hire · Custom`, `×qty`, ⋯. Nothing is priced. Cards show 6 lines then `Show 5 more · 5 left`. Toolbar: bare search, `Category ▾`, `Status ▾` filter words that read their value, `Clear`; tab ⋯ holds Print all case labels, Manifest, Select the unplanned, Show every / fewer lines, Open the warehouse page. Footer: `44 lines · 249 units · 3 packed in the warehouse`.

### 7b.3 Planning
- Three ways to the same write `planInto(ids, case)`: drag a row (a ticked row drags the whole selection) onto any card header or body; tick lines and use `Plan 3 into… ▾` in the bulk bar; row ⋯ `Plan into…`. All toast with Undo (`snapshot()` closure): `3 lines → LX-04`.
- Packed lines show `● Packed`, are not draggable, and are skipped by bulk writes; the toast says so (`1 packed line stays (move in the warehouse)`). What was packed wins over the plan, and when they differ the row says `Planned → LX-04` (the warehouse glyph, shown only on disagreement — this fixes finding 2).
- A kit moves whole (tag `Kit · moves whole`). A sealed case rejects drops with a toast naming the unseal verb; its lines cannot be dragged out.
- Case ⋯: Rename…, Print case label, Seal / Unseal, Show every line, Delete case… (red, last). Delete is blocked with a reason while any line is packed (`NOT_EMPTY` server rule), otherwise it confirms and returns planned lines to Unplanned; Undo restores.
- `+ Add case` dialog = the live New container sheet: `From inventory  Custom  Bulk tub (later)` words, search with `In use · #2350` dot-words, name, Packed inside, description. "Cases are never priced."
- Empty states: `No lines match that` (filters) and `Every line has a case` (nothing unplanned) are different sentences.

### 7b.4 Versions
- **A dated list in the Discussion rendering**: mono date, `v3 · Live`, label, `● Live` / `● Viewing` dot-word, one fact line (`44 lines · 36 planned`, by, quote state), one derived diff line vs the previous version (`vs v2: +2 lines · −1 line · 3 lines changed · +$1,970`), total right-aligned mono. No cards. Row click opens (views) that version; row ⋯: Open this version, Make vN live…, Compare with v3…, Rename…, Save a copy as new version…, Delete version… (red, last, never on the live row).
- **Make live** dialog (calm rows): Warehouse (pick list follows vN: lines, packed gear carries over), Availability (demand changes on n models, re-checked, never a block), Invoices (INV-0041 stays; quote total and balance to raise before → after), and "vN stays saved — nothing is deleted. This sends nothing to the client." After confirm a conflict list (`Sennheiser EW-DX SK beltpack · 6 packed units are not on v1`) is shown if any; the toast has Undo that restores the previous live pointer.
- **Compare** is a read-only right sheet (bottom sheet on phone): `v2 ▾ → v3 · Live ▾` side pickers, money bridge `$21,910 → $23,880 · +$1,970`, then Added / Removed / Changed / Services groups with signed money, and a muted `Packing plan · 2 lines` row. Footer: `Make v2 live`, `Close`.
- **Save as new version** (primary): dialog with optional name, "a full copy: lines, cases and the packing plan; the live version does not change". Undo removes it.
- Home: the live panel is a Sheet; this proposal makes it a tab because (a) a sheet cannot carry a sticky primary or a phone tab entry, (b) Compare is already a page-level mode launched from elsewhere, so the sheet was neither the one place for verbs nor for diffs, (c) a version list is read at length (dates, diffs, totals). The chip menu stays for quick switching and `Manage versions` / `V` open the tab.

### 7b.5 Phone
- Tab strip carries Packing and Versions; header `#2341 · Confirmed · 12 – 14 Nov · v3 live`; header ⋯ = job menu with the tab's own verbs on top.
- Unplanned first, then each case as a section; rows 64 px, 22 px checkbox, whole row toggles selection, ⋯ 40 px always visible; drag grips and the tab ⋯ are hidden; `Show 5 more · 5 left`.
- Sticky primary `+ Add case` (Versions: `Save as new version`) is replaced by the bulk bar (`Plan 3 into… ▾`, `Unplan 2`) while anything is ticked; `Plan into…`, row, case and version menus are 48 px bottom sheets; Compare is a 92 % bottom sheet; inputs 16 px.
- Versions rows are 64 px: `v3 · Live`, `Thu 6 Nov · 44 lines · 36 planned`, diff line, total, ⋯.

### 7b.6 Code
Reuses `usePackingTab`, `useProjectContainerWrites` (+ the unused `update`/`remove`), `NewContainerSheet` fields, `resolvePackingStatus` (glyph rule), `useProjectVersion` / `MakeLiveDialog` / `CompareView`'s alignment (`convex/lib/versionCompare.ts`; the sheet renders its rows, no second diff). `PackingTab` rewritten as `UnplannedCard` + `CaseCard` + rows; drag uses the Equipment tab's HTML5 drag helpers if they are extracted (else a small local hook). `VersionsPanel` becomes `VersionsTab`; `version-switcher.tsx` keeps the chip menu. Shared bulk bar and row ⋯ primitives from §5. Needs: a `sealedAt` field on `projectContainers` (D), a Make-live preview query (counts only, fail open).

Decisions raised: D19–D21 (§12).

---

## 7c. Job › New job wizard, job edit sheet and templates — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/GgtKxc5WZP33gXihgFTB9B — desktop 1440 and phone 390, every control wired (three steps with validation, draft line, client / contact / location / manager / tag comboboxes, inline new client and location, range calendar with presets and busy-day dots, project window, availability consequence, `Start from template ▾` + `Manage templates…` with bulk delete, search-first gear add with Enter / second Enter, line editor, shift-range select + bulk bar, Review with totals and `Starts as`, `Create job` / `Create as enquiry`, the job-header stub with `Edit`, the edit sheet with the date-move heads-up on #2341, template edit and `New template…`, discard draft, Undo on every write).

### 7c.1 Why
`src/components/projects/project-wizard.tsx` (913 lines) is create, edit and template in one component. Its steps are Basics · Schedule · Site · Review (`:112`), none of them gear, and nothing is written until the last click (`:330`), so a phone that loses signal on step three loses the job. The Schedule step never says what the dates collide with (`:708-850`). Edit (`edit/page.tsx`, 71 lines) is the same four-step wizard on a separate page, with a Status `Select` (`:536`) that moves status without the stepper's confirm gate. Templates (`templates/page.tsx`) is a table plus a second copy of its cells for the phone cards and per-row `Use` / Edit / Delete buttons (`:150-190`); `Use` asks for a code and name and starts a different flow from the wizard.

### 7c.2 The page
- **Steps are words**, active underlined: `Who and when · What 7 · Review`. `/projects/new` stays; steps are reachable once step one validates.
- **Head:** `New job`, a quiet line `✓ Draft #2360 saved` (before a name exists: `Draft #2360 starts when you name the job`), one primary `Next` → `Create job`, `Create as enquiry` (step one) / `Back` as a muted word, ⋯ with `Edit an existing job (#2341)` and `Discard draft…` (confirm; Undo).
- **Draft:** the job row is written the first time it has a name and kept in step; it is an ordinary Enquiry, so nothing new is stored and an abandoned wizard is just an empty Enquiry (it does not count toward Jobs › Needs you). `Create job` finishes that row, never duplicates it.
- **`Create as enquiry`** finishes now from step one: Enquiry, no gear, toast with Undo.
- **`Start from template ▾`** (step one, a filter word that reads its value: `Template: Gala dinner — ballroom`): five most used with their line counts, `Start from scratch` when set, `Manage templates…`, `New template…`. Picking one sets type, tags, description (and client discount) and brings its lines; dates are cleared exactly as `duplicate` does today. Toast with Undo.
- **Manage templates…** is a dialog list with always-on checkboxes, shift range, row ⋯ (`Use for a new job`, `Edit template…`, `Delete…`) and a footer bulk `Delete n` (confirm: "jobs already created from it are not affected"; Undo). `/projects/templates` becomes a redirect that opens it. The separate table, its mobile duplicate and the per-row buttons go.
- **What** is the Equipment tab's add, embedded: search first, kind words, results show `n of m free` for the rental dates, Enter adds with defaults and combines an existing model (`already ×4 here → ×5`), an asset tag resolves to its model, free text offers custom and sub-hire, a second Enter with nothing typed opens the line editor. Lines are the Equipment row (qty inline, rate, total, `short n` / `unpriced` flags, ⋯, checkboxes, bulk `Sub-hire n short` / `Remove n`). Category follows the model; moving it is Equipment's job. No dates → `Availability not checked` with `Set dates`.
- **Review** is read-out sections with an `Edit` word each: Job, When (with the availability line), Where, What (lines + `Hire · Discount · Total ex GST`, no cents), `Starts as ● Quoting ▾` (Enquiry or Quoting; Confirmed and later stay on the Overview stepper) and `Creates`. Gear is pencilled, not held, until Confirmed.
- **Fields on step one**, in the Zod schema's order (`src/lib/validations/project.ts`): Name · Project code · Client · Contact · Rental dates (`rentalStartDate` / `rentalEndDate`) · Project window (`projectStart/End` date + time) · Type · Project manager(s) · Tags; behind `Site, description and discount ▾`: Description · Location · Site contact name / phone / email · Discount %. `status` is not a field. `crewNotes` / `internalNotes` / `clientNotes`, `billingWeeks/DaysOverride` and `taxRate` are in the schema but never were in this form; they stay where they are.

### 7c.3 Dates and availability
- One range field; the calendar opens inline (a bottom-sheet-free design: phone shows one month). Presets `1 day · 2 days · Weekend · 1 week`, `Clear`. A dot under a day means another job has gear out (title lists it).
- Under the field, derived on read: `● 3 other jobs in these dates #2350 …` and `● Gear not checked yet` / `● 2 lines short` / `● All 7 lines free`. No dates → `Availability not checked`.
- Project window: `Project window · same as rental · Change`; blank stays blank (R-3.1). The soft warning text is kept verbatim.

### 7c.4 The job edit sheet
- `/projects/[id]/edit` redirects to `?edit=1`; the Overview header's `Edit` and the page ⋯ open a right-hand sheet (full height on phone). The same `fieldsHtml` as step one, all sections open and titled: Job (Name · Project code · Client · Contact · Rental dates · Project window · Type · Project manager(s) · Tags · Description) · Where (Location · Site contact name / phone / email) · Money (Discount %).
- One `Save changes`, disabled until something changed; the footer says what (`dates, project window changed`). Cancel is the only other control. Save calls the one update mutation inline edits use.
- **Date-move gate (#1227):** Save checks gear only when the window moved and the status is ≥ Confirmed. Nothing found → saves, toast with Undo. Found → `DateMoveImpactDialog` over the sheet: `2 × Sennheiser EW-DX EM4 receiver — also booked on #2338`, `Heads-up, not a block`, `Cancel` / `Save anyway`. In the prototype moving #2341 to 19 – 21 Nov finds EM4 ×2, SK beltpack ×2, Barco ×1 on #2338. It never shows as you type; the sheet says "Saving checks the new dates against gear on other jobs". Fails open.
- Moving the rental dates carries the project window by the same offset (new; live leaves it, which makes a move look like a no-op to the gate).
- Pricing lock: Discount disabled with the lock hint; Save leaves locked fields untouched.
- Status is not a field: the stepper runs the accepted-quote, blocking-discussion and confirm-impact checks; the live Select skipped them.
- Templates edit in the same sheet minus code, discount and gate.

### 7c.5 Phone
Header is back chevron + `New job` + `Draft #2360 saved · What` + ⋯ (bottom sheet). Step words scroll. Inputs 16 px, one column. Sticky pair above the bottom nav: `Create as enquiry | Next` on step one, `Back | Next` then `Back | Create job`; the bulk bar replaces it while lines are ticked. Line cards are 64 px with a 22 px checkbox and always-visible ⋯. Menus and the template manager are bottom sheets / full width dialogs; the edit sheet is full height with sticky Save.

### 7c.6 Code
One `ProjectFields` (the schema-derived field list) used by wizard step one and the sheet; `ProjectWizard` loses its `project` / edit mode. The What step reuses the Equipment `AddBar` and `LineRow` (§5.1, §5.5); `useDateMoveGate` and `DateMoveImpactDialog` stay as they are. New: a `draft` write on first valid name (reuse `projectWrites.create` with status ENQUIRY, then update), `?edit=1` handling on the record, a redirect for `/projects/templates`. Goes: the Site step, step circles, helper rail and CoachingTip on this page, `QuickCreateClient` / `QuickCreateLocation` dialogs in this flow, the templates table + `MobileCardList` copy, the use-template dialog.

Decisions raised: D22–D25 (§12).

---

## 8. Job › Logistics — v2 proposal (prototype 2026-10-27, awaiting a yes)

> **Calm pass (2026-10-28).** Applied to this tab's prototype after the home:
> the Overview header (name · status · lock glyph; number · client · dates;
> `Documents ▾ · Edit · ⋯`), no card boxes, the toolbar reduced to words with
> the active view underlined, chips and status pills become a dot and a word,
> tags become muted text, row buttons become text links, ⋯ appears on hover,
> section rows lose their background band, green is kept for confirmed /
> paid dots only and red for shortages and crew gaps. Every control and
> flow is unchanged.

> **Rows select with checkboxes, no per-row action** (2026-11-04). `Pick 1
> crew` / `Send 2 offers` / `Confirm` on service rows and `Send offer` /
> `Resend` / `Confirm` on crew rows go; the status pills and ⋯ keep the
> single-row verbs. Service rows, crew rows and the phone day cards all carry
> an always-on checkbox, and the bulk bar acts on the ticks: `Pick crew · N
> short` (opens the picker for the first short service), `Send N offers`,
> `Confirm N`, `Set status…`, `Send offers`, `Delete` / `Remove`. On the
> phone the bulk bar replaces the sticky `+ Add service ▾` while anything is
> ticked.

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

> **Narrower desktops** (2026-11-04): seven columns squeezed a 1200 px window
> into one-word-per-line Where and When cells and an empty action column.
> The timeline is now six columns: Where folds under the service as one
> muted line (address · directions · vehicle · trips, or the counter, client
> and rego for a client pick up), the action column goes, When never wraps,
> and the needs line reads `3 short of crew · 4 to offer · 1 unanswered`.
> Between 860 and 1300 px the table uses a fixed layout with tighter Crew,
> Charge and When columns and the toolbar settles into two rows, so nothing
> scrolls sideways.

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

> **Row verbs live in the row menu** (2026-11-04). `Send`, `Mark accepted`
> and `Issue` buttons leave the quote and invoice rows; each row's ⋯ carries
> them, and the page-level `Send quote vN` / `Create quote v4` / `Invoice ▾`
> stay. Quotes and invoices are documents, not work items, so they get no
> selection checkboxes.

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
- **File rows tick too** (2026-11-04): an always-on checkbox per file and a
  bulk bar for the ticks (`Category ▾ · Attach to task ▾ · Download ·
  Remove`), matching every other list; tasks keep their completion circle as
  the row's own tick.
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
>
> **Phone pass (2026-10-28).** The stage action row (`Prep ▾ · select lines,
> or scan` / `Deploy all · 18` / `Receive all`) moves into a sticky bar above
> the bottom nav, so the one action for the current stage is always in thumb
> reach and reflects the selection (`Pack 2 accessories`); disabled secondaries
> and the drag hint stay desktop-only. The page menu gains `Job overview ↗`,
> `Equipment tab ↗`, `Select lines…` and `Only what needs me`, and closes on
> tap. The active stage centres itself in the strip; row ⋯ is always visible
> at 40 px; rows are 64 px; the scan input is 16 px; the footer scrolls with
> the list.
>
> **No per-row Prep / Pack / Deploy button on the phone** (2026-10-28). It
> duplicated the scan flow and the row's ⋯, and acted on one line only. Every
> phone row carries a checkbox instead; the sticky bar is the one action for
> the current stage and reflects the ticks (`Prep ▾` → `Prep 2 + accessories`
> → `Pack 2 accessories`; `Deploy all · 18` → `Deploy 1`), with `tick lines,
> or scan` under it when nothing is ticked. Scanning remains the primary way
> to prep a single unit.
>
> **Desktop rows lose their per-line button too** (2026-11-03). `Prep 8`,
> `Prep + acc.`, `Pack 2 accessories`, `Deploy 6` go; the row checkbox and
> the toolbar's `Prep ▾` / `Deploy all · 18` act on the ticked lines, and
> shift-click selects a range in list order. Accessory rows keep their own
> `Pack 5 with parent` / `Pack anyway` / `Move…`, which act below the line.
> The row's ⋯ and the row sheet still offer the single-line verbs; scanning
> stays the single-unit path.

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

## 9b. List pages — one pattern for Jobs, Assets and every other table (prototypes 2026-11-04, awaiting a yes)

**Prototypes:** Jobs https://claude.ai/artifact/A7SMPtpTr3aedUDEnuSaxd · Assets
https://claude.ai/artifact/89PDTuMiovgP9i3h4MJ1Tw — desktop 1440 and phone 390, every
control wired (segments, filter menus, sort, pager, row menu, checkbox range select,
bulk bar with Undo, saved views, board / grid, empty states).

### 9b.1 Why

Every list in the app is the same primitive (`src/components/ui/data-table.tsx`:
search, column filter menus, sort, 25-row pages, `emptyPreset`) wrapped differently
on every page. Jobs (`src/components/projects/project-table.tsx`) and Assets
(`src/components/assets/asset-table.tsx` inside `assets-view.tsx`) are the two people
open most, and they disagree on everything above the rows: Assets opens on a photo
Grid with a `localStorage` toggle and the "power view" behind it, Jobs opens on the
table; filters live in per-column menus you have to know to look for; the dashboard's
stat tiles link to bare `/projects` and `/assets/registry`
(`src/components/dashboard/widgets/stat-tile-widgets.tsx`), so the number you clicked
is gone when the page opens; and the row actions are the per-row buttons §5.2
retired everywhere else. The survey covered Crew, Clients, Suppliers, Locations,
Maintenance, Test & tag, Models, Kits and Sales stock too — same primitive, same
drift, so one pattern fixes all of them.

### 9b.2 The pattern (every list page)

1. **Head.** `Name · count` (mono count), one sub line (a fact about the whole set
   plus the `/` search and `n` new hints), ONE primary (`+ New job`, `+ New asset`),
   everything else in ⋯ (templates, overbookings, import, export, print labels,
   columns, show cancelled / retired). Table · Board (Jobs) or Table · Grid (Assets)
   as words with the active one underlined — no segmented control.
2. **Quick strip.** Four to seven words with counts, in the page's own stage
   vocabulary, underlined like the job tabs. The LAST segment is the exception set
   (`Needs you`, `Needs attention`) and is the only one that prints red, and only
   when non-zero — it is the page's inbox, not a filter.
3. **Toolbar.** A bare search that says what it matches ("Search job, number or
   client"), then filter words: `Status ▾` becomes `Status: Confirmed ✕` /
   `Status: 2 chosen ✕` when set, every menu is multi-select, `Clear` appears when
   anything is set. `Views ▾` sits at the right. No filter icons, no card chrome.
4. **Rows.** The whole row opens the record. An always-on checkbox leads every row
   with a select-page box in the header; shift-click selects the visible range.
   Status is dot + word; money is right-aligned mono with no cents; the ⋯ shows on
   hover only. The main column carries a muted second line (client under job name,
   category under model) so the table stays at eight columns or fewer; the rest are
   opt-in from ⋯ › Columns. Flags (`1 blocking`, `overbooked`, `18d overdue`) print
   inline after the name as red dot-words — no badge pills.
5. **Footer.** `38 jobs · 1–25  ‹ 1 / 2 ›`. Page size stays 25.
6. **Bulk bar.** Verbs are contextual (`Force return 3` only when a deployed asset is
   selected), the destructive one last and red, every write toasts with Undo. A bulk
   write runs each row's own gates and skips what it can't do, and the toast says so
   ("deployed ones stay on their job").
7. **Empty states** are domain words with a next action, and "nothing matches"
   (`Clear filters`) is a different message from "none yet" (`New job`).
8. **Phone.** The head folds into the phone header (name + a count line), the quick
   strip and the filter words scroll sideways, rows become cards (title, one sub
   line, status at the right, 22 px checkbox), the primary is a sticky bar the bulk
   bar replaces while anything is selected, paging is `Show 25 more`.
9. **The URL is the state.** Segment, filters, sort, page and view are query params,
   so a saved view is a link, a dashboard tile links to the segment it counts, and
   the back button works. This replaces `localStorage` filter persistence; only
   per-user conveniences (chosen columns, grid vs table) stay local.

### 9b.3 Jobs (`/projects`)

- **Segments:** All · Quoting (`ENQUIRY`, `QUOTING`, `QUOTED`) · Booked
  (`AWAITING_PAYMENT`, `CONFIRMED`, `PREPPING`) · Out (`CHECKED_OUT`, `ON_SITE`) ·
  Done (`RETURNED`, `COMPLETED`, `INVOICED`) · Needs you. Cancelled jobs are hidden
  until asked for (⋯ › Show cancelled, or the Status filter).
- **Needs you** = unresolved blocking discussions, overbooked, reduced stock, out
  past its end date, or a quote untouched for 12+ days. Derived on read, never
  stored (same rule as the Overview readiness checklist).
- **Columns:** `#` · Job (client, tags, flags) · Status (the pricing-lock glyph under
  the word when the §6b lock applies) · Dates · Type · Total; PM and Tags opt-in.
  Default sort is start date, newest first; the strip is the primary way in.
- **Row ⋯:** Open, Warehouse page, Set status…, Duplicate…, Save as template…,
  Cancel job…
- **Bulk:** Set status… (each job runs its own gates — the `CONFIRMED` impact
  preview and snapshot included), Assign PM…, Add tag…, Export, Cancel jobs (confirm
  dialog that says what happens to reservations and documents).
- **Board** (desktop only): one column per stage, cards show number · client, start
  or overdue, total, and the same flags; drag to change status.
- **Views:** `My jobs`, `Out this week`, `Unquoted enquiries` ship as defaults;
  `Save current view…` names the current URL and can make it the user's default.

### 9b.4 Assets (`/assets/registry`)

- **Segments:** All · Available · On jobs (`DEPLOYED` + `RESERVED`) · In maintenance
  · Due for T&T (overdue, or due within 30 days — test & tag or service, whichever
  is sooner) · Needs attention · Retired.
- **Needs attention** = missing, needs repair, overdue test & tag or service, or
  deployed on a job that is itself overdue.
- **Filters:** Model, Category, Location, Condition, Kind (serialised / bulk).
  `Group ▾` (model, location, category) turns the table into group rows with
  counts — it is a sort, not a tree.
- **Columns:** Tag (thumbnail) · Model (category, tags; a bulk line prints
  `37 of 48 in`) · Serial (`bulk` for bulk lines) · Status · Condition · Location
  (shelf on the second line) · Next due (`T&T 14 Aug`, red `Service 5d overdue`) ·
  On job (number + name, a link); Value, Tags and Owner opt-in.
- **Table is the default**, Grid is remembered per user (reverses today's
  `assets-view.tsx` default). Grid cards keep the checkbox, ⋯ and status, so bulk
  selection works in both.
- **Scan to find** sits beside the primary: on desktop it focuses the search (a USB
  scanner types the tag and Enter opens the asset), on the phone it opens the
  camera (§5.7 `ScanDock`) and a read jumps straight to the asset.
- **Row ⋯:** Open, Edit…, Job #n, Move to…, Schedule service…, Print label,
  Duplicate…, Force return (deployed only), Retire… / Reinstate.
- **Bulk:** Edit… (only the fields you change are written), Move to… (deployed
  skipped), Add tag…, Print labels, Schedule service, Force return n, Retire
  (confirm; on-job skipped; history and T&T record kept).

### 9b.5 Every other list

Crew, Clients, Suppliers, Locations, Maintenance, Test & tag, Models, Kits and Sales
stock adopt the same shell with their own strip vocabulary (Crew: All · Available
this week · On a job · Unconfirmed; Maintenance: Open · Overdue · Scheduled · Done;
Test & tag: Due · Overdue · Passed · Failed; Models: All · With stock · No stock ·
Archived). Known one-page fixes ride along: Assets' filter menus become multi-value;
Locations gets a type filter; every page keeps a domain `emptyPreset`.

### 9b.6 Code

One `ListPage` composition (head, strip, toolbar, table-or-cards, footer) over the
existing `DataTable`, reusing `BulkActionBar` and `RowActionsMenu`
(`src/components/ui/`) and `SavedViewsMenu` rewired to URLs. Pages supply columns,
segments, filters, bulk verbs and the row menu — nothing else. The per-row buttons,
the per-page toggle components and the `localStorage` filter keys go.

---

## 9c. Warehouse › Floor, Returning and the pull sheet — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/6xqFcEZZk49w86p5pAsisA — desktop 1440 and phone 390, every control wired (scope strip, stage strip on phone, Packer / Client / Flags filters, dock typed search and scan with Open / Receive, camera sheet, tick + shift-tick, bulk Print pull sheets / Assign packer / Receive / Close out with Undo, card ⋯ with Documents and Admin overrides + confirm, Returning mode with outcome strip, unit chips, bulk Return / Damaged / Raise repair / Missing with Undo, bulk-bin "which job" dialog, offline queue, pull-sheet print view, empty states, Show more).

### 9c.1 Why
Three pages answer one question — "what is where, and what do I do next" — in three vocabularies. The floor (`warehouse/page.tsx`) has a scan field whose scan only sets a text filter on project name/number (`:468-494`), so scanning a tag empties the list; a link card to Returns (`:504`); four stat tiles; urgency groups; and a card that carries a status pill, a 5-dot stepper, a prep bar, an `Open` button and an `Actions ▾` menu (`:919-946`). Returns (`returns/page.tsx`) is a second scan surface with per-row buttons — `Mark damaged`, `Mark missing`, `Raise repair` (`:433-440`), per-line `Return` / `Return kit` (`:515-540`) — and a manual Refresh (`:459`) because the board is a one-shot fetch. The pull sheet (`pull-sheet/page.tsx:241`) is a whole page to print one list.

### 9c.2 The page
Keeps: job cards as the unit, the stage vocabulary, the scan, per-item outcomes, Undo, batch close-out, the manual overrides. Head `The floor · 12` with one primary `Scan` (focuses the dock) and ⋯. Strip `Today · This week · Mine · All` with counts (default This week), then `Returning 236` pushed right. Dock (copied from the warehouse job page). Filter words `Packer ▾ · Client ▾ · Flags ▾ · Clear` and `Select all n`. Board of five columns `To pick · Prepping · Ready · Out · Returning`, each a dot-word head with count. Footer one muted line.
- **Card:** checkbox, `#2341`, ⋯ (hover); name; `client · 12 – 14 Nov`; `18 lines · 4 to pick` (Out: `78 items out`; Returning: `46 of 88 items back`) over a 4 px bar; `Truck Tue 06:30 · Van 2`; packer avatar + name or `no packer`; flags as dot-words (`short 2`, `3d overdue`, `awaiting payment`, `1 blocking`, `1 damaged`). Whole card opens the warehouse job.
- **Columns are derived, never dragged:** Returning = any unit back; Out = any unit out; Ready = nothing to pick; Prepping = some packed; else To pick. The manual overrides are the only way to disagree with the scanner (D6).
- **Scope:** Today = truck within today + tomorrow (live's window), plus out-and-due and everything returning; This week = truck within 6 days; Mine = I am PM or packer.
- **Gone:** stat tiles (counts live in the strip, column heads and Flags), urgency groups, stepper, status pill, `Open`, `Actions ▾`, the close-out bar, the Returns link card.
### 9c.3 The dock and Looking up
One input, id `q`. Typing filters by number, name, client; Enter on a tag resolves it. Result strip, same as the job page: `SK-0012 · packed for #2341 · truck Tue 06:30  Open ✕`; an out unit offers `Receive` (primary) and `Open`; a bin out on four jobs offers `Receive…`; kit members say scan the kit; shelf and unknown tags say so. The matching card gets a teal ring and scrolls into view; a job outside the scope widens to All. `Recent n ▾` is the live last-five strip. The chip `Any job · Look up ▾` is the mode toggle (Look up · Receive).
### 9c.4 Returning mode
Entered from the strip word, page ⋯, the dock chip, a card ⋯ `Receive gear`, or bulk `Receive n`. Same page, same dock, chip `Receive`. Strip becomes outcomes: `‹ The floor · Out · Returned · Damaged · Missing · Late` (units; missing/late red when non-zero). Body is a table grouped by job (group row: checkbox selects the job, `#2331 Live Nation tour · due back 8 Nov · 68 out · 1d overdue`, ⋯ `Return everything still out`), rows `Item (tags · shelf) · out / total · outcome dot-words · ⋯`. Row click expands unit chips; a chip's menu records one unit. Late is derived (out past the job's end, or returned after it). Scan returns a unit; the strip entry has `Undo` and `Outcome ▾` (Returned · Damaged · Raise repair · Missing); a bin on several jobs opens "Which job?" with a quantity per job. Bulk bar: `Return n · Mark damaged n · Raise repair n · Mark missing n` (destructive last, red). Every write toasts and shares one `snapshot()` closure with the strip; Undo is offered only while it is the latest write.
### 9c.5 Pull sheet
`Documents ▾ › Pull sheet` on the warehouse job (already in its menu), card ⋯ › Documents, page ⋯ `Pull sheets · jobs in view`, bulk `Print pull sheets 3`. A dialog with the print view (paper, category groups sorted by shelf, kit members, short flags, sign-off line), `Print` / `Save PDF`. `/warehouse/[id]/pull-sheet` becomes a redirect to `/warehouse/[id]?doc=pull-sheet`. Same list the packer works from; no localStorage ticks.
### 9c.6 Phone
Header `The floor · 12 jobs · 2 overdue` + ⋯ sheet (Returning mode first). Stage strip under it (`All · To pick · Prepping · Ready · Out · Returning`, counts). Dock sticky beneath, camera beside it, result strip inside the sticky block. Scope words and filters scroll as one row. Cards grouped by stage under hairline heads, 64 px: name, `#2341 · client · dates`, `Truck Tue 06:30 · Sam O.`; right `4 to pick` and the first flag; 22 px checkbox; ⋯ 40 px. No sticky `Scan` bar: the dock and the bottom nav's raised Scan (context-aware: it opens the camera in the current mode, Warehouse item active) already are the primary, a third would duplicate; the bulk bar replaces nothing and sits above the nav. Returning rows are cards under job heads, `Show 25 more · n left`. Board is hidden, not squeezed.
### 9c.7 Does `/warehouse/returns` survive?
Only as a deep link: it redirects to `/warehouse?mode=returning` (the returns desk has printed signage and bookmarks). Mode, scope and filters belong in the URL (D11). The separate page, its Refresh button and its own board go.
### 9c.8 Code
Composes `ScanDock`/`ScanStrip` (§5.7, as built for the job page), `BulkBar`, `ActionMenu`, `DetailHeader`-less list head, `filterWord`. Reuses `useNativeWarehouseList`, `useReturnsWrites`, `useResolveScan`, `warehouse-undo-toast`, `warehouse-stages.ts` (adds Ready, Returning labels in `vocabulary.ts`). Goes: `StatCell`, `UrgencyGroupHeader`, `LifecycleStepper`, `PrepProgress` card variant, returns page's session lists, `pull-sheet/page.tsx` body (becomes `PullSheetDocument`). Needs a derived `warehouseStage(project)` shared by board, strip and URL; the server must expose per-project unit counts (out/back/pick) rather than top-level line status (live `getPrepSummary` counts lines, so a half-returned line reads as out).

Decisions raised: D26–D29 (§12).

---

## 9d. Assets › Asset detail and the asset forms — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s — desktop 1440 and phone 390, every control wired (seven controlled tabs with `#AURA-01/<tab>` deep links, health checklist actions, availability strip with Earlier / Today / Later and row highlight, check filters, maintenance tick + shift-range + bulk Mark done / Reschedule with Undo, History filter and paging, Notes autosave and Discussion, Files grid with bulk, page ⋯ (Move, Schedule service, Report issue, Print label, New asset like this, Force return, Retire / Reinstate / Delete), the Scan dialog (same tag confirms, another tag navigates), the edit sheet with validation, the create sheet with search-first model, Save and add another, Bulk stock, CSV import, empty and not-found states). Six assets are reachable through Scan: AURA-01, AURA-03 (deployed, T&T overdue), L-0007 (in repair), ULXD-03 (in a kit), SK-0012 (nothing checked), RC-0007 (an accessory).

### 9d.1 Why
`src/app/(app)/assets/registry/[id]/page.tsx` is a 993-line page with a bordered hero card carrying five controls (comments, QR, Report issue, Edit, ⋯), an uncontrolled `Tabs defaultValue="history"` (`:493`) with no `?tab=`, and a 4-section sidebar. Three findings. (1) The record lands on History, a log, not on what an operator needs first: is this unit fit to go out. That answer is scattered: T&T lives in the sidebar (`:787-820`), condition is a header pill (`:327`), open repairs are a tab, "where is it" is a pill (`:171-243`); nothing says `not checked`. (2) Edit is a route (`Link href=/assets/registry/${id}/edit`, `:373`), and Delete sits one click below Archive in the same ⋯ (`:410-420`) although it destroys maintenance and T&T history (dialog copy `:937`). (3) Every sub-list uses a different chrome: bordered timeline, table plus MobileCardList, session cards with Badges, two Panels, a bare editor. The forms (`asset-form.tsx`, `bulk-asset-form.tsx`) already share `SmartFormSection` order Identity → … → More details, but each is a page with a preview rail and the asset form creates several assets through add-row buttons (`asset-form.tsx:257,283`).

### 9d.2 The page
Pattern 4.2 on the Overview prototype's language. **Header:** thumbnail, `AURA-01` (the tag is what the floor says), status dot-word, identity line `Martin MAC Aura XB · Lighting · Warehouse A / B2` (model is a link to the model page; home bin is the one place the home location prints), real breadcrumb `Assets › AURA-01`. One primary: `Edit` (opens the sheet). Everything else in ⋯: Move to…, Schedule service…, Report issue…, Print label…, New asset like this… (the Duplicate item), Force return… (enabled only when Deployed, shown disabled with the reason otherwise), Retire… last and red. `Scan a tag…` is the first ⋯ item on desktop (and key `/`); `e` edits, `n` starts a new asset.

**Tabs** (controlled; add to `VALID_TABS`, else a `?tab=` falls back to Overview): Overview · Availability *n* · Checks *n* · Maintenance *n* · History *n* · Notes *n open* · Files *n*. `?date=` still seeds Availability.

**Overview** shows no table. (a) The health checklist, copied from the job's readiness list: headline (`Ready to go` / `Nearly ready` / `Can't go out`), `n of m checks clear`, the non-passing rows each with a right-hand action, and the passing ones as one muted line. Checks are derived on read, never stored: test & tag (overdue = blocking, ≤ 30 days = warn, no record = `not checked` → Register), service (next scheduled or last + interval; none = `not checked`), condition (needs repair blocks; no prep/return check on record = `not checked`; failed last check warns), whereabouts (missing blocks, in maintenance warns, due back today warns), double bookings, open repairs. (b) `Now · Last scan · Value & owner` in three columns: current job (link), dates, case / kit, "Accessory of", last scan, replacement and cost, owner. (c) Identity: serial, barcode, purchase, warranty, specs from the model, custom fields, tags. (d) Accessories as rows (serialised unit or bulk count; "from the model" rows cannot be detached), `+ Attach`, row ⋯ Detach with Undo.

**Context rail** on every tab except Overview: Now, Last scan, Value, Owner — the same four definitions Overview composes (one function each, so they cannot drift). It is not shown on the phone (the facts are one tab away).

**Availability:** words `‹ Earlier  Today  Later ›` and the window; an 8-week strip (4 on phone), one thin lane per booking, solid = reserved, red = deployed (live state), dashed = pencilled, amber = service, grey = past, a Today line; clicking a lane highlights its row. Below it the bookings list (job number, name linked to the job, dates, note, dot-word state, row ⋯ Open job / Warehouse page). Past jobs are in History.

**Checks:** words `All Prep Return Ad hoc` (live filter), sessions as dated headers (`Prep · #2341 Hilton… · Sam Okafor · Fri 7 Nov 16:40`) with result rows as dot-words, notes and photo counts; `Run an ad hoc check ›` links to the scan/check surface. **Maintenance:** rows with always-on checkboxes; bulk `Mark done n`, `Reschedule…`; row ⋯; `Schedule service…` and `Report issue…` as words; footer shows the next service and the T&T record link. **History:** the Discussion rendering — day headings, job rows (dot-word Returned / Deployed) and change rows (time, who, what) merged from the live History list and the sidebar Activity feed; words `All Jobs Changes`; `Show 8 more · n left`. **Notes:** the note (autosave on blur, Undo) then Discussion (the live comments button becomes the tab). **Files:** photos as a grid with checkboxes (bulk `Set as photo`, `Download n`, `Remove n`), the "showing the model photo" line kept, model documents as rows.

**Removed, with where the job went:** the hero card chrome (hairlines); the condition pill (health row); the comments, QR and Report issue header buttons (Notes tab, ⋯ › Print label, ⋯ › Report issue); the sidebar (Overview + rail); top-level Delete (inside the Retire dialog, enabled only for an asset with no history — retire is the safe default); `/edit` as a page (the sheet; the route redirects to `?edit=1`).

### 9d.3 Retire, Force return, Scan
- Retire names the downstream effects: reservations released and the job showing `short by 1`, scheduled services cancelled, accessories detached, history / checks / T&T kept, Reinstate from the Retired segment. Writes toast with Undo.
- Force return explains the line returned, the status and location it lands in, and that the return check is skipped and logged.
- Scan (phone's sticky primary, desktop ⋯ and `/`): a read of this tag confirms it (last scan = now, toast with Undo); a different tag navigates to that asset; an unknown tag says so in the dialog. Camera rules are the scanner's (CLAUDE.md): one WASM engine, `getUserMedia` from this tap.

### 9d.4 Forms — the asset edit and create sheets
One sheet shape for every §9.8 form (`RowEditorSheet`, §5.8): a centred wide sheet on desktop, full-height bottom sheet on phone, Save in the footer (always visible). Sections in the live order, each a bold word and a muted hint line; `More details` closes the sheet. Inline errors under the field as you type (tag required, ≤ 50, unique — `AURA-03 is already used by another asset`; money ≥ 0 or blank; warranty not before purchase). `blankableNumber`: a blank price stays blank, never `$0`. Save calls the same mutation the inline edits call and toasts what changed, with Undo.

- **Edit:** Identity (model, tag + serial, custom name) · Condition & location (status, condition, location, bin) · Purchase (date, price, supplier, order #, warranty) · More details (tags, custom fields). The Notes field leaves the sheet; the Notes tab owns it.
- **Create** (⋯ › New asset like this…, the list's `+ New asset`, key `n`; `/assets/registry/new` opens it over the list): search-first by model (type, Enter picks the top result; each result shows the next tag it would get), then tag (suggested, editable, a scan fills it), serial, condition, location, bin; purchase and more details behind one word. Footer: `Import CSV…` · Cancel · `Save and add another` (keeps model, location, condition, advances the tag, clears the serial — replaces the live add-row buttons) · `Create asset` (primary; opens it, where every check reads `not checked`). The words `Serialised unit · Bulk stock` fold `bulk-asset-form` in (stock code, quantity, location, price per unit); bulk stock lives on the model page, as the live detail redirect already does (`page.tsx:132`).
- **CSV:** expected columns printed, a file preview with new / update / error rows, `Import 3 rows`, Undo.

**Forms, field order from the live components** (all adopt the sheet; `Identity` first, `More details` last; ★ = required):

| Form | Source | Order |
|---|---|---|
| Asset | `asset-form.tsx` | Identity: model★ · tag★ / serial · custom name — Condition & location: status · condition · location — Purchase: date · price · supplier · order # · warranty — More: custom fields · notes · tags |
| Bulk stock | `bulk-asset-form.tsx` | Identity: model★ · tag★ · total quantity★ — Status & location: status · location — More: price per unit · notes · tags |
| Model | `model-form.tsx` | Identity: name★ · manufacturer · model number · SKU · category · asset type · description — Pricing: day · week · month · purchase · replacement · sale price · sale stock — Xero coding: rental · sale account — Compliance: weight · power · requires T&T · test profile · validity days — More: specifications · tags · active · packing container |
| Client | `client-form.tsx` (+ `client-contacts-manager.tsx`) | Identity: name★ · type — Contact: name · email · phone — Address: billing · shipping — More: ABN · terms · default discount · tax exemption · payment profile · default partial % · notes · tags. Contacts (name · role · email · phone · notes) are rows on the client record, added after create |
| Crew member | `crew-member-form.tsx` | Identity: first★ · last★ · type · status · platform account — Contact: email · phone — Rates: day · hourly · overtime — More: department · default role · DOB · ABN/GST · address · emergency contact · notes · tags |
| Supplier | `supplier-form.tsx` (+ order: `suppliers/[id]/orders/new`) | Identity: name★ — Contact: name · email · phone · website — Address — More: account # · terms · lead time · notes · tags. Order: order / PO #★ · type · status · order date · expected date · notes |
| Location | `location-form.tsx` | Identity: name★ · type — Place: parent (search-first) · address — More: notes · tags · default for new assets |
| Kit | `kit-form.tsx` | Identity: name★ · tag · category · location · status · condition · check mode — Contents — Case: type · dimensions · weight — Xero coding — More: purchase date · price · description · notes · tags |
| Maintenance | `maintenance-form.tsx` | Identity: assets★ (search-first) · title★ · type · status · reported by · description — Schedule: scheduled · completed — Outcome: cost · parts · result · next due · asset disposition — More: photos · tags |
| Service schedule | `service-schedule-dialog.tsx` | model · name · interval (months) · anchor date · instructions — stays a dialog (five fields) |

Rules for the rest: sheet if ≤ 8 visible fields, search-first where a parent exists (asset → model, location → parent, maintenance → asset), `Save and add another` where records arrive in batches (asset, crew, location), `/new` and `/[id]/edit` stay as deep links that open the sheet, the preview rail goes.

### 9d.5 Phone
- Phone header: back chevron, `AURA-01`, one line `● Reserved · Martin MAC Aura XB · Warehouse A / B2`, ⋯ as a bottom sheet with 48 px items (Edit… is first, because Scan holds the primary).
- Scrolling tab strip with counts under the header; the strip is the only tab control.
- Sticky primary `Scan` above the nav; the bulk bar replaces it when anything is ticked (Maintenance, Files).
- Rows 62 px with 22 px checkboxes where bulk exists, row ⋯ always 40 px; availability strip shows 4 weeks; files grid is two columns with a `Photo` link (camera, from the tap).
- Sheets are bottom sheets, inputs 16 px, Save always visible; the context rail is hidden (its facts are on Overview).
- History pages with `Show 8 more · n left`.

### 9d.6 Code
Composes `DetailHeader` (§5.9), `StatusPill` as dot-word, `BulkBar`, `RowEditorSheet`; the readiness list component from the job Overview becomes a shared `ChecklistSection` fed by a pure `assetHealth(asset)` (T&T, service, condition, whereabouts, bookings, repairs — derived, `unknown` never passes). `AssetChecksTab`, `AssetAccessoriesManager`, `AssetQRCode` (inside the label dialog), `ReportIssueDialog`, `BookingCalendar` data and the `useNativeAsset` subscription are reused; the sidebar components, `KvRow`, the hero card, the Delete menu item and `/registry/[id]/edit` page go. `asset-form` and `bulk-asset-form` are re-skinned into one `AssetSheet`; the zod schemas (`assetSchema`, `bulkAssetSchema`) stay the source.

Decisions raised: D30–D34 (§12).

---

## 9e. Assets › Model detail — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/47miWruJVsednbzrFPij2b — desktop 1440 and phone 390, every control wired (six tabs and `?tab=` links, edit sheet with validation, discard prompt and specifications editor, duplicate-as-create, new-asset sheet, page ⋯ and archive confirm, accessory add/edit/remove, the Assets list filtered to this model with strip, filters, sort, pager, checkbox range select, bulk bar and row ⋯, checks picker and reorder, documents and photos grids with bulk, ROI scope, window, cost opt-in and tooltip, Undo on every write).

### 9e.1 Why
Live page: `src/app/(app)/assets/models/[id]/page.tsx` (933 lines) plus six components. Findings: (1) the landing tab is Details, four bordered cards of settings (`page.tsx:327-421`), so the first screen is a form read-out, not the model's state; the stock numbers sit in a sidebar "Asset summary" (`:748`) and the photo is a 64 px thumb. (2) The Assets tab hand-builds two tables with per-row icon buttons (force return, edit, archive, delete — `:432-446`, `:560-600`) and no search, filter, sort, selection or bulk, while `/assets/registry` has all of them. (3) ROI shows cost, fleet cost and payback by default in four Stat panels (`model-roi-tab.tsx:158-176`), against the "cost hidden by default" rule; and `Edit` is a separate route although the record has the form's whole shape on the page.

### 9e.2 The page
Pattern 4.2. Breadcrumb `Assets › Models › MAC Aura XB`. Header: **Martin MAC Aura XB** · `● Active`; identity line `Lighting · $85/day · $340/wk`; one primary `+ New asset`; ⋯ = Edit model…, Duplicate model…, Print labels for all 12, Archive model… (red, last). Tabs as words: **Overview · Assets 12 · Checks 6 · Documents 3 · Photos 5 · ROI**. Details is gone: its facts are on Overview, its form is the edit sheet, and `?tab=details` / `/edit` open the sheet.

- **Overview** (no rail): the photo as hero beside the stock line `12 owned · 3 out · 1 in service`, a lead (`4 free · 4 held for #2341 …`) and up to three derived health rows (unit in service, units overdue for T&T, a check failing >= 25%) that jump to the tab that fixes them; then Earning (12-month revenue, jobs, per unit) · Value (replacement, fleet value, monthly rate) · Reliability (top failure rates); Booked (the BookingCalendar's data as rows + a 14-day free-units strip, `Schedule ›` for the month grid); Accessories as rows; Model · Technical · Compliance facts; description; Recent.
- **Assets** is the Assets list (§9b) minus its head and minus the Model column: strip, search, Location and Condition filter words, sortable columns, 10-per-page in the prototype (25 live), shift-range checkboxes, row ⋯ (Open, Edit, Job, Move to…, Schedule service…, Print label, Force return when out, Retire…), bulk bar `Edit 3… · Move 3… · Schedule service 3 · Print labels 3 · Force return 3 · Retire 3` (red last). Rows open the asset (`https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s`). Bulk-type models show Available/Total instead of Serial/Condition.
- **Checks**: rows (order, label, description, type word, ⋯: Move up/down, Remove…) + `+ Add check` picker (stays open; library link); Failure rates below as rows with a thin bar and a red `high` flag >= 25%.
- **Documents** rows and **Photos** grid follow Tasks & notes files: select-all, always-on checkboxes, ⋯, bulk `Remove n`; photo ⋯ adds Set as primary, Move earlier/later.
- **ROI**: words `Completed & invoiced · Including booked work` and `Last 12 months · All time`; default figures are revenue and revenue per unit; `Show cost & payback` reveals fleet cost, paid-for-itself and the cost-recovered bar; `How is revenue counted?` is the tooltip.
- **Context rail** on every tab except Overview: Stock (omitted on Assets, where the strip says it), Value, Model, Technical, Accessories, Recent. Rates are on the identity line only, so they are not repeated.

### 9e.3 The edit sheet
Opened by ⋯ › Edit, `Edit pricing`/`Edit model` links, `?edit=1`. Right sheet 580 px (full-height on phone), sections in the model form's order: Identity, Pricing, Xero coding, Compliance & technical (test profile and validity appear when T&T is on), Specifications (the key/value editor inline; Enter adds), Tags and status (Active off = archived; Packing container). Rules:
- One Save writes the same mutation the form does; toast + Undo (snapshot).
- Blank money is blank, not $0 (`blankableNumber`); negative or non-numeric shows an inline error under the field and focuses it; name is required.
- Cancel or Esc with unsaved changes asks `Discard your changes?` (Keep editing restores the draft).
- Duplicate model opens the same sheet in create mode (`/new`), name `… (copy)`; it copies rates, specs, accessory plan and checks, not assets, photos or documents.
- Purchase price lives here and in ROI's cost opt-in only: cost is not shown by default.

### 9e.4 New asset and archive
`+ New asset` (or `n`) opens a short sheet with the model fixed: Tag (next free suggested, unique-checked), Serial, Location, Condition, Purchase price (blank = model default), T&T due. `Create and add another` keeps the sheet open. Archive confirms with the downstream effects: assets stay, units out finish on their jobs, reservations hold, quotes unchanged, restore from Models › Archived. Archived model: dot-word `Archived`, a quiet banner, primary becomes `Restore model`.

### 9e.5 Phone
- Phone header: back chevron, name, `Lighting · $85/day · $340/wk`, ⋯ as a bottom sheet with 48 px items.
- Tab strip scrolls with counts; rail hidden (its facts are on Overview); hero photo full width.
- Assets are 60–64 px cards with 22 px checkbox, always-visible 40 px ⋯, `Show 2 more · 2 left`; sticky `+ New asset` above the nav, replaced by the bulk bar on selection; Photos 2-up grid; sheets full-height with sticky Save, inputs 16 px.

### 9e.6 Code
Composes `DetailHeader`, `ListPage` (strip, toolbar, table/cards, footer), `BulkBar`, `ActionMenu`, `RowEditorSheet` (the edit and create sheets), the Tasks & notes files rows. Reused: `ModelAccessoriesManager`/`ModelCustomAccessoriesManager` logic (as rows + search-first add), `ModelChecksTab` picker, `MediaUploader` mutations, `useModelRoi`. Goes: Details tab and its four cards, the two hand-built tables and their icon buttons, the Stat panels, `/assets/models/[id]/edit` (redirect to `?edit=1`), the sidebar Asset summary. **Tooltip rule kept:** the ROI explanation `Tooltip` must stay inside its own `TooltipProvider` (there is no global one; `model-roi-tab.smoke.test.tsx` reproduces the render-time crash) and the trigger renders its own `<button>`, so no nested button. The `?tab=roi` deep link from Fleet ROI keeps working; add `VALID_TABS` and fall back to Overview. URL is state: `?tab=`, segment and filters on the Assets tab.

Decisions raised: D35–D37 (§12).

---

## 9f. People › Crew, Clients, Suppliers — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/LPdsNGb4CRMfS6qk7j7Fsa — desktop 1440 and phone 390, every control wired (list switch in the sidebar / phone title sheet, strip segments, multi-select filter words, search, sort, shift-range ticks, bulk Message / Assign to job / Add tag / Deactivate / Merge / Archive with Undo, row ⋯, page ⋯, Log time and Export dialogs, saved views, columns, deep-link URLs, empty states, Show more, sticky primary).

### 9f.1 Why
Three lists on one primitive (`src/components/ui/data-table.tsx`) with three different tops. `/crew` is not a list for managers at all: `src/app/(app)/crew/page.tsx:75-81` renders `CrewDashboard` (five stat cards, four dashboard lists, per-row Approve / Dispute / Send buttons, then the table at the bottom), while non-managers get a bare table. `/clients` and `/suppliers` stack four stat tiles on the table (`clients-dashboard.tsx:93-120`, `suppliers/page.tsx` tiles) that link nowhere. Client bulk Archive is the only bulk verb anywhere (`client-table.tsx:197-230`); crew and suppliers have none. Enum filters are single-value (`crew-table.tsx:204-207` unwraps `[0]`). Status is a pill.

### 9f.2 The page
One shell (§9b), three configs: strip, columns, filters, bulk, row ⋯, page ⋯. Sidebar items Crew / Clients / Suppliers switch the list; the URL is `#/crew?seg=unconf&type=Freelancer|Employee&sort=…&page=2` (push on list and segment change, replace otherwise; back works).
- **Crew:** `All · Available this week · On a job · Unconfirmed · Inactive`. Name (role, skills) · Status · Next call · This week · Rate /day · Phone; Email, Type, Department, Tags opt-in. Default sort Status, so unconfirmed people lead. Status is derived from the calls (Unconfirmed > On a job > Available; On leave, Inactive from the stored status). "Available this week" = active, not on leave, nothing confirmed in the next seven days. `clash 14 Nov` prints when two calls overlap. Bulk: Message n, Assign n to job…, Add tag…, Deactivate n (red; people with confirmed calls stay and the toast says so). Assigning offers the shift, so those people become Unconfirmed until they answer (Undo restores).
- **Clients:** `All · Active jobs · Quoting · Overdue invoices · Archived`. Client (contact · type) · Open jobs (job number links to the job) · Quoted · Outstanding (due date, or red `18d overdue`, derived from the invoice due date) · Last job · Xero; Type, Email, Lifetime, Tags opt-in. Default sort open jobs. Bulk: Add tag…, Merge n… (keep-which dialog; Undo), Export, Archive n (clients with open jobs stay).
- **Suppliers:** `All · Open orders · Overdue returns · Archived`. Supplier (contact) · Open orders · On hire now · Due back (red `2d overdue`) · Spend YTD; Phone, Account #, Email, Tags opt-in. Default sort Due back. Bulk: Export, Add tag…, Archive n.
- The exception segment (Unconfirmed / Overdue invoices / Overdue returns) prints red only when non-zero; the parking segment (Inactive / Archived) stays last, so the exception is not always last as in Jobs.
- **`clients-dashboard.tsx` and the supplier/crew tiles:** their numbers become strip counts (active, with open work, with orders), one head sub line (`10 with open jobs (16 live) · $234,400 quoted · $76,170 outstanding`), the Type filter menu counts (replacing "most common type") and the opt-in Lifetime column (total project value). A client record page later takes per-client history. The tiles are removed, not moved.
- **Crew dashboard:** Pending timesheets and Approve / Dispute / Approve all belong to the Timesheets surface (9.9); page ⋯ carries `Timesheets · 4 to approve`, `Planner`, `Crew settings`, `Log time…`, `Export timesheets…`. Active assignments and Upcoming shifts become Next call and Planner. Pending offers per-row Send becomes row ⋯ `Resend offer`.
- Rows open a record page (not prototyped: toast). Row ⋯ crew: Open, Open in planner, Message…, Assign to job…, Resend offer (unconfirmed only), Log time…, Deactivate… / Reactivate. Clients: Open, Open job #n, New job for client…, Open invoices, Open in Xero, Add tag…, Archive… / Reactivate. Suppliers: Open, Orders…, New order…, Returns, Email supplier…, Add tag…, Archive… / Reactivate. Destructive last, red, confirmed in a dialog.

### 9f.3 One renderer
`LISTS[key]` carries `segs, filters, cols, card, sub, empty, views, rowMenu, bulk, pageMenu`; everything else (strip, filter words, table, cards, pager, bulk bar, selection, undo, URL) is shared. Derived facts (crew status, availability, clash, overdue days) are functions of the rows, never stored. Bulk writes run per-row gates and the toast names who was skipped.

### 9f.4 Phone
Header is the list name with `▾` (opens a People sheet: Crew / Clients / Suppliers) plus a count line and ⋯ (also lists the other two lists). Strip and filter words scroll sideways; cards 64 px with 22 px checkbox, status and one number at the right, row ⋯ always visible at 40 px (the Jobs/Assets prototypes omit it on phone; §5 requires it, so retrofit them). Sticky `+ Add crew member` / `+ New client` / `+ New supplier` is replaced by the bulk bar while ticked; Export is desktop-only; `Show 25 more · n left`.

### 9f.5 Code
Composes the §9b list shell and `DataTable` successor; reuses `StatusIndicator` as dot-word, `useTablePreferences` → URL state (D11), `useClientWrites.bulkArchive`. Removes `ClientsDashboard`, the supplier `StatTile`, `CrewDashboard` cards (timesheet approval moves to Timesheets). New server work: bulk message, assign (offer) and merge mutations; derived `Next call`, `This week` and `overdue` read from existing assignments/invoices/orders.

Decisions raised: D38–D40 (§12).

---

## 9g. Gear lists — Models, Kits, Locations, Maintenance, Test & tag, Sales stock, Overbookings — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/D7N5PmXKrkcY2gzZXWeuvc — desktop 1440 and phone 390, every control wired (seven lists switched from the sidebar or the phone title sheet, strip segments, multi-select filter words, search, sort, pager / Show more, tick + shift-tick, bulk verbs with Undo, row ⋯, page ⋯, Columns, Views, create sheets, schedules and reports dialogs, empty states, URL hash state).

### 9g.1 Why
Seven pages, seven shapes: `model-table.tsx` (762 lines), `locations/location-table.tsx`, `sales-stock-table.tsx` are `DataTable`s with button rows; Kits, Maintenance, Test & tag and Overbookings are hand-built pages. Findings: Maintenance and Sales stock keep per-row buttons the program retired (`maintenance/page.tsx:215-233` trash, `sales-stock-table.tsx:142-152` Restock); Overbookings is six stacked tiles with a `Sub-hire this` button per row (`overbookings/page.tsx:260`) and a days Select; `/maintenance/due`, `/test-and-tag/registry` and `/test-and-tag/reports` are separate pages for what are segments and a dialog. Kits' only bulk verb is Force return (`kits/page.tsx:288-299`). One shell (§9b) with seven configs fixes all of it.

### 9g.2 The page
One list renderer, seven configs (columns, strip, filters, bulk verbs, row ⋯, primary). Sidebar: Models, Kits, Locations, Sales stock, Overbookings under Assets; Test & tag and Maintenance keep their slots. Active list highlighted; breadcrumb `Assets › Maintenance`. URL is the state (`#list=maintenance&seg=overdue&f.type=Repair&sort=due`; real query params in the app; list switch pushes history).

| List | Strip (red = exception, only when > 0) | Default columns | Opt-in | Bulk | Primary |
|---|---|---|---|---|---|
| Models | All · With stock · No stock · Due for T&T · Archived | Model (category · maker) · Owned · Available · Day rate | Value, ROI, Type, Tags | Edit rates, Add accessory, Assign checks, Archive | + New model |
| Kits | All · Complete · Missing items (red) · On a job | Kit (tag · models · category) · Items · Complete · On job · Location | Value, Condition, Tags | Duplicate, Print list, Force return, Archive | + New kit |
| Locations | All · Warehouses · Vehicles · Sites · Empty | Location (type · parent) · Assets · Capacity · Last movement | Address, Tags | Move contents, Print bin labels, Archive | + New location |
| Maintenance | Open · Overdue (red) · Scheduled · Done | Asset (model) · Issue (type) · Status · Due · Assigned | Cost, Reported by, Tags | Assign, Reschedule, Mark done | + Log maintenance |
| Test & tag | Due · Overdue (red) · Passed · Failed · All | Asset (model, TT id, class) · Last test · Result · Next due · Tester | — | Schedule, Print tags, Export report | + Register item |
| Sales stock | All · Low stock · Out of stock (red) | Item (SKU · category) · On hand · Reserved · Reorder at · Price | Supplier | Adjust stock, Reorder, Export | Reorder n low |
| Overbookings | This week (red) · Next 30 days · All | Model (kind flag) · Short by · Jobs · Dates · Sub-hire | — | Sub-hire n short, Open n jobs | Sub-hire n short |

Rules:
- Cost and margin columns are hidden by default (§3.7): Models Value and ROI, Kits Value, Maintenance Cost. Price (sales) and day rate are what the client pays, so they show.
- `/maintenance/due` is the Overdue segment plus recurring-schedule rows (`every 90 days · 9 of 24 checked`); check-off is row ⋯ `Check off cycle`; schedule create/deactivate lives in ⋯ `Service schedules…`.
- Registry is T&T `All`; reports are ⋯ `Reports…` (the ten live reports, PDF/CSV); Quick test is ⋯ → the scan surface. Tester-first phones can swap the primary later (open question).
- Overbookings keeps all six live tiles as rows: a `Kind ▾` filter (Overbooked, Pencilled, Sale stock, Crew) and an inline kind dot-word. Crew rows never offer Sub-hire; sale-stock rows point to Reorder. Requested sub-hire prints `Requested · Big Picture` and the shortfall stays until the gear arrives (derived, not cleared).
- One verb definition feeds both the row ⋯ and the bulk bar (same closure, same gates); skipped rows are named in the toast (`5 skipped (still hold assets)`). Every write has Undo; print/export toast only.
- Locations archive is gated (a location holding assets is skipped). Kits Force return and Models/Kits/Locations Archive confirm in a dialog that says what is kept.
- Whole-row open: Models rows → model page, AURA-01 rows → asset page, `#2341` rows → Equipment; other record pages are separate surfaces (toast).

### 9g.3 Story rows
AURA-01 overdue T&T (7d) and awaiting-parts repair (2d); K-0042 Shure ULXD4Q kit missing the PA805 on #2341; MAC Aura PXL short by 2 on #2341 + #2350 (Models: No stock; Overbookings: first row); Gaffer tape out of stock with 12 reserved for #2341; Van 2 empty, loads Tue 11 Nov 06:30.

### 9g.4 Phone
Header is the list name with ▾ (opens the Lists bottom sheet) + a count line + ⋯ (page menu repeats the lists on top). Strip and filter words scroll sideways; cards are 64 px with 22 px checkbox, title, one sub line, status/figure at the right, always-visible 40 px ⋯; one sticky primary replaced by the bulk bar on first tick; `Show 25 more · n left`; print/export verbs hidden.

### 9g.5 Code
`ListPage` (§9b.6) with seven column/segment/verb configs; `BulkActionBar`, `RowActionsMenu`, `SavedViewsMenu` rewired to URLs. Goes: the per-row buttons, `StatTile` rows, `/maintenance/due`, `/test-and-tag/registry|reports` as pages (redirects to segment / dialog), Overbookings tiles. New fields: sales stock `reorderLevel` and derived `reserved`; location `capacity` and derived `lastMovement`.

Decisions raised: D41–D45 (§12).

---

## 9h. Crew › Planner and Timesheets — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/AKkgWzJ2gVR3dJTWnMB2Ui — desktop 1440 and phone 390, every control wired (Planner / Timesheets words; strip All · Needs crew · Unconfirmed · Mine; week ‹ › Today; search; Role / Skill / Job / Availability filters; click an empty cell to offer a call; tick + shift-tick calls, bulk Offer n / Confirm n / Cancel n, Offer to suggested; block ⋯, call edit sheet; Needs crew list; Timesheets strip Submitted · Approved · Queried · All, sort, pager, filters, Views, bulk Approve n / Query… / Export, row ⋯, edit, Log time, Export; page ⋯ › Crew roles & rates…; Undo on every write; phone day mode).

### 9h.1 Why
Live: `src/app/(app)/crew/planner/page.tsx` (1090), `crew/timesheets/page.tsx` (1147), `crew/settings/page.tsx` (461). Three findings.
- The planner is a read-only picture. A day cell is one chip with a glyph (`planner/page.tsx:1000-1030`); there is no click, no offer, no confirm, no bulk. Offers are sent from the crew dashboard or a job's Logistics tab, so the person who sees the gap cannot fill it.
- It shows 14 days (`DAYS_TO_SHOW = 14`, :161) in a table with `min-w-[860px]` (:620), so on a phone it scrolls sideways and a call is a 62 px chip with a job number and nothing else.
- Timesheets have `submit` and `approve` mutations that already take `ids: string[]` (`use-crew-time-writes`), but the page only ever passes `[row.id]` (:226-257): approving a crew's week is one menu per row. There is no rate or total, so approval cannot be a money decision. `/crew/settings` (the roles admin) is reachable only from a small link on the crew page (`crew/page.tsx:538`).

### 9h.2 The page
One page, `Crew`, with two views as words in the head: `Planner  Timesheets` (Jobs' `Table  Board` position). The two sidebar items become one; `/crew/planner` and `/crew/timesheets` stay as deep links to each word. Pattern 4.4 for the planner (the strip counts the work, a bulk bar acts), 4.1 for timesheets.
- **Primary.** Planner: `Offer call`. Timesheets: `Log time`, the live page's only create. `Approve n` is a bulk verb (it needs a selection) and `Export` is something done after approving, so neither earns the red button; both live in the bulk bar, Export also in ⋯.
- **Page ⋯.** Crew list ↗, **Crew roles & rates…** (this is where `/crew/settings` lives, in both views), Export this week / Print (planner); Columns, Export all… (timesheets). Roles opens as a sheet over the page; the route stays as a deep link that opens it. Cost and charge show for managers only, exactly as live.
- **Removed.** The fortnight (one week with ‹ ›, see 9h.3), the four today-tiles (counts moved to the strip and footer), the crew-member select (search), the glyph legend (every block prints its own word). Added: `Skill ▾`.
- **Footer.** One muted line: `10 people · 5 of 13 confirmed · 2 accepted · 2 offered · 4 pending · 1 declined` (declined is the only red, it is a flag).

### 9h.3 The planner grid
- Rows are people (last name), columns Mon–Sun, last column `Hours` = planned from booked calls, `/ n` logged from approved timesheets (the live Planned / actual, derived, never stored). The week opens on the next working week when today is a weekend.
- A call is a block: `[☐] #2341 Rigger` / `08:00–18:00` mono / `● Confirmed`. Job number links to Logistics; the rest of the block opens the call sheet; ⋯ on hover (always visible on phone). Status words: Pending · Offered (with age, amber from 3d) · Accepted · Confirmed · Declined · Completed (past weeks).
- Availability prints as a word in the empty cell: `Unavailable · Leave` (hatched), `● Pencilled #2340 Launch night`, `Preferred`. Booked elsewhere is just a block from the other job. Marks are advisory: offering into one shows the clash in the sheet and still lets you.
- **Click an empty cell** → `Offer a call` sheet for that person and day: Person (with each person's day state in the list), Day, **Job service** (the services planned that day, `needs 1` / `full`; none → link to the job's Logistics tab), Role, Start, End, cost rate (from the role), `Send the offer now` switch (off = Pending). Changing person or day re-checks availability. The same sheet opens from the primary, from a Needs crew row (person pre-picked from the suggestions, preferred first) and from phone free-person cards.
- **Strip.** `All` (calls this week) · `Needs crew` (open slots, red) · `Unconfirmed` (Pending + Offered + Accepted) · `Mine` (calls on jobs I manage). Unconfirmed and Mine filter people to those with a matching call and dim the other blocks.
- **Needs crew** replaces the grid with a list of unfilled calls grouped by day: job · call · times · `needs 1` · avatars of free people with that role. `#2341 Bump in needs 1 rigger`, `#2341 LX op Wed 12`. Row ⋯: Offer to…, Offer to suggested, Open job.
- **Bulk (tick calls, shift-click ranges, select-page in the header).** `Offer 3` (Pending → Offered), `Confirm 2` (Accepted → Confirmed), `Offer to suggested 2` (open slots), `Cancel 4` (red, last, confirm dialog: the slot reopens, offered people are told, timesheets stay). Each row runs its own gate; the toast says what was skipped. Every write toasts with Undo (one `snapshot()` closure shared by the toast and any other surface).
- **Filters** read their value: `Role: Rigger ✕`, `Skill`, `Job` (also dims other jobs' blocks, as live), `Availability` (Free · Booked · Unavailable · Pencilled · Preferred). The find-cover deep link (`?week&role&avail`) sets them; filters, week and strip are the URL (D11).
- **Fortnight is removed**: a 14-column grid cannot print number, role, times and status; the planner's job is offering calls for a week. See decision D-A.

### 9h.4 Timesheets
- Strip `Submitted 10 · Approved 6 · Queried 1 · All 43`; Draft and Exported live under `Status ▾` and All.
- Columns: person (role) · job (number, name, entry description, query note) · date (times and break under it) · hours · rate · total · status; Approved by and Notes are opt-in in ⋯ › Columns. Rate and Total are manager-only, like role rates. Total = hours × rate for hourly roles, the day or flat rate otherwise: derived, never stored.
- Row ⋯ (hover): Edit entry, Submit, Approve, Query…, Open crew member, Delete (red, confirm). Exported rows show a lock and no ⋯, as live.
- Bulk: `Approve 4`, `Submit n`, `Query…`, `Export`. Query… asks what needs checking and writes it to the entry's notes so a queried entry finally carries its reason (small new capability, D-B). `Dispute` is relabelled `Query` (enum stays `DISPUTED`).
- Footer: `43 entries · 1–25  Totals · 361h · $16,962  ‹ 1 / 2 ›`. `Views ▾`, sort and pager as the Jobs list. Log time keeps the live shape (many people, one set of hours) in one sheet.

### 9h.5 Crew roles & rates (`/crew/settings`)
A sheet from page ⋯: role rows (colour dot, name, department · people count, rate type, cost, charge), `New role`, row ⋯ Edit… · Move up/down · Archive… (usage summary: people, calls) · Restore, archived roles under a muted head. Blank rates stay blank (`blankableNumber`). Also the Settings index entry `Crew` with status word `6 roles` (§4.7).

### 9h.6 Phone
- Header `Crew` / `10 – 16 Nov · 4 need crew · 8 unconfirmed`, ⋯ as a bottom sheet; `Planner  Timesheets` words under it; strip scrolls.
- **Day mode** (Logistics' pattern): week ‹ › under the strip, day chips `Tue 11 · 1 open` (open count red), then one day as sections: `Needs crew` (open calls), `Booked` (people as 64 px cards: 22 px checkbox, avatar, name, `#2341 · 06:30–08:30`, status word, ⋯ 40 px), `Free`, `Unavailable`. Tap a booked card → call sheet; tap a free card → offer sheet for that day. `Needs crew` strip = open calls for the week grouped by day.
- Sticky primary `Offer call` / `Log time`; the bulk bar replaces it while ticked.
- Timesheets are cards (name, `#2336 · Fri 7 · 9h`, status, total) with `Show 25 more · n left`. Grid, Columns and the desktop-only export are hidden.

### 9h.7 Code
Composes `DetailHeader`-less page head, `BulkBar`, `RowEditorSheet` (call, entry, role), `ActionMenu`, `StatusPill` as dot-word, `ScanDock` not used. Reused: `useOrgCrewAssignments`, `useOrgAvailabilities`, `useCrewTimeWrites` (`submit/approve/dispute` already take `ids[]`), `useCrewRoleWrites`. New: call offer/confirm/cancel writes from the planner (same mutations the dashboard `sendOfferMutation` and Logistics use, one `*Native` each, `agentOps` danger classified; Cancel is `high`), a `candidates(service)` read. Goes: `SummaryTile` row, `LegendChip`, the fortnight constant, `crew/settings/page.tsx` chrome (body becomes the sheet), sidebar duplicate item. Names link to `/crew/[id]`, job numbers to the job's Logistics tab.

Decisions raised: D46–D49 (§12).

---

## 9i. Scan › Check and Test & tag — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/8Q2HVoRhLbSLz1Q9mCtayX — desktop 1440 and phone 390, every control wired (mode words, dock + Enter + `/` + camera sheet from a tap, every scan state, checklist Pass/Fail/measure/dropdown/notes/photos, Pass all + Undo, save split primary with Undo on toast and strip, test & tag visual ticks with shift-range, readings with N/A, method, tester, outlets, quick pass, fail flag + maintenance job, retire/reactivate, discard confirm, last scans Show more, page ⋯ and card ⋯).

### 9i.1 Why
Live: `src/app/(app)/check/[assetTag]/page.tsx`, `src/components/warehouse/{item-check-form,scan-history-strip}.tsx`, `src/app/(app)/test-and-tag/quick-test/*`. Findings: (1) the result card knows nothing about the asset: `lookupAssetForAdHocCheck` (`src/server/check-records.ts:620`) returns tag, serial, model and check-item count, so a tester cannot see where it lives, whether it is out on a job, or when it was last checked or tested. (2) The check page navigates per scan (`router.push`, page.tsx `ScanNavInput.go`) and the completed state replaces the card, so the next scan costs a route change; the quick test is a five-step wizard of Back/Next buttons for what is one sitting. (3) The quick test can lose or mis-pass work: `page.tsx:324` resets the form 500 ms after save without waiting for the mutation, `page.tsx:125` makes Escape wipe the wizard, a blank reading is skipped so an untested appliance passes (`electrical-step.tsx` auto-calc), and `nextDueDate` is a typed date (`wizard-reducer.ts:172`) although it follows from the interval.

### 9i.2 The page
Pattern 4.4, one centred column (640 px). Head `Scan`, one primary top right, ⋯. Stage words `Check 7  Test & tag 5` (counts = saved this session, active underlined red). Under them the scan dock (one input, keyboard wedge + camera button), then the result card, then Last scans. No bordered cards; hairlines only.
- **Result card:** `AURA-01 ● Prepped` (flags inline: `T&T overdue 38d`, `Damaged`), model name linking to the asset (`https://claude.ai/artifact/Rr5rwirCUMRy8gf5G6Vz7s`), identity line, then four facts in two columns: Where, On job, Last check (`not checked` when none), Last T&T (links `https://claude.ai/artifact/D7N5PmXKrkcY2gzZXWeuvc`, due date amber/red when due). An asset out on another job adds one line: `● On #2340 Launch night — back Tue 11 Nov. A check here is recorded on the asset, not the job.`
- **Check form (inline):** the model's live items in order: Pass/Fail words, measurement (mono input, unit, limit, derived dot-word), dropdown, per-item `note`; `Pass all` in the section head with Undo; FAIL opens a left-ruled reason + photo block (still required, #898). Then Condition `Good Worn Damaged` (forced Damaged and locked by any fail), Notes, Photos.
- **T&T form (inline):** `Tested by` and `Method` as filter words (tester sticks for the session), Visual inspection ticks (always-on checkboxes, shift-click range, `Pass all`), Electrical rows from the profile with thresholds shown and `N/A`, Outlets for sub-test profiles, then Result (`Pass`/`Fail`/`not finished`) with **Next due derived** from the asset's interval, never typed. A fail shows Failure action (`Removed from service ▾` default, notes) and a one-line statement that the asset is flagged.
- **Primary:** `Save and scan next` split button; caret: Save and keep this asset open, Save and print label (T&T), Save and create maintenance job (on a fail). Disabled with the reason in plain words (`Yoke needs a reason and a photo`, `Enter insulation resistance, or mark it N/A`). With nothing loaded the primary is `Scan`.
- **Card ⋯:** Open asset, Quick pass (repeat last test), Pass all, Create maintenance job…, Print label, Open in test & tag list, Clear this scan, Retire from test & tag… (red, confirm names downstream). **Page ⋯:** Scan sounds, Clear this scan, Test & tag list, Assets, Check items (settings), Clear last scans (red, Undo).
- **Removed (jobs kept):** wizard step tabs and Back/Next (one scroll); the typed next-due input (derived); the fail dialog (inline action + ⋯); sidebar/bottom session log (= Last scans); the Check complete card (saved row + ready card); Escape-resets (a scan over unsaved answers asks to discard instead); `router.back()` cancel (nothing to cancel).

### 9i.3 Scan states
- Ready: `Scan a tag to check it`. Unknown tag: tag in mono, `No asset carries this tag`, words Scan again · Type the tag · Register an asset with this tag. Not on register (T&T): `Not on the test & tag register` + Add to the register (Undo). No check items: link to settings. Retired: Reactivate and test (Undo). Other job: the line above.
- Each exception scan is logged in Last scans with a dot-word verdict; none of them blocks the dock.
- Rules: a second scan over unsaved answers opens `Discard this check?`; the same tag again toasts `already open`; a tag or a test tag (`TT-0412`) resolves to the same asset.

### 9i.4 Last scans and Undo
Section head `Last scans 7` + `6 clean · 1 failed` (T&T: `n pass · n fail`), per mode, last 5 (3 on phone) then `Show n more · n left`. Row: tag mono + name, dot-word verdict + detail, time mono, Undo word while inside the 10 s window, row ⋯ (Open asset, Scan it again, Create maintenance job on a failed row). Row tap re-scans. A save builds one `undo` closure handed to both the toast and the row (never two reverse paths); it restores the asset and, if nothing else is loaded, the draft.

### 9i.5 Camera
The camera button and the bottom nav Scan open one sheet (fake viewfinder, reticle, `Camera live` in red, mode word). A read loads the asset and closes the sheet. Rules for the Code subsection: `getUserMedia` only from that tap (never a mount effect), one live capture, `stopStream` on close/unmount/hide, re-acquire on show, `playsInline muted` + awaited `play()`, `facingMode: ideal environment`; one WASM decoder, no `BarcodeDetector` path anywhere (FEATUREDOCS/19). The design adds no second decoder: the dock's wedge input and the camera both end in `scan(tag)`.

### 9i.6 Phone
- Phone header `Scan` + `Check · Jayden Cole · Warehouse A`, ⋯ as bottom sheet; stage words scroll under it.
- The dock is sticky at the top; checklist rows 56 px, Pass/Fail targets 44 px, inputs 16 px; visual ticks 22 px checkbox rows.
- One sticky primary above the nav (`Save and scan next` split, or `Scan` which opens the camera) with the blocker/ready line under it; menus are bottom sheets with 48 px items; row ⋯ always visible 40 px; Last scans `Show n more`.
- Nav Scan item active. No bulk bar: the unit is one asset; the bulk equivalents are `Pass all` (Undo) and the visual range tick.

### 9i.7 Code
Composes: the scan dock + camera sheet + result strip vocabulary from the warehouse job (§5.7), `use-camera-scanner`/`camera-scanner-dialog` unchanged, `useScanFeedback` (sound + history source), `ItemCheckForm` inline mode split into a field list (drop the Sheet shell, hotkeys), `wizard-reducer` retained as the T&T draft (steps dropped, `nextDueDate` removed from state and computed from `testIntervalMonths`), `ScanHistoryStrip` replaced by the Last scans list. New: a server lookup returning location, current job, last check, last T&T (extends `lookupAssetForAdHocCheck`; tenant-checked by org). Save awaits the mutation before clearing the card (fixes page.tsx:324); a blank enabled reading blocks save instead of passing. Routes: `/check/[assetTag]` and `/test-and-tag/quick-test?id=` become deep links that open the same page in the right mode with the tag loaded.

Decisions raised: D50–D53 (§12).

---

## 9j. Finance › the org hub — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/5VnYTVW2pdA5r1qBRvdrom — desktop 1440 and phone 390, every control wired (Quotes / Invoices words, four money words that deep-link, segment strips, Client / Sent / Validity / Kind / Issued / Xero filters, search, sort, pager, tick + shift-range, bulk Chase / Acknowledge / Sync to Xero / Delete drafts with Undo, row ⋯, record-payment and void dialogs, page ⋯, Xero sync dialog and the "Xero not connected" state, `+ New ▾` job picker, saved views, empty states).

### 9j.1 Why
The live hub (`src/app/(app)/finance/page.tsx`, 335 lines; `convex/financeOrg.ts`) is five stacked card sections that each link out. Findings: (1) every section is a `TILE` card with icon, overline and a filled count pill (`page.tsx:30`, `:48-52`), and rows are bordered cards with `Badge` pills — the chrome the program removed everywhere; (2) the one write, `Acknowledge`, is a per-row ghost button (`:150-153`), and there is no selection, sort, paging or URL state, so a dashboard number cannot land on the list it counts; (3) Outstanding shows the invoice `total` and a raw `UNPAID`/`PARTIALLY_PAID` badge (`:228-233`) not the balance, and its subtitle points at a "note below" that does not exist (`:220`). Xero state, which the job Finance tab shows per invoice, is invisible here.

### 9j.2 The page
Pattern 4.1 + 4.6. Head `Finance`, the words `Quotes 27  Invoices 20` (underlined red, where Jobs has Table/Board), `+ New ▾` and ⋯. Under it four money words (Quoted, Awaiting payment, Invoiced this month, Overdue), each a link to the segment it counts (`?tab=invoices&seg=overdue`); then ONE list at a time with its own strip.
- **Words-switch, not stacked.** Live stacks because each section was a short capped list. With strips, stacking gives two toolbars, two footers and deep-link targets below the fold; the switch keeps one list, one URL and one phone column.
- **Quotes strip:** All · Draft · Sent · Accepted · Expired (red when non-zero). **Invoices:** All · Draft · Deposit due · Issued · Paid · Overdue. `All` is added to both, and Deposit due is the live section re-housed. Declined / recalled / superseded and void are under All only after ⋯ › Show … (like Jobs' cancelled).
- **Primary `+ New ▾`** (menu: Invoice for a job…, Quote for a job…; search-first job picker, invoice side lists `$ to raise`). Export is a read and Chase is a contextual bulk verb, so neither earns the red button; creation is the one verb with no row to hang off.
- **Columns** (≤ 8): ☐ · Quote `#2341 v3` / Invoice `INV-0041` (kind + % under it) · Job (client under; `#2341` and client link out) · Status (derived words; `5d left`, `18d`, `$2,950 to go` under) · Sent / Date · Xero (invoices) · Total · ⋯. Contact and PM are opt-in.
- **Row ⋯:** Open on the job · Open PDF (stored copy) / Generate PDF / Preview draft · Mark accepted… · Acknowledge expired · Record payment… · Chase · Push to Xero · red last: Void… (dialog names: number stays used, document stays, Xero voided too, job money recount, payment blocks it) / Delete draft…. Decline, recall, new version, send, issue stay on the job tab (the hub says so in the menu).
- **Bulk:** Chase n · Acknowledge n · Sync to Xero n · Export n · Delete n drafts (red). Counts are the eligible rows; the rest are skipped and the toast says so.
- **Views / URL:** tab, segment, filters and search are query params; two default views per list.

### 9j.3 Rules the design keeps (CLAUDE.md)
- **Stored bytes:** `Open PDF` opens the stored document ("exactly the bytes sent 4 Nov"); a draft only previews, watermarked. A row with no stored PDF offers `Generate PDF`, which never replaces an existing one. No regenerate path.
- **Derived, never stored:** Expired (`validUntil < now && SENT`), Overdue, Part paid, Deposit due and every money word are computed on read. Expired shows 7 days or until acknowledged (live rule); older ones live under All.
- **Money phase:** no new status. Record payment copy says paying a deposit in full can confirm an awaiting-payment job (#1236 PAYMENT_SETTLED); accept says the job advances if automation is on.
- **Flow never emails the client (decision 7, #934):** the brief's `Send reminder` is `Chase` — a dialog showing the follow-up text and `Copy`, same as the job tab's chase.
- **Invoice overdue wins over part-paid** when past due and balance remains (the job tab's `payState` shows Part paid); a chasing list must not hide an overdue behind a payment.

### 9j.4 Xero
A Xero dot-word column (Synced · Not in Xero · Failed with the error in the tooltip), `Sync to Xero n` in the bulk bar, filter `Xero ▾`, page ⋯ › `Xero sync…` (counts, Check payments now, Xero settings). When not connected the column, filter and verb disappear and a one-line note (`Xero isn’t connected` · Open Xero settings) sits above the list on Invoices; the dialog says the same. Payments reconciled in Xero are not recorded here.

### 9j.5 Phone
Header `Finance` + `27 quotes · 20 invoices · Xero connected` + ⋯ sheet; the Quotes/Invoices words as a strip row; money words as a 2×2 grid; segment strip and filter words scroll; search full width; 64 px cards (name, `number · date · client`, status + total right, 22 px checkbox, always-visible 40 px ⋯); `Show 2 more · n left`; sticky `+ New ▾` replaced by the bulk bar; export hidden; menus and the job picker are bottom sheets.

### 9j.6 Code
Composes `ListPage` (§9b.6), `BulkActionBar`, `RowActionsMenu`, `SavedViewsMenu`. Reuses `effectiveQuoteStatus`, `useQuoteWrites`, the job tab's `payState` (extract to `src/lib`), `chaseSummary`. One convex query replaces `financeOrg.bundle`'s five buckets with paged `quotes`/`invoices` queries + `counts` (the money words); the bucket scans' SECTION_CAP stays as the guard and shows a footer note when hit. Goes: five section components, `RowShell`, `TILE`, `Badge` use, the client substring box, `AllClearState`.

Decisions raised: D54–D56 (§12).

---

## 9k. Settings — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/Q3TeWuQPjzvXbAtmUV8Hg8 — desktop 1440 and phone 390, every control wired (index search, all 19 rows open, Team: member search, Role filter word, tick + shift-tick + select-page, bulk Change role / Remove / Resend / Revoke / Approve / Reject with Undo, row ⋯ for members, invites and requests, role word menu, Invite dialog with validation, Join policy radios with Save/Discard bar and leave guard, permission grid with expandable resources, role edit sheet, Preview-as-role in the page ⋯).

### 9k.1 Why
Live: `settings/layout.tsx` (a 56-wide second rail beside the app sidebar, plus a jump-select on phone), 18 pages built from `SettingsCard`/`FormSection` chrome. Findings: Team has per-row Select, trash and X buttons (`member-list.tsx:205,231,159`) and Approve/Reject buttons (`join-request-approvals.tsx:78-108`); the role list is hand-kept twice (`member-list.tsx:29` has 4 roles, `role-descriptions.ts:24` has 5 including warehouse, R-3.1); `PermissionMatrix` is imported nowhere, so nobody can see what a role can do. No resend-invite, no bulk, no danger zone (the kill switch sits on API keys, `api-keys/page.tsx:131`).

### 9k.2 The page
The index replaces the rail: one list grouped under calm headings (Organisation, People & access, Operations, Money, Integrations, Developer, Danger zone), each row name · one-line description · status dot-word · ›, whole row opens, bare search matching names, descriptions and the parts inside pages (`tax` finds General, Billing, Services, Xero). No primary, no strip. Rows a role cannot open are absent, with one muted footer line naming them. Status words are derived: Team counts members and invites, Xero says Connected or Not set up, Mira says `On · read-only` or `On · can write`. Sections are record pages without tabs: title, muted identity line, one primary, page ⋯. A header status word appears only when the body does not already state it (Team omits it).

### 9k.3 Team
Members (checkbox, avatar, name · email, role word, joined, ⋯), Invitations (status Pending / Expired derived from `expiresAt`), Join requests, Join policy, Roles & permissions, in that order, each a hairline section with a mono count.
- Role is a word; clicking it opens the role menu and writes at once with Undo. Bulk `Change role… 3` uses the same menu.
- Bulk verbs are contextual by kind: members `Change role… n`, `Remove n`; invites `Resend n`, `Revoke n`; requests `Approve n`, `Reject n`. Destructive last, red. The owner is skipped and the toast says so.
- Remove and Revoke confirm in a dialog naming the consequence (live copy); both toast Undo (Undo re-adds / re-issues a fresh link).
- Invite is a dialog: email (inline validation: malformed, already a member, already invited), five role radios with the live descriptions.
- Join policy is three radio rows. Editing makes the section `Unsaved` and raises a Save/Discard bar named for the section (`Save join policy`); leaving with unsaved changes asks. While the bar is up the header primary demotes to secondary, so one red button exists. Section hidden without orgSettings:update, requests without orgMembers:invite (as live).
- Permission grid: 20 resources × 6 roles read from the real registry; a cell reads `All`, `3/6` or `—`; a resource opens to per-action ticks; footer `Actions granted 72/92`. Role headers show people and `edited`. Selecting a role opens the edit sheet: every action as a tick, View required before the rest, Admin keeps the four actions that fix permissions, Owner is fixed, `Reset to defaults`, Save with change count and Undo.
- Read-only users (manager) see a one-line note and no checkboxes, primary or policy.

### 9k.4 Stubs and the other 17 sections
Each opens the same header with its parts (every live FormSection named), primary, gate and notes. The shape they adopt: inline fields, Save per part through the dirty bar, ⋯ for verbs, Undo on reversible writes, confirms that name what breaks (Mira write-access flip revokes every member's cached key; calendar token regeneration breaks every subscribed feed).

### 9k.5 Phone
Index is what the More sheet's Settings entry opens (kit bottom nav kept until D1). Rows are 64 px cards, status at the right, description one line. Section header has back ‹, name, identity line, ⋯ sheet. Cards 60+ px with 22 px checkbox, row ⋯ always visible, bulk bar replaces the sticky `+ Invite member`, dirty bar replaces it too, dialogs and menus are bottom sheets. The grid is desktop-only; phone shows the six roles as rows opening the same sheet.

### 9k.6 Code
Composes list rows (§9b), the record header (§4.2), `RowEditorSheet` for the role sheet, the non-blocking confirm dialog shape. Reuse `rolePermissions`/`RESOURCES`/`PERMISSION_REGISTRY` for the grid (never a copy), `ASSIGNABLE_ROLE_OPTIONS` for every role list (add warehouse to `ORG_ROLES` or derive from `rolePermissions`). Delete `SettingsCard`/`FormSection` use, the layout rail and jump-select, `PermissionMatrix`. New: `resendInvitation`, bulk role/remove wrappers, `joinedAt` read, kill switch moved. Index metadata (name, description, gate, status) is one registry that also drives the search and the gate check, replacing `settingsNav`.

Decisions raised: D57–D61 (§12).

---

## 9l. Forms — v1 proposal (prototype 2026-11-04, awaiting a yes)

**Prototype:** https://claude.ai/artifact/REMbu5TYg5Nx6iJJoPLuGy — desktop 1440 and phone 390, every control wired (gallery search and row ⋯, all eleven sheets/dialogs in create and edit with inline validation, search-first pickers with Enter-picks-top, dependent fields, Save and add another for asset/crew/location, client contacts as rows, discard prompt, Undo on every save, the New job row opening the wizard).

### 9l.1 Why
Eleven forms (`src/components/{assets,clients,crew,suppliers,locations,kits,maintenance}/*-form.tsx`) are separate full pages with their own layout and no shared validation display. Schemas are the source (`src/lib/validations/*.ts`); the sheet changes only how they render. Findings: `kitSchema` and `locationSchema` carry optional money/number fields that must stay blank-able (`blankableNumber`); `supplier-order` has `supplierId` required and a separate route; `maintenanceSchema` only applies `completed`/outcome fields when `status === "COMPLETED"` (comment at `maintenance.ts:38`). The user asked to see every face-lifted form, not read the order table.

### 9l.2 The page
A calm gallery: head `Forms`, sub line, one red primary `New job ↗` (links the wizard), page ⋯ (sibling links). Rows are grouped (Gear and places · People and suppliers · Maintenance and jobs), each with name, the route it replaces, field count, last saved. Row click opens Create; row ⋯ opens Create or Edit (prefilled with a realistic record). `Last saved` is a dot-word plus what changed, and goes back to `—` on Undo. There are no checkboxes or bulk bar: nothing here has a bulk verb, so the always-on checkbox rule is deliberately not applied.

### 9l.3 The sheet (`RowEditorSheet`)
Copied from the asset sheet: centred wide on desktop, full-height bottom sheet on phone; bold section word + muted hint; `More details` collapsed on create, open on edit; inline errors as you type (after a field is touched, all after the first Save); footer Cancel · `Save and add another` (batched forms) · primary.
- Required, max length, ≥ 0 or blank money (`Enter an amount of 0 or more, or leave it blank`), integer and range bounds come from the Zod schema; blank money stays blank.
- Pickers are Radix-combobox style: type, arrows, Enter picks the top result, Esc closes the list first and the sheet second. Multi pickers (maintenance assets, kit contents) stay open and add rows.
- Dependent fields: client type (Company / Person / Venue / Production company) relabels the name and hides contact name and ABN for Person; maintenance `COMPLETED` reveals Completed date and Outcome (cost, parts, result, per-asset disposition that defaults to keep-out on Fail); kit check mode rewrites its hint; model sale price reveals sale stock, `Requires test & tag` reveals profile and validity; client payment profile reveals deposit %.
- Cancel or Esc with changes asks `Discard your changes?` (Keep editing / Discard).
- Save toasts what changed with Undo (snapshot closure); `nothing changed` toasts without Undo.
- Add another keeps context: asset (model, location, bin, condition; tag advances; serial clears), crew (type, status, department, role, rates), location (parent, type).

### 9l.4 Form → route change → notable rules
| Form | Route change | Notable rules |
|---|---|---|
| Asset | `/assets/registry/new`, `/[id]/edit` → sheet; words fold in Bulk | model search-first shows next tag; tag required ≤ 50, unique; warranty not before purchase; price blank-able |
| Bulk stock | `/assets/registry/new?kind=bulk` → sheet | stock code unique; quantity ≥ 1 |
| Model | `/assets/models/new`, `/[id]/edit` → sheet | name required; rates blank-able ≥ 0; T&T reveals profile + validity ≥ 1 |
| Kit | `/assets/kits/new` → sheet | tag required unique; contents search-first (bulk gets qty); check mode words |
| Location | `/assets/locations/new` → sheet | parent search-first, may be empty; excludes itself in edit; notes ≤ 1,000 |
| Client | `/clients/new`, `/[id]/edit` → sheet | type relabels; email format; discount 0–100; contacts are rows on edit |
| Crew member | `/crew/new` → sheet | first and last required; rates blank-able; add another |
| Supplier | `/suppliers/new` → sheet | name required; email format |
| Supplier order | `/suppliers/[id]/orders/new` → sheet | supplier and order # required; expected not before order date |
| Maintenance job | `/maintenance/new` → sheet | ≥ 1 asset, title required; completed not before scheduled; outcome only when completed |
| Service schedule | stays a dialog | interval 1–120 months; anchor date required |
| New job | `/projects/new` → the wizard (§9.4) | not rebuilt here |

### 9l.5 Phone
Gallery rows are cards (name, route line, field count, ⋯ always 40 px); sticky primary `New job`. Every sheet is a full-height bottom sheet, inputs 16 px, footer pinned: `Save and add another` as a word line above Cancel + primary. Service schedule is a bottom dialog.

### 9l.6 Code
One `RowEditorSheet` driven by the Zod schema (`z.input` types, `.omit()/.pick()` variants), `combobox-picker.tsx` for pickers (Radix Popover, never Base UI inside a Radix Dialog), `useNative*` write hooks unchanged, `blankableNumber` for optional money. The eleven `*-form.tsx` page layouts and their `/new` and `/edit` pages go; routes redirect to the sheet.

Decisions raised: D62–D64 (§12).

---

## 9m. People › Client, Crew member, Supplier, Supplier order records — v1 proposal (prototype 2026-11-05, awaiting a yes)

**Prototype:** https://claude.ai/artifact/D8UV81TDFpMEeUBxf2apUX — desktop 1440 and phone 390, every control wired (record switch, tabs with hash state, words filters, tick + shift-range, bulk bar + Undo, row ⋯, page ⋯, Edit sheets, merge/archive/inactive confirms, extend hire, log time, upload, History composer).

### 9m.1 Why
Four record pages with four layouts: `clients/[id]/page.tsx:236` draws a bordered hero card with HeroStat boxes, `crew/[id]/page.tsx` is 2,355 lines with per-row icon buttons (`:593`, `:787`) and an Approve all button (`:1439`), `suppliers/[id]/page.tsx:371` carries Edit + a ⋯ that holds only Delete, and the order page (`orders/[orderId]/page.tsx:243`) shows four stat boxes over a table. None has an Overview. The live data is good; the chrome and the missing derived health are the problem.

### 9m.2 The page
The §4.2 record page, copied from Asset and Model. DetailHeader (name · status dot-word · identity line), `Edit` the one primary (opens the Forms sheet for that record), page ⋯ with the rest, red verbs last with a confirm naming what stays. Overview first, calm: an overline, one headline, health rows with a muted `Action ›`, three fact columns, relationships as rows. List tabs follow §4.1 without the head; History is the Discussion rendering with a one-line composer. Context rail on every tab but Overview. Breadcrumb `Clients/Crew/Suppliers › name` links the People lists; order adds the supplier.
- Client: Overview · Jobs · Quotes & invoices · Contacts · Files · History. Headline `$11,940 outstanding`; rows `INV-0042 $11,940 due 28 Nov`, `QT-2359 expires in 11 days`. ⋯: Edit, New job, Sync/Change Xero mapping, Merge, Archive (red).
- Crew: Overview · Calls · Timesheets · Availability · Documents · History. Headline `2 calls · 18 h`; rows unconfirmed Bump in, `licence expires in 12 days`, `2 timesheets awaiting approval`. ⋯: Message, Resend offer, Log time, Add block, Calendar feed, Export, Make inactive, Delete.
- Supplier: Overview · Orders · Sub-hires · Assets · Contacts · Documents · History. Headline `14 units on hire`; row `SH-0012 return 2d overdue`.
- Order: Overview · Lines · Files · History. Headline `On hire · 14 units`; rows overdue return (`Extend hire`), invoice not attached; link to `#2341` Equipment.

### 9m.3 Derived, never stored
Outstanding, lifetime, overdue, expiry words, `On hire`/`Returned`, late days, margin, order total and spend are computed on read. `On hire` is `SUBHIRE` + received + no return date, so the stored status vocabulary (Draft/Ordered/Partial/Received/Cancelled) is untouched; only a return date is new (D?). The overdue return resolves by `Extend hire` (job needs the gear to 14 Nov) or `Mark returned`, both with Undo.

### 9m.4 New capability, each closing a found gap
Quotes & invoices on the client (Finance owns the documents; this is the account view); Merge client (dialog lists what moves); crew Documents with expiry (feeds the Overview row); crew Message; supplier Contacts; order Return due. Calendar tab becomes a dialog; Notes tab becomes an Overview section.

### 9m.5 Phone
Header name + identity line + ‹ back + ⋯ bottom sheet; scrolling tab strip with counts; cards 60–72 px, 22 px checkbox, id moved into the meta line, ⋯ always visible 40 px; sticky `Edit` above the bottom nav, replaced by the bulk bar on tick; sheets full-height, inputs 16 px; `Show n more · n left`.

### 9m.6 Code
Reuse DetailHeader, RowEditorSheet (Forms), `useConfirm…` dialogs. Delete the hero cards, HeroStat, the per-row icon buttons and the Calendar tab. Money matches the siblings: outstanding $11,940, INV-0041 deposit 25% $6,567 paid 8 Nov (Finance hub).

Decisions raised: D71–D74 (§12).

---

## 9n. Gear records — Location, Kit, Maintenance job, Test & tag, Category — v1 proposal (prototype 2026-11-05, awaiting a yes)

**Prototype:** https://claude.ai/artifact/PDsjUdku2seVZAWfNC6W61 — desktop 1440 and phone 390, every control wired (record switcher words, `#type/id/tab` hash, Overview checks, list tabs with search, filter words, tick + shift-tick, bulk bars with Undo, row ⋯, page ⋯, Edit sheets, Complete / Record test / Scan dialogs, destructive confirms, files grid, notes in History, empty states, Show more).

### 9n.1 Why
Five record pages built five ways: `locations/[id]/page.tsx:276-358` (hero card, type pill, always-visible Delete), `kits/[id]/page.tsx:430-500` (three header buttons, no tabs, stored `INCOMPLETE` status), `maintenance/[id]/page.tsx:184-290` (Panels, parts as one free-text field and cost as one number), `test-and-tag/[id]/page.tsx:259-300` (four header buttons, a disabled Edit). None lands on a state; none has a context rail; deletes say "unlinked" without naming what.
They become the asset and model record pages: DetailHeader, Overview first, list tabs, Discussion-style History, one Edit, one ⋯.

### 9n.2 The page
- Header: name · derived dot-word (`69% full`, `Incomplete`, `Awaiting parts`, `18d overdue`, `2 models without rates`) · identity line. `Edit` opens the Forms sheet (location, kit, maintenance sheets copied from §9l; T&T and category are new field tables, category a small sheet). ⋯ holds the rest, destructive last in red with a dialog naming downstream effects.
- Overview: head word + `n of m checks clear`, rows with muted `Action ›`; three facts; Identity list. No table. Checks that cannot run say `not checked` (location stocktake).
- Tabs — location: Contents · Bins · Jobs · History · Files; kit: Contents · Checks · History · Files; job: Assets · Parts · History · Files; T&T: Tests · History · Files; category: Models · Kits · Subcategories. Rail on every non-Overview tab. Notes tabs are gone: the text is a sheet field, discussion is a note in History.
- Lists: bare search, filter words that read their value (`Bin: B2 ✕`), checkbox rows, bulk bar with counts (`Move 3 to…`, `Mark present 1`), row ⋯, `Show 25 more · n left`, one footer line.

### 9n.3 Things that needed design
**Location.** Bins are child locations with capacity, label state and last movement. Warehouse A reads 412 assets, 11 bins, `3 assets with no bin`. Moving a case moves what is in it. `Print bin labels` offers unprinted-only or all. Scan = put-away (asset into this place, optional bin); a read of an asset already there says so rather than moving it.
**Kit.** Complete/missing is derived from contents. Missing item beats reservation: `1 item missing … needed for #2341, truck Tue 11 Nov 06:30` blocks (`Can't go out`). Check mode is two words on the Checks tab. Scan = check: each read ticks an item off; the last one flips the kit to Ready. Value shows replacement and paid; case info is Identity.
**Maintenance job — Complete.** Dialog: result (Pass/Fail/Conditional), completed date, labour (blank is not $0), next due, per-asset disposition defaulting from the result (fail → keep out of service). Cost is derived: parts lines + labour. Completing writes the outcome, updates each asset, toasts with Undo; `Reopen` reverses it. `Mark arrived` moves Awaiting parts to In progress.
**Test & tag.** Next due is last test + interval, never stored. Record test: readings against limits, live Pass/Fail line; a fail raises a repair job, keeps the asset out of service and links it in the test row. `Book a test` creates a scheduled T&T job. Delete is offered only after Retire.
**Category.** Default T&T profile (class, interval) inherited by its models; models can override. `Including subcategories` widens Models. Deleting moves models to Uncategorised and subcategories up.

### 9n.4 Phone
Phone header (name + dot-word + one fact + ⋯ sheet); Record strip is prototype-only; tab strip scrolls; filter words scroll under a full-width search; cards 60+ px with 22 px checkbox, tag moves into the meta line; sticky primary per record (`Scan` location and kit, `Complete` open job, `Record test` T&T, `Edit` category) replaced by the bulk bar on first tick; sheets are bottom sheets; inputs 16 px.

### 9n.5 Code
Composes DetailHeader, Tabs (controlled, `?tab=`), the §4.1 list rows, `useConfirmStatusGate`-style non-blocking previews for Retire/Delete, the Forms sheet. Derive: kit status, T&T next due, maintenance cost, location fill, category asset counts. Remove: five hero cards, header button rows, Notes tabs, per-row delete buttons.

Decisions raised: D75–D80 (§12).

---

## 9o. Schedule — v1 proposal (prototype 2026-11-05, awaiting a yes)

**Prototype:** https://claude.ai/artifact/49jbSumcZhVdCU9ZA3nqdm — desktop 1440 and phone 390, every control wired (Jobs / Gear words; Week / Month zoom; ‹ › Today; strip All · Confirmed · Pencilled · Clashes; Status / Category / Model / PM filters, search, Clear; click a bar for the job sheet, a day header for the day sheet, a gear cell for the model-day sheet; tick + shift-tick, bulk Confirm n with the heads-up gate, Move dates… with the date-move gate, Sub-hire n short, Undo on every write; row ⋯, page ⋯ › Only my jobs; empty state; phone day mode).

### 9o.1 Why
Live: `src/app/(app)/availability/page.tsx` (867 lines) over `convex/availability.ts calendarData` and `convex/lib/availabilityCore.ts`. Three findings.
- It is a read-only picture of jobs and says nothing about gear. The page's own subtitle is "when projects are live and gear is committed" (`page.tsx:~255`) but `calendarData` returns only `lineItemCount` (`availability.ts:293-340`); the HARD vs pencilled rule in `availabilityCore.ts:91-111` (a pencilled job holds nothing) never reaches the screen, so two jobs that overbook a model look like two bars.
- The six-week grid caps bars at three lanes and hides the rest behind "+n more" (`page.tsx:~520`); the busy-day legend (1 / 2 / 3+ projects) counts jobs, not stock, so "red = 3+" is not "short".
- No filter, search, selection or write. Confirming or moving a job means leaving for the job page; the fixes the confirm gate and date-move gate already exist for (#1227) are not reachable from the page that shows the clash. Phone squeezes the same grid; Agenda is a second view of the same list.

### 9o.2 The page
One page, `Schedule` (sidebar rename per D7), with two views as words in the head, `Jobs  Gear` (Jobs' `Table  Board` position). Pattern 4.4, sibling of the crew planner.
- **Primary** `+ New job` (wizard). **Page ⋯:** Only my jobs, Overbookings ›, Crew planner ›, Logistics ›, Export this range (CSV), Copy link.
- **Strip** `All 9 · Confirmed 5 · Pencilled 4 · Clashes 2` (Clashes red when non-zero). **Gear has its own model-based strip** `All 16 · Short 1 · At risk 2` (short = a hard shortfall, red; at risk = a pencilled shortfall, amber); the job strip is not reused there. Counts follow the range and filters.
- **Toolbar:** `‹ 10 – 16 Nov ›  Today  | Week  Month`, search (`job, client or model`), `Status ▾ Category ▾ Model ▾ PM ▾` reading their values, `Clear`. In Gear, Status and PM narrow the rows to models those jobs hold; the numbers stay the whole org's.
- **Footer** is the legend, one muted line: `Solid bar holds gear · dashed bar is pencilled and holds nothing`.
- **Removed:** Agenda (desktop; the day sheet and phone day mode cover it), the busy-day legend and tint (counts in the day header), the 3-lane cap and `+n more`.

### 9o.3 The timeline (Jobs)
Rows are jobs (start order), columns days; label column 264 px = checkbox, `#2341 name`, `client ● Status · pencilled`, row ⋯ on hover. One bar per job across its rental window; left/right edges square when it continues past the range.
- **Held vs pencilled without fills shouting.** Held = a quiet raised block with a hairline; pencilled = no fill, a faint hairline and hatching, muted text. Colour lives only in the status dot-word in the label (the bar carries no status colour, so the fact is not printed twice). A held job that causes a shortfall prints a red `clash` (#2337 Allianz and #2342 Mercedes both hold EM4 receivers on Tue 11 Nov); a pencilled job that would overbook if confirmed prints an amber `would clash` (#2350 Qantas awards, Quoted, against #2341's MAC Aura PXL on 13 – 14 Nov, so #2341 itself shows no red). Both are derived (`jobRuns`), never stored. Month zoom shows the same as a dot before the number.
- **Day headers** `Wed 12` + `3 jobs` (muted, mono). Weekends faint; today a hairline. Click opens the day sheet.
- **Week / Month.** Week = Mon–Sun, ‹ › step 7 days. Month = the calendar month (30 slim columns, weekday initial + number), ‹ › step a month. Today = the working week from 10 Nov (9 Nov is a Sunday).
- **Job side sheet** (click a bar or label): status + `holds its gear` / `pencilled · holds nothing`; When, Truck, Client · contact, PM, Value, Gear (models · units · lines). A `Clashes` section lists each short model with the other job (`short 2 · MAC Aura PXL · with #2350 · 13 – 14 Nov`); each row opens the model-day sheet. Actions: `Open job` (Overview), `Equipment ›`, `Logistics ›`, then `Confirm…` / `Move dates…` words. Deployed and on-site jobs say their dates are locked.

### 9o.4 Gear
Rows are models grouped by category (`Lighting 5`), cells the free count per day (serviceable − held by hard jobs). Plain days print only the number (faint when nothing holds it). A shortfall (two confirmed jobs, e.g. EM4 receivers short 2 on 11 Nov) prints a red flag-word `● short 2` with `held 10` under it; a pencilled risk (MAC Aura PXL 13 – 14 Nov, beltpacks 14 Nov) prints the free number in amber with `pencilled −2` (confirming the pencilled job would take it below zero). The cell sheet adds `would be short 2 if #2350 confirms`. Day header carries `1 short` in red. Month zoom shrinks cells to the number, `−2` red. Model label shows `12 owned · 1 in service` (AURA-06 fan fault, derived from maintenance, not typed).
- **Click a cell** → model-day sheet: Serviceable, Held, Free; `Held by` rows (job, qty, each opens the job sheet); `Pencilled, holds nothing` rows; any `Sub-hire requested` rows; then `Sub-hire 2…` (secondary), `Overbookings ›` (Gear lists), `Open model ›`.
- **Sub-hire…** dialog: supplier, quantity per model (default = the shortfall), window = the short run. Requested sub-hire prints `requested` under the cell and **the shortfall stays** until the gear arrives (same rule as Overbookings). Toast + Undo.
- Demand reads `stockBackedQty`, so off-inventory units never count (9o.7).

### 9o.5 Bulk and the gates
Always-on checkboxes (header = select shown), shift-click range, bulk bar with counts in the verb.
- **Confirm n** (counts only `Quoted` jobs; the toast says what was skipped). It runs the non-blocking confirm gate: simulate the jobs as hard, compare shortfalls with today's; none → confirms with no UI change; some → heads-up dialog `Confirming #2350 leaves a model short`: `short 2 · Martin MAC Aura PXL · 13 – 14 Nov` / `#2341 Hilton Sydney gala dinner would be short 2 × Martin MAC Aura PXL if #2350 confirms`, buttons `Cancel` / `Confirm 1 anyway`. Same gate from the row ⋯ and the job sheet. Fails open: a preview error confirms without a dialog.
- **Move dates…** one dialog, `Move by` 1 week earlier … 1 week later with `old → new` per job; same gate for the date-move case (#1227; moving #2341 a day earlier lands it on the EM4 receivers #2337 and #2342 hold), same dialog grammar, `Move anyway`. Deployed / on-site jobs are skipped and the toast says so.
- **Sub-hire n short** (Gear selection). Every write toasts with Undo through one `snapshot()` closure. No per-row buttons; row ⋯ has Open job, Equipment, Logistics, Confirm…, Move dates…, Copy link (Gear: Open model, Overbookings, Sub-hire n…).

### 9o.6 Phone
Header `Schedule` / `10 – 16 Nov · 9 jobs · 2 clash`, ⋯ as a bottom sheet; `Jobs  Gear` under it; strip scrolls; week ‹ › Today, search, filter words scroll; **day chips** `Wed 12 · clash` (red) or `3 jobs`. Jobs: cards for that day (22 px checkbox, `#2341 name`, `client · 12 – 14 Nov`, status word, `clash` under it, ⋯ 40 px); tap → bottom sheet with the same facts and 44–48 px actions. Gear: models for that day (`short 2` or `9 free`), tap → model-day sheet. Zoom and the grid are hidden. Sticky `+ New job`; the bulk bar replaces it while ticked. No paging (a day holds a handful), so no `Show more`.

### 9o.7 Code
Composes the §9b shell, `ActionMenu`, `BulkBar`, a side `Sheet` (bottom sheet on phone), `Dialog`. Reads: `availability.calendarData` extended to return per-job `lines: {modelId, qty}` (stock-backed) and the model day-grid from the existing `availabilityCore` (one `scheduleGrid(orgId, start, end)` query, org-checked, `requireOrgReadFor`); flags and runs are pure functions over it, shared with the confirm gate (`useConfirmStatusGate`) and `useDateMoveGate` — those hooks' preview queries are the same `newShort` simulation, one definition (R-3.1). New writes: none except Sub-hire request (existing overbooking sub-hire mutation) and the date move / confirm the job page already calls. Goes: `MonthGrid`, `AgendaView`, `DayProjectCard`, `LegendSwatch`, `dayIntensity`, `WeekOverflow`, `ViewToggleButton`. URL state: view, zoom, range start, filters, day.

Decisions raised: D81–D84 (§12).

---

## 10. Everything else, briefly

Every surface in the playbook's §9 now has a section (6c, 6d, 7b, 7c, 9c–9o). What is
left here is the glue between them.

- **DataTable** lists adopt the §9b list-page pattern (strip, filter words,
  checkbox + bulk bar, phone cards, URL state); the three ad-hoc inline icon sets go.
  §9f and §9g show it holds for ten more lists with one config-driven renderer.
- **Record pages** (asset §9d, model §9e) use underlined-word tabs and a dot-word
  status in `DetailHeader`. The job page's pill tab strip (§6b–§8c prototypes) moves
  to the same words when Phase 1 builds the primitive — one tab style, not two.
- **The job tab strip** gains `Packing n/m` and `Versions n` (§7b). The accepted job
  tab prototypes are not republished for it; the strip is a primitive.
- **Phone row ⋯** is always visible at 40 px on every list (§5 of the playbook, D39);
  the Jobs and Assets prototypes predate it and get it in Phase 1.
- **Payment status precedence** is one rule everywhere: Overdue outranks Part paid
  (D56) — the job Finance tab (§8b) follows the hub.
- **Notifications** page gets a "See all" link from the bell (§6c); **changelog** links
  from Settings › General (§9k).
- **Shell (§6):** D1 (Scan + More in the bottom nav) is still open. The twelve new
  prototypes keep the kit's nav (`Home · Jobs · Scan · Warehouse · Assets`).

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
| D11 | List filters, sort, page and view live in the **URL**; `localStorage` persistence goes | Yes — saved views and dashboard tiles become links, back works (§9b.2) | Keep per-browser persistence and add deep links on top |
| D12 | Assets registry opens on the **Table**; Grid is remembered per user | Yes — operators look things up, browsing is the exception | Keep today's Grid default |
| D13 | `Needs you` / `Needs attention` are derived list segments, not stored flags | Yes — same rule as the Overview readiness checklist | A stored "flagged" bit set by the writers |
| D14 | The default Home is the fixed calm layout; the customisable grid moves behind ⋯ › Customise… | Yes | Keep the grid as the default |
| D15 | Lists accept URL-only qualifiers so a stat's number matches the list it opens: Jobs `?seg=active` (booked + out) and `?seg=out&overdue=1`, shown as removable filter words | Yes | Add `Active` and `Overdue` words to the Jobs strip |
| D16 | Notifications vocabulary: "Mark read" replaces "Dismiss" (same stored dismissal); `Unread · All` strip | Yes | Keep "Dismiss" |
| D17 | On now becomes org-wide (floor, out today, due back); the widget hook must stop reading `myProjects` only | Yes | Keep it personal and rename the section |
| D18 | My tasks gains `+ New task` (personal or job) | Yes | Read-only page |
| D19 | Versions becomes a job-page tab (chip menu + `V` stay); the Sheet goes | Tab | Keep the Sheet and add a phone entry that opens it |
| D20 | Compare as a read-only sheet from the row ⋯; the page-level mode goes | Sheet | Keep Compare mode and link it from the row ⋯ |
| D21 | `Seal case` stores `projectContainers.sealedAt` (blocks plan changes; print label on seal) | Add the field | Ship Print label only, no seal in v1 |
| D22 | `/projects/[id]/edit` becomes a sheet (`?edit=1`) opened from the Overview `Edit`; status leaves the form | Yes — one edit surface, status keeps its gates | Keep the page |
| D23 | Templates become `Start from template ▾` on wizard step one + a `Manage templates…` dialog; `/projects/templates` redirects | Yes — one way to start a job | Keep the list page |
| D24 | The wizard writes an Enquiry draft at step one (number allocated then) and `Create job` finishes it | Yes — nothing is lost on a dropped connection | Create only on the last step |
| D25 | Moving rental dates carries a set project window by the same offset | Yes | Leave the window alone |
| D26 | `/warehouse/returns` becomes a redirect to `/warehouse?mode=returning`; Returns is a mode of the floor | Yes — one scan surface, one dock, one strip, live subscription replaces Refresh | Keep a separate Returns page sharing the dock component |
| D27 | Floor columns are derived from unit state; no drag, no stored stage; manual overrides only via card ⋯ › Admin (extends D6) | Yes | Allow drag between columns as a manual override |
| D28 | Phone has no sticky Scan bar on the floor: the dock and the nav's Scan are the primary (amends playbook §5 sticky-primary rule for surfaces whose dock is the primary) | Yes | Add a `Scan` sticky bar that replaces itself with the bulk bar |
| D29 | `Late` is a derived outcome (out past end, or returned after it), not a recorded one | Yes | Store `returnedLate` on the unit |
| D30 | Asset detail opens on a new **Overview** tab (health checklist), tabs controlled with `?tab=` | Yes — mirrors #1061 and answers "is it fit to go out" first | Keep History as the landing tab |
| D31 | `/assets/registry/[id]/edit` and `/new` become the sheet (redirect to `?edit=1` / open over the list) | Yes | Keep the routes as pages |
| D32 | Delete leaves the ⋯ and lives only inside Retire, enabled only for an asset with no history | Yes — retire is reversible, delete is not | Keep Delete beside Archive |
| D33 | Asset ⋯ item `Archive` is renamed `Retire` everywhere (matches the list's status word) | Yes | Keep "Archive" |
| D34 | Phone: sticky primary is `Scan` on the asset page, Edit moves to the phone ⋯ | Yes | Sticky Edit |
| D35 | Model detail lands on Overview; Details becomes the edit sheet and `/edit`, `/new` redirect to `?edit=1` | Yes | Keep a Details tab |
| D36 | Duplicate model and Print labels for all are new model-level verbs (copy rates, specs, accessories, checks; one label sheet for every unit) | Yes | Defer until asked |
| D37 | ROI default hides cost and payback behind `Show cost & payback` (per-user, local) | Yes | Show all four figures as today |
| D38 | Crew landing page is the list; the manager dashboard is dissolved into strip counts, Timesheets and Planner | Yes | Keep CrewDashboard above the list |
| D39 | Phone cards carry an always-visible 40 px row ⋯ (retrofit Jobs and Assets) | Yes | Whole-card tap only |
| D40 | "This week" = the next seven days from today; Available = nothing confirmed in that window | Yes | Calendar week Mon–Sun |
| D41 | Sales stock gains a `reorderLevel` per model; `Reserved` is derived from confirmed jobs, never stored | Yes | Keep On hand only |
| D42 | Locations gain optional `capacity`; `Last movement` is derived from movement records | Yes | Drop both columns |
| D43 | Cost/margin columns (Value, ROI, Cost) are opt-in from ⋯ › Columns on every list | Yes | Show Value by default on Models |
| D44 | `/maintenance/due`, `/test-and-tag/registry` and `/reports` become segment / dialog; old URLs redirect | Yes | Keep as pages |
| D45 | Overbookings crew and sale-stock tiles become Kind-filtered rows of the same list | Yes | Separate Crew gaps list |
| D46 | Planner shows one week (‹ ›), not a fortnight | Yes — blocks need room for number, role, times, status | Keep 14 days with compact chips |
| D47 | `Dispute` is relabelled `Query` in the UI (enum unchanged); Query… stores a reason on the entry | Yes — it asks the crew member to check, and the reason was missing | Keep "Dispute", no reason |
| D48 | Planner and Timesheets are one sidebar item `Crew` with two words; `/crew/settings` becomes ⋯ › Crew roles & rates… (route kept as a deep link) | Yes | Keep three routes in the sidebar |
| D49 | Timesheets show rate and total (manager-only) so approval is a money decision | Yes — hours × the role rate already on the assignment | Hours only |
| D50 | Ad-hoc check records a condition (Good/Worn/Damaged, damaged forced by any fail), as returns already do | Yes | Keep condition return-only |
| D51 | A blank enabled T&T reading blocks save (explicit N/A to skip) instead of passing | Yes | Keep live skip-as-pass |
| D52 | Next-due is derived from the asset interval; to change a date change the interval on the register | Yes | Keep the typed override |
| D53 | A T&T fail defaults the action to Removed from service (Undo available), replacing the blocking fail dialog | Yes | Default No action + dialog |
| D54 | The hub's `Send reminder` is `Chase` (copy text), because Flow never emails clients | Chase = copy follow-up, no sending | Add an email-sending reminder (reverses #934 decision 7) |
| D55 | Quotes / Invoices as a words-switch with their own strips instead of stacked sections | Words-switch | Stack both lists |
| D56 | Overdue outranks Part paid when past due | Overdue wins | Keep the job tab's Part-paid-first order |
| D57 | Settings index replaces the settings rail and phone jump-select; `/settings` becomes the index and General moves to `/settings/general` | Yes | Keep the rail |
| D58 | Roles editable per org (overrides of the built-in roles; Owner fixed, Admin keeps permission-fixing actions) — today roles are code constants | Read-only grid now, edit behind a flag later | Grid read-only permanently |
| D59 | Add `Resend invite` and invite Undo (re-issue) | Yes | Revoke + re-invite only |
| D60 | Move invoice numbering and default tax rate from General to Billing | Yes | Leave on General |
| D61 | Kill switch moves to a Danger zone group | Yes | Stay on API keys |
| D62 | Every `/new` and `/[id]/edit` form route becomes a sheet over its list/record (deep links kept) | Yes | Keep full-page forms |
| D63 | Bulk stock is created from the asset sheet's `Serialised unit · Bulk stock` words | Yes | Separate entry point |
| D64 | Service schedule stays a small dialog | Yes — five fields, one decision | Make it a sheet |
| D65 | Bottom nav and More sheet exactly as 6d.6 (supersedes D1's open details: gating, raise, drill-down) | Yes | Five items + floating Scan (6d.7) |
| D66 | Sidebar "Dashboard" is named **Home** everywhere | Yes — the bottom nav, the prototype and the page already say Home | Keep Dashboard |
| D67 | Tablet rail is automatic at ≤ 1023 and manual at any width (⌘B, remembered); sub-pages show only under the active module | Yes | Always-inline sub rows |
| D68 | One phone breakpoint constant: 859 (prototypes) replaces 768 (`use-mobile.ts`) | Yes — a 768 iPad portrait gets the phone layout, tables need 860+ | Keep 768 and add a tablet layout |
| D69 | Theme moves into the user menu (reachable on phone); org switcher moves to the sidebar head | Yes | Keep both in the avatar menu |
| D70 | Bell and Home › Notifications read one feed | Yes | Keep mentions-only bell |
| D71 | Order gets a derived `On hire`/`Returned` state and a stored return date; Mark returned and Extend hire verbs | Yes | Keep Received as the only word |
| D72 | Crew Documents with expiry dates drive an Overview health row | Yes | Keep licences in notes |
| D73 | Client Merge ships with undo and a named list of what moves | Yes | Archive only |
| D74 | Supplier and crew keep Delete but behind Archive/Inactive; supplier delete gated while orders exist | Yes | Remove Delete |
| D75 | Kit status derived from contents (Incomplete/Reserved/Available), not a stored `INCOMPLETE` | Derive; drop the status select from the kit sheet | Keep stored status |
| D76 | Maintenance parts become rows (name, supplier, qty, price, ETA, on order/arrived); cost = parts + labour, never stored | Rows + derived cost | Keep `partsUsed` text and `cost` number |
| D77 | Category default T&T profile (class + interval) inherited by models | Add, model can override | Keep per-model only |
| D78 | Location capacity and bin labels (`cap`, printed state) as real fields | Add | Keep locations free of capacity |
| D79 | Notes tabs dropped on location/kit/job/T&T; notes are History entries | Drop | Keep a Notes tab |
| D80 | T&T record gets a real Edit sheet (live Edit is disabled) | Add | Keep read-only |
| D81 | Schedule gains a Gear view (free count per model per day, shortfalls as flag-words) beside Jobs | Yes — the page's own promise is "gear is committed" | Jobs only; gear stays in Overbookings |
| D82 | Agenda is removed on desktop; phone day mode is the agenda | Yes — the day sheet and day chips cover it | Keep Agenda as a third word |
| D83 | Month is a real calendar month (30 slim columns), not six weeks | Yes — bars stay one row each | Keep the six-week grid |
| D84 | Pencilled jobs show `would clash` (amber) and Confirm runs the heads-up gate from the Schedule | Yes — same gate as the job page | Gate only on the job page |

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
