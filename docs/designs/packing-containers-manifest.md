# Packing, Containers & Client Manifest — research + design

**Status**: DRAFT — research only, nothing implemented. Decisions are in §6.1; the remaining small questions have defaults in §6.2.
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
  description?        -- optional free text on the box ("Cables + power", "Client's own case"), printed on the manifest (D6)
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
- Container membership of a **kit** defaults to the kit parent's unit; children inherit. A kit
  child packed elsewhere (spare lamp in a different case) is a per-child override made at pack
  time, never required up front (decision D3). Display: the kit lists under its container with a
  `(2 members in Tub 3)` note, and each stray member lists under ITS container with a `(from Lighting
  Kit)` note — the same unit never prints twice.
- A container's own unit (the case asset) may itself have `containerId` (nesting, decision D1).
  Depth is unbounded in the model; the documents indent one level per nesting and the summary
  counts only top-level containers.

**Plan vs actual (decision D9 — packing is planned by the PM AND done in the warehouse).** A PM can
create containers and assign lines to them on the project page before any unit exists. That plan
lives on the LINE as `projectLineItems.plannedContainerId?` (whole line → one container; splits are
a warehouse-time act). At prep, `prepUnit` defaults the unit's `containerId` to the line's planned
container when the operator has no container active, and the operator's active container wins when
they do. The two fields answer different questions (intent vs reality), the same way `quantity` and
`packedQuantity` do — not a second copy of one fact. The Packing tab (§5.5) shows both: planned in
muted text until a unit lands, then actual.

Migration: backfill `containerId` from existing `prepContainer` labels (unit first, line as
fallback), creating one `CUSTOM` container per distinct label per project, upgrading to `ASSET`
where a `isContainerLineItem` line with that label exists. Then drop both string fields
(widen → migrate → narrow, `convex-migration-helper`).

### 3.4 The container's line item (what the client sees on the job)

Every container has exactly one line item (`lineItemId`), created with the container:

- **ASSET** → `type: "EQUIPMENT"`, `modelId`/`assetId` from the asset, qty 1.
- **BULK_ASSET** → same shape with `bulkAssetId`, qty 1 per container. (Kind kept in the schema
  from day one; the picker for it is deferred — decision D2.)
- **CUSTOM** → `type: "EQUIPMENT"` + `isCustomItem: true` (what the equipment tab already renders
  with the `Custom` badge — `equipment-rows.tsx:1405`), description = label.

**Containers are never billed lines (decision D5).** All three kinds are unpriced (`unitPrice`
unset, the `"—"` state, never `$0`), excluded from quote/invoice/recalc/allocation/ROI, and shown
only on the job (equipment tab, Packing tab) and on warehouse + manifest documents. A case the
client IS charged for is an ordinary priced line the PM adds, unrelated to packing — the same
Pelican can be both, and the two rows mean different things.

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

**Deploy by container (decision D4)** is offered, not forced: scanning a container's tag on the
Prepped tab (or "Deploy container" on its header) opens the same verify-then-confirm flow kits use
today (`kitConfirm` → "Deploy verified only" / "Deploy all", FEATUREDOCS/12 "Partial Deploy") over
the container's member units. Nested containers are members too and expand in the same dialog. No
seal/unseal ceremony. The operator can still deploy individual units from inside a container as now.

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

Structure — one continuous list (decision D8), no page break per container; nested containers
indent one level under their parent and the summary counts top-level containers only:

```
MANIFEST                                   PRJ-2026-0142 · Summit Conference — Main Stage AV
Client / delivery address / site contact   Delivered 10 Sep 2026 · Return due 14 Sep 2026
Summary: 3 containers · 47 items · 212 kg · 2 loose items

■ Road Case 12  (CASE012)            contents: 18 items
   Cables + stage power
   Lighting
     4 × Par Can ............................ PC-0021, PC-0022, PC-0034, PC-0040
     1 × DMX Controller ..................... DMX-003
   [Kit] Lighting Kit (KIT-001) — 3 items
     ...
■ Tub 3  (TUB · 1 of 20)
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
tag, kind, item count, the optional description on its own line, and weight if every member model
has one. A container is just a box: there is no on-site destination field (D6).

Data shape: `structureLineItems` gets a third mode, `byContainer`, that buckets by
`unit.containerId` FIRST and by category/kit second, emitting a container header row
(`isContainerRow: true`, tag/kind/description/count on it) — a new synthetic row type, so the
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
   `#`, Item, Qty, Asset tag(s). **No per-row Received column** (D7: the customer signs for the
   delivery as a whole at the bottom, so per-item boxes are redundant, and the pre-ticked ones were
   the confusing part). One row per line, tags inline, **no per-unit sub-rows**. Kit prints its own
   row (with its case tag) and its members indented. Group: parent row + disclosed members. `#`
   numbers every printed parent row consecutively.
6. **Condition on receipt / discrepancies**: a ruled box, three lines.
7. **Signatures**: Delivered by (name, signature, date/time) | Received by (name, company,
   signature, date/time). One rule each. Drop the duplicated "Signature" sub-line.
8. **Footer**: existing.

Scope decided (D7): the docket stays **itemised**, like today, in container order, with ONE
signature block for the whole delivery. It is not reduced to a container-count summary.

### 4.3 Pull slip and return sheet

- Pull slip is a picking worksheet; it stays category/location-sorted. Add an optional "Pack into"
  column blank for hand-writing? Only if packers plan boxes on paper — Q13.
- Return sheet uses container order too (the container each unit LEFT in — return-side
  re-tracking is out, decision D10) with a per-container "case returned ☐" row. Same `byContainer`
  mode, expand.

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
   operator skill (`.claude/skills/rvlt-flow`), FEATUREDOCS/13, /32 (rewrite), /12, /69 (new tab),
   glossary.

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
  custom label; optional description. Adding creates the container + its line item immediately
  (server-owned, so it appears on the equipment tab right away).
- Each prepped row shows a small container chip (`Container` icon + label) inline, replacing
  nothing else.

### 5.2 Prepped (Deploy) tab: containers are the unit of work

- Keep the sectioned table, but the section header becomes a **container card header**: label, tag,
  kind badge (Case / Tub / Custom), description, `n items`, and actions: **Deploy container**,
  **Move…**, **Rename / describe**, **Unpack** (contents → Loose; replaces the X-clear).
- Row-level **Move to…** (single/multi-select) → picker of this job's containers + "Loose". This is
  the missing operation behind defect 7.
- "No container" stays last and is renamed **Loose**.
- De-prep/Return tabs keep the same headers read-only (what came back in what).

### 5.3 Container sheet (detail)

Opened from a header or the equipment tab: contents grouped by category, weight, description,
print label, print packing slip (this container only). Also lists **where a unit
went** if it left the container (moved/returned).

### 5.4 Labels

Per-container A6/thermal label: job number + name, container label + tag + QR (the existing
`barcodeLabelTemplate` machinery on models can be reused; QR encodes the container id or asset tag —
Q14), description, `n items`, "1 of 3". Print from the container sheet or "Print all labels" on the
Prepped tab. pdfme or react-pdf: react-pdf, since it's the pipeline with automatic layout.

### 5.5 Project → a Packing tab (its own tab, not a view inside Equipment)

A new project tab, **Packing**, next to Equipment (decision D11: separate from equipment
planning). Equipment stays the place gear is added, priced and categorised; Packing only decides
where it travels. Adding a tab means adding it to `VALID_TABS` in
`src/app/(app)/projects/[id]/page.tsx` (CLAUDE.md; FEATUREDOCS/69) so `?tab=packing` deep-links
resolve, and the Overview readiness checklist gets a row ("3 lines not planned") that navigates
here the way the other checks do.

Contents: an editable tree container → category → line, with a dashed **Not planned** bucket last
and a "not planned" count chip in the toolbar. The PM creates containers here and drags lines into
them before the warehouse starts (decision D9: planning happens here, packing happens in the
warehouse; §3.3 "plan vs actual"). Drag reuses the equipment tab's existing dnd-kit container map
pattern (FEATUREDOCS/47 `buildContainerMap`) with containers as a new drop-target kind. Same
`structureLineItems` `byContainer` output the manifest uses, so the screen and the PDF cannot
disagree (R-3.1). Planned membership prints in muted italic until a unit lands, then the row shows
the green `Packed` pill with the actual container. On the Equipment tab itself, container line
items render with a **Container** badge (today they render as plain gear with no marker) and a line
that has a plan shows a small container chip — read-only there, edited on Packing.

### 5.6 Mobile

The rail is a horizontal scroller above the scan box; the active chip is sticky with the scan
field (which is already `sticky` in the dialog). Move-to is a bottom sheet. Nothing here needs new
primitives beyond `Sheet`/`Popover` (Radix; `asChild`).

## 6. Decisions and open questions

### 6.1 Decided (Jayden, 2026-09-27)

Numbered by the question list in the PR thread.

| # | Question | Decision | Consequence in this doc |
|---|---|---|---|
| D1 | Nesting | **Yes, required.** | `parentContainerId` in v1; documents indent per level; summaries count top-level containers (§3.2, §4.1). |
| D2 | Bulk tubs (untagged cases) | **Not yet; being considered.** | `BULK_ASSET` kind stays in the schema so it is additive later; no picker built in phase 1 (§3.4). |
| D3 | Kit members across boxes | **Can be split, but never required up front.** | Default = whole kit in its container; per-child override at pack time (§3.3). |
| D4 | Deploy by container | **An option, with the kit-style verification.** | Scan a case / "Deploy container" → the existing verify → "Deploy verified only / Deploy all" dialog over member units (§3.5). No sealing. |
| D5 | Custom containers on the job | **Warehouse + manifest only.** | Containers of every kind are unpriced and never on quote/invoice (§3.4). |
| D6 | "Where it goes" | **A box is just a box — no on-site destination.** Optional free-text description per container instead. | `projectContainers.description?` printed under the container header on the manifest; no destination field anywhere (§3.2, §4.1, §5). |
| D7 | What the customer signs on the docket | **The docket as a whole, one signature at the bottom, like now.** | Itemised rows in container order, no per-row Received column, single signature block (§4.2). |
| D8 | Manifest granularity | **Continuous list.** | No page break per container (§4.1). |
| D9 | When packing is decided | **Both** — PM plans on the project page, warehouse packs. | `plannedContainerId` on the line (plan) + `containerId` on the unit (actual); editable Packing tab (§3.3, §5.5). |
| D11 | Where planning lives on the project page | **Its own Packing tab**, not a view toggle inside Equipment. | New `VALID_TABS` entry; Overview readiness row links to it (§5.5). |
| D10 | Return-side container tracking | **Not worth the effort.** | Return sheet groups by the container gear LEFT in (read-only); no "came back in the wrong case" (§4.3). |

### 6.2 Still open (smaller, can be defaulted)

| # | Question | Default if unanswered |
|---|---|---|
| Q7 | Split one TAGGED bulk asset (100 × XLR under one tag) across two tubs? | No — whole tagged quantity in one tub; untagged bulk splits freely. |
| Q8 | Loose (unpacked) gear on the manifest: legitimate section, or flag "3 items not packed" before printing? | Legitimate "Loose" section, plus a non-blocking warning chip on the Packing tab. |
| Q10 | Tick boxes on the manifest, or reference only? | Reference only — tags inline, no boxes; the docket is the sign-off. |
| Q11 | Client PO / order reference printed on docket + manifest? | Not in v1; nothing on `projects` holds one. |
| Q13 | Pull slip: keep as-is, or add a "planned container" column now that plans exist pre-prep? | Add the planned container as a muted note per row when set; no layout change otherwise. |
| Q14 | Printed container labels (QR + job + count) in this program or later? | Later (phase 4). |
| Q16 | Container added on a locked (`CONFIRMED`+) job: allowed as an unpriced structural add? | Yes — same allowance as `unplanned` lines; containers are never priced (D5) so no money gate applies. |

## 7. Phasing

The execution order, per-phase checklists, acceptance criteria and gates live in the companion
[`packing-containers-build-plan.md`](./packing-containers-build-plan.md). In one line: pin the
defects (0) → model + backfill with the string fields still readable (1) → warehouse UI (2) and
documents (3) in parallel → Packing tab (4) → narrow and retire the string fields (5) → labels and
bulk tubs later (6).

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
