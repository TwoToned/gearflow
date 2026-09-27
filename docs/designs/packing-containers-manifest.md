# Packing, Containers & Client Manifest — research + design

**Status**: DRAFT — research only, nothing implemented. Open questions in §6 need answers before this becomes a plan.
**Owner**: Jayden
**Date**: 2026-09-27
**Branch**: `claude/sweet-noether-k2zb8t`
**Related**: [FEATUREDOCS/32 (prep containers)](../../FEATUREDOCS/32-preps.md), [FEATUREDOCS/12 (warehouse)](../../FEATUREDOCS/12-warehouse.md), [FEATUREDOCS/13 (PDFs)](../../FEATUREDOCS/13-pdfs.md), [archive/pick-list-delivery-docket-grouping.md](./archive/pick-list-delivery-docket-grouping.md)

## 0. TL;DR

Prep containers today are a **string label on a line item** (`projectLineItems.prepContainer`), plus a
hidden auto-added line item for the case asset (`isContainerLineItem`). The label is written to the
**unit** row for every serialised/bulk prep but read from the **line** row everywhere (warehouse tabs,
container roll-up, PDFs), so the feature only works end to end for single-quantity untagged lines.
On PDFs the label never prints at all: `structureLineItems` stamps a category `groupName` on every
row and the table buckets by `groupName || prepContainer`, so the category always wins.

Proposal: make a container a **first-class per-project entity** (`projectContainers`) with three
kinds (serialised case asset, tagged bulk tub, free-text custom), put membership on the **unit**
(`projectLineItemUnits.containerId`), keep the container's own line item as the one way it
appears on the job/docs, and add one new client-facing document — the **Manifest** — sorted
container → category/kit → item. The delivery docket gets a layout rework alongside it (§4.2).

## 1. What exists today (as built)

### 1.1 Data model

| Field | Table | Notes |
|---|---|---|
| `prepContainer?: string` | `projectLineItems` | Free-text label. The ONLY grouping key. No id, no kind, no link to the case asset except by coincidence of label text (`customName || assetTag`). |
| `prepContainer?: string` | `projectLineItemUnits` | Same label at unit level. Written by `prepUnit` (`convex/lib/fulfillment.ts:895-1015`) for serialised and bulk units. **Never read by anything.** |
| `isContainerLineItem?: boolean` | `projectLineItems` | Marks the auto-added line for a case ASSET. `type: "EQUIPMENT"`, qty 1, unpriced, `prepStatus: PACKED`, its own `prepContainer` = its label. |
| `prepKitCategoryId` | `orgSettings.settings` JSON | The one category subtree whose assets are offered as containers (`convex/categories.ts` `containerAssetSearch`). Name is a leftover from the retired "prep kit" system. |
| `kits.caseType / caseDimensions / weight` | `kits` | Case metadata exists on **kits**, not on models/assets. Not used by containers. |
| `models.weight` | `models` | Per-unit weight. `build-document-data.ts:680` sums it into `totalWeight` but no document prints it. |

There is no container entity, no nesting, no capacity, no label/QR, no "which truck".

### 1.2 Write paths

- **Prep into container** — the Pick/Prep tab holds `selectedContainer` (a string) and threads it into
  `prepItemDirect` / `prepItemsBatch` / `completeCheckAndPack` / `quickAddAndCheckOut`
  (`src/app/(app)/warehouse/[projectId]/page.tsx:630,804,833,1109`). All land in `prepUnit`.
- **Case asset auto-add** — `ensureContainerIfNeeded` (page.tsx:759) calls
  `warehouseWrites.ensureContainerOnProject` → `ensureContainerOnProjectCore`
  (`convex/warehouseOps.ts:1497`): idempotent on `(assetId, projectId, isContainerLineItem)`.
  Custom (typed) containers add **nothing** to the job.
- **Roll-up** — after every deploy/return the page collects the affected labels and calls
  `syncContainersBatch` (`warehouseOps.ts:1581`): if every non-container LINE with that label is
  `CHECKED_OUT` the container line + asset flip to `CHECKED_OUT`; if all `RETURNED`, back to
  `AVAILABLE`. Excluded from auto-status's "still in building" test (`projectAutoStatus.ts:221`),
  from allocation/ROI, and from the stage counter.
- **Clear** — `clearPrepContainer` (X on the header) strips the label off every LINE with it. Leaves
  the container line item on the job, still `PACKED`.
- **Move between containers** — no operation. Clear + re-prep is the only path.
- **Unit-level label** — `prepUnit` writes `prepContainer` on the unit row only (serialised: line
  `:913-917`; bulk: `:954-972`; untagged multi-qty: `:997`). Only the single-unit generic branch
  (`:1007`) touches the line. `syncLineItemRollup` (`fulfillment.ts:61-80`) lifts status/prepStatus/
  counters from units to the line and **not** `prepContainer`.

### 1.3 UI

- **Pick/Prep tab** — a `ComboboxPicker` (`creatable`, `allowClear`) beside the scan box
  (`pick-prep-tab.tsx:145-153`), options = case-category assets ∪ labels already on lines. A one-line
  "→ {container}" hint under it. That is the entire packing affordance.
- **Prepped (Deploy) / Return / De-prep tabs** — rows grouped under a `Package`-icon header per label,
  "No container" bucket last, X to clear (`deploy-tab.tsx:248-290`, mobile `ScanContainerHeading`).
  Serialised rows are keyed `model\0container` so one model split across two cases stays two groups
  (page.tsx:221-224).
- **Project equipment tab** — no packing view. Container line items are **not** filtered out there
  (`equipment-tab.tsx` / `equipment-rows.tsx` have no `isContainerLineItem` check; FEATUREDOCS/32's
  "hidden from equipment lists" claim is only true of the warehouse page, page.tsx:1616).
- **Settings → Assets → "Prep Containers"** — one category picker (`prepKitCategoryId`).

### 1.4 Documents

Five react-pdf doc types (`src/lib/react-pdf/*-document.tsx`), one shared table
(`components/line-items-table.tsx`). Grouping is `filterAndGroupItems` (`:160-225`):
`key = item.groupName || item.prepContainer || ungroupedKey`. Delivery docket additionally promotes a
kit's `CHECKED_OUT` children into a section named after the kit and **drops the kit parent row**.

`structureLineItems` (`src/lib/pdfme/structure-line-items.ts`) stamps `groupName` on every row it
emits (category name, `[Kit] X`, `Sub-Hire: …`, or the literal `"Uncategorized"`). Consequence:
**`prepContainer` is dead on every PDF** — FEATUREDOCS/32 §"PDF Documents" describes behaviour that
cannot occur. `total_items` / `totalWeight` are computed (`build-document-data.ts:662-684`) but only
`Total items` prints, and only on the pull slip.

### 1.5 Defects found (evidence-backed, not yet reproduced at runtime)

1. **Unit/line split (the "hardly works").** Serialised and tagged-bulk preps store the label on the
   unit; every reader (tab grouping, `syncContainersBatch`, `clearPrepContainer`, PDFs) reads the
   line. So a serialised asset prepped into "Case 12" shows under "No container", and the case never
   auto-deploys. Only untagged qty-1 lines behave as documented. All existing tests seed the label on
   the line directly (`warehouseWrites.test.ts:386-388`, `warehousePageBatch.test.ts:141-152`), which is
   why nothing catches it.
2. **Containers never print** (§1.4). Category bucket always wins.
3. **Custom containers leave no trace on the job.** A typed "Tub 3" is a label on some rows and
   nothing else — nothing to list, price, count, or hand the client.
4. **Identity by display string.** Two assets with the same `customName`, or a custom label that
   happens to equal an asset tag, merge. Renaming the asset orphans its rows.
5. **Container line item is `type: "EQUIPMENT"`, `status: CONFIRMED`, unpriced.** It sits on the job
   like ordered gear (visible on the equipment tab, counts as a plan line for versioning/reality
   carry-over) but was never quoted. Auto-status ignores it only because of a special case.
6. **Clear leaves a zombie.** Clearing a case's label leaves its line item `PACKED` on the job with
   no contents and no path to remove it from the warehouse UI.
7. **No move, no nesting, no partial.** A bulk line of 10 packed 6/4 across two tubs is representable
   at unit level (bulk units accumulate per `(line, bulkAsset)` — one unit per tagged bulk asset, so
   a split of ONE tagged bulk asset across two tubs is not) but nothing reads it.

## 2. The delivery docket today — rendered sample

Rendered from `fixture.ts` (`makeLongLineItemList(14)`, three ungrouped-with-container rows added)
via `DeliveryDocketDocument`; see the scratchpad PNGs referenced in the PR. What a customer gets:

- **Header** — org block left, "DELIVERY DOCKET" + project number + date right. Repeats per page. Fine.
- **Details row** — client block | project block (name, venue NAME only, rental + event date ranges,
  site contact). No **delivery address** (`venue_address` is in `DocumentData` and unused), no
  delivery date/time (`load_in_date`/`load_in_time` are in `DocumentData` and unused), no client PO
  or order reference, no delivered-by / vehicle.
- **Table** — `#`, Description, Qty, Asset Tag, Received☐. Sections are categories.
  - Every qty>1 row explodes into per-unit sub-rows with **pre-ticked** checkboxes
    (`checked={i < checkedOutQuantity}` — always true on a `CHECKED_OUT`-filtered doc). To a client
    that reads as "already received". Untagged units print as `Model 4 - 3`, which means nothing to
    them.
  - Kit sections drop the kit's own row, so the kit's case tag (`KIT-001`) never prints; the
    "Received" box is per child, never per case.
  - Group rows print a Received box on the parent AND on each disclosed member (double sign-off for
    the same gear).
  - Row numbers count parents only; gaps appear where kits/groups intervene.
  - Dates are `formatDate` output (fixture shows ISO); no locale check done here.
- **Signature block** — three columns, "Delivered by / Received by / Date", each with TWO rules and
  the labels "Name / Signature" then "Signature" (redundant). No printed name/company lines, no
  "condition on receipt / discrepancies" box, no item/container count to sign against.
- **Missing entirely** — totals line (N items, N containers), notes to the client
  (`crew_notes`/`client_notes` exist), T&Cs excerpt (return date, damage liability), page-2+ context
  (details row isn't `fixed`, so page 2 opens straight into table rows with no job identifier beyond
  the header's project number).

The bones (react-pdf, `fixed` header, `minPresenceAhead` on section headers, footer page X of Y) are
sound. It is the information design that is wrong for a customer-facing document.

## 3. Target model (proposal)

### 3.1 Vocabulary (add to `docs/glossary.md` when this ships)

| Term | Meaning |
|---|---|
| **Container** | Anything gear is packed INTO for a job: a road case, a tub, a pallet, a rack, a bag, a truck bay. Per-project, may or may not be an asset. |
| **Serialised container** | A container that IS an asset (case with a tag). Has its own status; goes CHECKED_OUT/RETURNED with the job. |
| **Bulk container** | A container drawn from a tagged bulk asset (20 identical tubs, tag `TUB`). Consumes 1 of that bulk asset's quantity. |
| **Custom container** | Free text ("Client's own flight case", "Loose — truck 2"). No asset. Still a real row with an id. |
| **Manifest** | Client-facing document: everything on site, container by container, then loose. |
| **Packing slip** | Internal, per-container version of the same data (what's in THIS box). Not a fourth name for the pull slip — see glossary rule. |

### 3.2 `projectContainers` (new table)

```
projectContainers
  id, organizationId, projectId, versionId, lineageId   -- same version scoping as line items (#1226)
  kind: "ASSET" | "BULK_ASSET" | "CUSTOM"
  assetId?            -- kind ASSET
  bulkAssetId?        -- kind BULK_ASSET
  label: string       -- display name; for ASSET defaults to customName || model name, editable
  lineItemId          -- the container's own line item on the job (see 3.4); 1:1
  parentContainerId?  -- nesting (a rack inside a case) — see Q3
  sortOrder
  destination?        -- free text ("Stage left", "FOH", "Truck 1") — see Q6
  notes?
  sealedAt?/sealedById?  -- optional "closed" marker — see Q4
  createdAt, updatedAt
indexes: by_cuid, by_organizationId, by_versionId, by_versionId_lineItemId, by_assetId, by_bulkAssetId
```

Identity is the id, never the label. `by_assetId` / `by_cuid` are global — every read org-checks
(CLAUDE.md IDOR rule; the ratchet will demand it).

### 3.3 Membership is per UNIT

`projectLineItemUnits.containerId?: string` replaces `projectLineItemUnits.prepContainer`. The line
keeps NO container field: a line's container set is derived (`distinct(unit.containerId)`), so
"6 in Tub 3, 4 in Tub 4" is one line, two containers, no split rows — matching the per-unit
fulfillment model (`docs/designs/archive/line-item-fulfillment-model.md`).

Rules:
- `prepUnit` takes `containerId` (not a label). Accessory units packed with a parent unit inherit
  its container (already the shape at `fulfillment.ts:931-941`).
- One tagged bulk asset = one unit row = one container. Splitting a single tagged bulk asset across
  two tubs needs a unit split; out of scope unless Q7 says otherwise. Untagged bulk already has one
  unit per packed piece, so it splits freely.
- Container membership of a **kit** is the kit parent's unit; children inherit for display. A kit
  child packed elsewhere (spare lamp in a different case) is a per-child override — see Q8.
- A container's own unit (the case asset) may itself have `containerId` (nesting).

Migration: backfill `containerId` from existing `prepContainer` labels (unit first, line as
fallback), creating one `CUSTOM` container per distinct label per project, upgrading to `ASSET`
where a `isContainerLineItem` line with that label exists. Then drop both string fields
(widen → migrate → narrow, `convex-migration-helper`).

### 3.4 The container's line item (what the client sees on the job)

Every container has exactly one line item (`lineItemId`), created with the container:

- **ASSET** → `type: "EQUIPMENT"`, `modelId` from the asset, qty 1, priced by the normal rate lookup
  IF the model has a rate (the `dailyRate != null || weeklyRate != null` guard, CLAUDE.md) — a
  Pelican that is charged is a real line; one that isn't stays `"—"`, never `$0`.
- **BULK_ASSET** → same, `bulkAssetId`, qty 1 per container (or one line with qty N for N tubs of
  the same bulk asset — see Q5).
- **CUSTOM** → `type: "MISC"` (or `EQUIPMENT` + `isCustomItem: true`, whichever the equipment tab
  already renders with the `Custom` badge — `equipment-rows.tsx:1405`), description = label,
  unpriced unless the operator prices it.

Keep `isContainerLineItem: true` on it so all existing exclusions (allocation, ROI, auto-status,
stage counts, PDF top-level filters) keep working unchanged, and add `containerId` on the line for
the reverse lookup. This is the "any container added in the warehouse also gets added onto the
job" requirement, made uniform across all three kinds.

Deleting a container: if it has contents → refuse (or move contents to "loose" behind a confirm);
if empty → delete container + its line item together (fixes defect 6). Lifecycle-lock aware: a
container added on a `CONFIRMED`+ job is an on-site structural add, same allowance `unplanned`
lines get.

### 3.5 Status rolls up from contents (keep the existing rule, fix its inputs)

`syncContainersBatch` stays conceptually: a container is `PACKED` when created, `CHECKED_OUT` when
every member unit is, `RETURNED` when every member unit is. Two changes: it keys by `containerId`
and reads UNITS (`by_containerId` index on units), and it runs from inside the checkout/return
mutation (one call at the end, like `maybeAutoAdvanceProjectStatus`) rather than from a
client-side `useEffect`-style follow-up call the page has to remember to make.

Open: should deploying a container deploy its contents (scan the case, everything inside goes out)?
That is the operator's expectation and the whole point of packing — see Q4.

### 3.6 What the settings surface becomes

`prepKitCategoryId` → `containerCategoryIds: string[]` (several categories: Cases, Tubs, Racks) and
a per-model `isContainer` flag as the precise source (`models.isContainer?: boolean`), category
being the bulk way to set it. The picker offers assets/bulk assets whose model is a container; the
"create custom" path stays.

## 4. Documents

### 4.1 Manifest (new doc type, client-facing)

`ProjectDocumentType` gains `"manifest"`. Live-rendered from today's state like the other three
warehouse docs (it describes what is physically on site now), served by `/api/documents/[projectId]
?type=manifest`, `project:read`. Not a finance doc, no stored-bytes rule.

Structure (one page-break per container is the likely default — see Q9):

```
MANIFEST                                   PRJ-2026-0142 · Summit Conference — Main Stage AV
Client / delivery address / site contact   Delivered 10 Sep 2026 · Return due 14 Sep 2026
Summary: 3 containers · 47 items · 212 kg · 2 loose items

■ Road Case 12  (CASE012)            destination: Stage left      contents: 18 items
   Lighting
     4 × Par Can ............................ PC-0021, PC-0022, PC-0034, PC-0040
     1 × DMX Controller ..................... DMX-003
   [Kit] Lighting Kit (KIT-001) — 3 items
     ...
■ Tub 3  (TUB · 1 of 20)             destination: FOH
   Audio
     12 × XLR 5m ............................ (bulk)
■ Client flight case (custom)
   ...
Loose (not in a container)
   Category → items

Signed: delivered by / received by / date / condition-on-receipt notes
```

Rows: description, qty, asset tags (inline list, not per-unit sub-rows — the client is checking
"is there a case here with these in it", not ticking serials), no checkboxes by default (Q10),
no prices. Section headers are containers; second-level headers are category (or kit) inside the
container — "sorted into containers, then categories/kits" as requested. Container header carries
tag, kind, destination, item count, and weight if every member model has one.

Data shape: `structureLineItems` gets a third mode, `byContainer`, that buckets by
`unit.containerId` FIRST and by category/kit second, emitting a container header row
(`isContainerRow: true`, tag/kind/destination/count on it) — a new synthetic row type, so the
CLAUDE.md synthetic-row rule applies: `filterAndGroupItems`'s status filter and the table renderer
both need the special case, plus a full-pipeline integration test.

### 4.2 Delivery docket rework

Keep it a **hand-over document** (what came off the truck, sign here), distinct from the manifest
(what's where). Proposed layout, top to bottom:

1. **Header** (fixed): org block; "Delivery docket"; project number; docket date. Sentence case, not
   the current all-caps `DELIVERY DOCKET` (DESIGN.md §5.2 bans uppercase in the app; §6 says PDF
   branding is deferred, so treat this as a docket-scoped exception or leave the title, but do not
   add more caps).
2. **Job strip** (fixed on every page, one line): `PRJ-2026-0142 · Summit Conference · Delivered
   10 Sep 2026 · Return due 14 Sep 2026`. Fixes the page-2 orphan problem.
3. **Parties row** (page 1): Deliver to (client, **delivery address** = venue address, site contact +
   phone) | From (org contact) | Reference (client PO / order ref if we have one — Q11).
4. **Summary line**: `3 containers · 47 items · 212 kg`.
5. **Table** in container order (same buckets as the manifest, so the two documents agree), columns
   `#`, Item, Qty, Asset tag(s), Received☐. One row per line, tags inline, **no per-unit sub-rows and
   no pre-ticked boxes**. Kit prints its own row (with its case tag) and its members indented; the
   Received box is on the kit row only. Group: one box on the parent. `#` numbers every printed
   parent row consecutively.
6. **Condition on receipt / discrepancies**: a ruled box, three lines.
7. **Signatures**: Delivered by (name, signature, date/time) | Received by (name, company,
   signature, date/time). One rule each. Drop the duplicated "Signature" sub-line.
8. **Footer**: existing.

Whether the docket lists individual items at all, or only containers + counts with the manifest as
the itemised companion, is Q12 — the answer changes 5 and the page count materially.

### 4.3 Pull slip and return sheet

- Pull slip is a picking worksheet; it stays category/location-sorted. Add an optional "Pack into"
  column blank for hand-writing? Only if packers plan boxes on paper — Q13.
- Return sheet should use container order too (what came back in which case is how warehouse
  actually unpacks) with a per-container "case returned ☐" row. Same `byContainer` mode, expand.

### 4.4 Consumer audit (CLAUDE.md PDF rule — every `DocumentLineItem` shape change)

1. `line-items-table.tsx` rendering (container header row style, indent levels, tags inline mode).
2. `filterAndGroupItems` status filter (container row must pass/fail by its contents, like
   `isGroupRow`).
3. `structure-line-items.ts` (new `byContainer` mode; `isContainerLineItem` exclusions now mean
   "don't list the case as GEAR inside itself", not "hide it").
4. `build-document-data.ts` totals (`total_items` must not double-count the case; `totalWeight`
   should include cases if their model has weight).
5. `regression.test.tsx` + a new full-pipeline test with a realistic packed fixture.
6. `document-layouts.ts` registry, the MCP `get_project_document` enum + prose, `api:docs`, the
   operator skill (`.claude/skills/rvlt-flow`), FEATUREDOCS/13, /32 (rewrite), /12, glossary.

## 5. UI / UX

### 5.1 Warehouse → Pick/Prep: "packing into" is a mode, not a dropdown

- Replace the 12rem combobox with a **container rail**: a horizontal strip (mobile) / right-hand
  column (desktop) of container chips for this job: `Road Case 12 · 18`, `Tub 3 · 12`, `+ New`.
  Exactly one is **active** (RVLT red outline, hard shadow per DESIGN.md); "Loose" is the
  always-present first chip. Scanning or "Prep selected" packs into the active chip. The current
  `→ {container}` hint becomes the active chip itself.
- **Scan a container to make it active.** A scanned tag that resolves to a container-model asset
  (or a `TUB` bulk tag) switches the active chip instead of erroring "not on this job". This is the
  operator's natural gesture: scan the case, scan what goes in it.
- `+ New` opens a small sheet (Radix `Sheet`, `asChild`): pick a case/tub asset (search), or type a
  custom label; optional destination. Adding creates the container + its line item immediately
  (server-owned, so it appears on the equipment tab right away).
- Each prepped row shows a small container chip (`Container` icon + label) inline, replacing
  nothing else.

### 5.2 Prepped (Deploy) tab: containers are the unit of work

- Keep the sectioned table, but the section header becomes a **container card header**: label, tag,
  kind badge (Case / Tub / Custom), destination, `n items`, and actions: **Deploy container**,
  **Move…**, **Rename/destination**, **Unpack** (contents → Loose; replaces the X-clear).
- Row-level **Move to…** (single/multi-select) → picker of this job's containers + "Loose". This is
  the missing operation behind defect 7.
- "No container" stays last and is renamed **Loose**.
- De-prep/Return tabs keep the same headers read-only (what came back in what).

### 5.3 Container sheet (detail)

Opened from a header or the equipment tab: contents grouped by category, weight, destination,
notes, seal status, print label, print packing slip (this container only). Also lists **where a unit
went** if it left the container (moved/returned).

### 5.4 Labels

Per-container A6/thermal label: job number + name, container label + tag + QR (the existing
`barcodeLabelTemplate` machinery on models can be reused; QR encodes the container id or asset tag —
Q14), destination, `n items`, "1 of 3". Print from the container sheet or "Print all labels" on the
Prepped tab. pdfme or react-pdf: react-pdf, since it's the pipeline with automatic layout.

### 5.5 Project → Equipment tab: a Packing view

A third view toggle (next to list/cards): **Packing** — read-only tree container → category → line,
with Loose last and a "not yet packed" count. Same `structureLineItems` `byContainer` output the
manifest uses, so the screen and the PDF cannot disagree (R-3.1). Container line items render with
a **Container** badge (today they render as plain gear with no marker).

### 5.6 Mobile

The rail is a horizontal scroller above the scan box; the active chip is sticky with the scan
field (which is already `sticky` in the dialog). Move-to is a bottom sheet. Nothing here needs new
primitives beyond `Sheet`/`Popover` (Radix; `asChild`).

## 6. Open questions (need answers before planning)

Model
1. **Nesting** — do you pack containers inside containers in practice (rack in a case, cases on a
   pallet), or is one level enough for v1? Nesting is cheap in the model (`parentContainerId`) but
   doubles the document-layout work.
2. **Bulk tubs** — are tubs/road cases without individual tags a real case for you (a `TUB` bulk
   asset with qty 20), or is every case you'd track already serialised? If bulk, is "Tub 3" the
   label the operator types, or auto `TUB · 1 of 20`?
3. **Kit members** — can a kit's members be packed in different containers, or is a kit always
   packed as one and its case IS the container? (Today `kits.caseType/caseDimensions` suggests the
   kit's own case is the box.)
4. **Deploy by container** — should scanning/deploying a container deploy everything inside it?
   And should a container be "sealable" (no more adds without unsealing) or is that ceremony?
5. **Custom containers on the job** — you said they get added "as custom items". Should a custom
   container be priceable (client's own case = $0, our loose hire tub = $5/day), and should it
   appear on the quote/invoice at all, or only on warehouse + manifest docs?
6. **Destination** — is "where it goes" a free-text field per container ("Stage left", "FOH"), a
   pick-list you maintain per org/venue, or derived from something that exists (crew roles? nothing
   today models rooms)? And does it belong on the manifest header per container or per item?
7. **Splitting one tagged bulk asset** — 100 × XLR under one `XLR-5M` bulk tag packed 60/40 across
   two tubs: needed, or edge case you'll accept as "whole tagged quantity goes in one tub"?
8. **Loose gear** — on the manifest, is "not in a container" a legitimate section (a lectern, a
   truss stick) or a defect you want flagged before printing ("3 items not packed")?

Documents
9. **Manifest granularity** — one page per container (doubles as a packing slip you can drop in the
   lid) or a continuous list? Both from one component is fine; which is the default?
10. **Tick boxes on the manifest** — does the client tick items off, or is the manifest reference
    only and the docket is the sign-off? (If reference only, no checkboxes, tags inline, far shorter.)
11. **References** — do clients send POs / order numbers you'd want printed on the docket and
    manifest? Nothing on `projects` holds one today (`projectNumber` is ours).
12. **Docket scope** — itemised (every line, as now, in container order) or container-level
    ("3 containers, 47 items, see manifest") with the manifest as the itemised companion? Your
    "coherent, presentable" ask reads as the second, but it changes what "Received ☐" means.
13. **Pull slip** — leave as-is (pick by location), or add a blank "pack into" column / a planned
    container column once packing plans exist pre-prep?
14. **Labels** — do you want printed container labels (QR + job + contents count) as part of this,
    or later?

Process
15. **When is packing decided** — only at prep in the warehouse (as today), or does the PM plan
    boxes on the project page before the warehouse starts? The latter means containers exist before
    any unit is packed and the Packing view is editable, not read-only.
16. **Lock tiers** — adding a container on a `CONFIRMED`/`AWAITING_PAYMENT` job is a structural add.
    Fine as an unpriced on-site add (like `unplanned`), or should a priced container need the unlock
    session like any other line?
17. **Return side** — do you want "returned in the wrong case" surfaced (unit came back in a
    different container than it left in), or is return-side container tracking not worth the scan
    friction?

## 7. Phasing (tentative, pending §6)

1. **Model + migration** — `projectContainers`, `units.containerId`, backfill, drop the strings,
   `syncContainers` on units, move/unpack/delete mutations, container line item for all kinds.
   Fixes defects 1, 3, 4, 5, 6, 7. Registry + agentOps + xtenant coverage come for free but need
   the `danger` classifications.
2. **Warehouse UI** — rail, scan-to-activate, container headers with actions, Move to.
3. **Manifest doc + docket rework** — `byContainer` structuring, new doc component, docket layout,
   MCP/docs/skill updates. Consumer audit (§4.4).
4. **Packing view + labels + return-side** — per answers to Q13–Q17.

## 8. Risks / gotchas to carry into the plan

- `by_assetId` on line items is global; `ensureContainerOnProjectCore` already scans it — the new
  `by_assetId` on containers must be org-checked in every reader (ratchet).
- Version scoping (#1226/#1228): containers are plan rows → `versionId`/`lineageId`, read through
  `versionRows`, never a `by_projectId`.
- A container line item must survive `versions.makeLiveNative` reality carry-over the way
  checked-out units do, or a new version silently drops the case that's physically on site.
- Synthetic container rows in the PDF pipeline are exactly the footgun CLAUDE.md warns about
  (`status: "CONFIRMED"` hard-coded on a synthetic row fails every status filter) — derive from
  members.
- `total_items` and `totalWeight` must decide whether cases count; the manifest summary prints both.
- Helvetica only in PDFs: no `■`/`—`; use ASCII in the manifest (`-`, `|`).
