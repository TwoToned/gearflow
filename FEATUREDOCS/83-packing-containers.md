# Packing containers — the container model, warehouse rewire, and document rework

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-27 (review quarterly — POLICY.md R-5.5)_

Design: [`docs/designs/packing-containers-manifest.md`](../docs/designs/packing-containers-manifest.md)
(decisions D1–D9) and the build plan
[`docs/designs/packing-containers-build-plan.md`](../docs/designs/packing-containers-build-plan.md)
(phases 0, 1a–1d, 2, 3a–3c, 4, 5, 6-deferred). Tracking: gearflow#1296
(sub-issues #1297–#1302, one per phase).

## The two defects this replaces

The pre-#1296 "prep container" system stored packing state as a free-text label
(`projectLineItems.prepContainer`) on the **line item**, not the physical unit:

1. **Unit/line split** — a multi-quantity line partially packed into two different
   cases had no way to record "6 in Tub 3, 4 in Tub 4"; the label lived on the
   whole line.
2. **Containers never printed** — `structureLineItems` always stamped a truthy
   `groupName` (category, or `[Kit] <name>`, or "Uncategorized"), so the
   downstream table's `item.groupName || item.prepContainer` bucketing never
   fell through to `prepContainer` — two items packed into the same case, from
   different categories, never surfaced as one section on any document.

Both are pinned as regression tests: `convex/prepContainer.repro.test.ts` (defect
1) and `src/lib/pdfme/container-grouping.repro.test.ts` (defect 2).

## The model (phase 1, #1298)

`projectContainers` (schema.ts) is a first-class, version-scoped table:
`kind: "ASSET" | "BULK_ASSET" | "CUSTOM"`, `label`, `description`,
`parentContainerId` (nesting), `lineItemId` (its own generated line item — a
container is a real `projectLineItems` row so it can itself be
checked-out/returned/serialised), `sortOrder`. **Containers are never priced**
(D5) — no lock/money gate anywhere in `projectContainersWrites.ts`.

Membership lives on the **unit**: `projectLineItemUnits.containerId` (indexed
`by_containerId`) is "this unit is physically packed inside container X."
`projectLineItems.containerId` is a **reverse lookup only** — set exclusively on
a container's own line item, never on a line packed inside one (that would
collide with the reverse meaning). `projectLineItems.plannedContainerId` is the
PM's Packing-tab intent (D9, phase 4) — separate from physical placement.
Nesting is `parentContainerId`, walked and cycle-checked in
`projectContainersWrites.ts`'s `assertNoParentCycle`.

**Widen → migrate → narrow**: the legacy `prepContainer` string field stays
readable (and is kept in sync by `createNative`/`updateNative` as a label
fallback) until phase 5's narrow step retires it.

Mutations (`convex/projectContainersWrites.ts`): `createNative`, `updateNative`
(rename/re-describe/re-nest), `deleteNative` (blocked while non-empty —
`NOT_EMPTY`), `moveUnitsNative` (batch move/unpack in one atomic write — the
missing operation behind defect 1), `unpackNative` (empty to Loose),
`setPlannedContainerNative` (Packing tab, phase 4). Reads: `projectContainers.ts`'s
`listForProject`.

### Checkout/return rewire (phase 1c)

`convex/lib/fulfillment.ts`'s `prepUnit` stamps `containerId` instead of a
label. `syncContainerStatuses` (server-side roll-up, called from
`warehouseOps.ts`'s checkout/check-in/kit paths via `syncContainersForLines`)
flips a container's own line item to CHECKED_OUT/RETURNED once **every** live
member unit agrees — split into `loadContainerFlipContext` /
`resolveContainerFlipStatus` / `flipForContainer` to keep each helper's
branching under the complexity ratchet (R-3.6). CANCELLED units (tombstones)
never block the "all agree" verdict.

### Version graph + reality carry (phase 1c)

`projectContainers` is in `VERSIONED_PLAN_TABLES` (`convex/lib/versionGraph.ts`);
its `lineItemId`/`parentContainerId` FKs, and `projectLineItems.containerId`/
`plannedContainerId`, are rewritten through the clone's old-id→new-id map
(`IN_CLONE_SET_FK_FIELDS`) so a new version's cloned containers point at the
new version's line items, not the old one's. `versionReality.ts`'s
`carryRealityByLineage` treats a **deployed container with zero units of its
own** as real (a container never itself packed into an outer box still counts
as physically out), and remaps a carried unit's stale `containerId` to the
incoming version's cloned container by lineage (`incomingContainerIdFor`).

### Backfill (phase 1d)

`convex/backfillProjectContainers.ts` — paginated (`.paginate()`), two passes:
one materialising a `projectContainers` row + line item per distinct legacy
`prepContainer` label per project, one repointing existing units'
`containerId`. Driver: `scripts/convex-backfill-project-containers.ts`. Never
run automatically — a one-time, explicitly-invoked migration.

## Documents (phase 3a, 3b, 3c landed — #1300)

`src/lib/pdfme/structure-line-items-by-container.ts`'s
`structureLineItemsByContainer` (opted into via `structureLineItems`'s
`StructureOptions.byContainer`) sorts a project's gear into containers first
(top-level, then nested with `containerDepth`), sub-sorted by category/kit
inside each, "Loose" bucket last. It reuses the existing flat `groupName`
section mechanism rather than inventing a second nesting model: every row in
one top-level container's section shares that container's label as
`groupName`. A container header's `status` is **derived** from its members
(CLAUDE.md's synthetic-row rule) via `deriveContainerStatus`, never hard-coded.
A kit parent / Project Group moves as **one row** (D3's default — a stray kit
member packed elsewhere is a documented simplification, not yet split out). An
ordinary line whose own units genuinely split across containers **does** split
into one row per container (defect 1's "6 in Tub 3, 4 in Tub 4" case).
`filterAndGroupItems` (line-items-table.tsx) passes a container header's
status filter iff any real row sharing its section passes.

**The Manifest** (`DocumentType: "manifest"`, `src/lib/react-pdf/
manifest-document.tsx`) is the client-facing document this whole structuring
mode was built for: one continuous list (D8, no page break per container),
reference only — no checkboxes (Q10), no prices (a container is a box, never
priced, D6). `src/lib/pdfme/container-data-for-documents.ts` loads a
project's `projectContainers` and resolves each ASSET/BULK_ASSET container's
own tag in two batched lookups (never a point-read per container);
`build-document-data.ts` threads `byContainer`/`containers` through to
`structureLineItems` and computes `container_count`/`nested_container_count`/
`loose_item_count` for the summary line, excluding the new `isContainerRow`
synthetic rows from `total_items`/`total_weight` the same way a container's
own line item already was. `line-items-table.tsx`'s new `ContainerHeaderRow`
renders each `isContainerRow` entry (indented by `containerDepth`); the
generic `GroupHeaderRow` is suppressed for a section whose own top-level
container row already carries the title — decided per-section from the DATA
(does this group contain a depth-0 `isContainerRow`?), not a static per-doc
flag, so the existing "a group header prints exactly once" regression
invariant keeps holding for every other doc type unchanged. Reachable via the
project page's Documents ▾ menu, `/api/documents/[projectId]?type=manifest`
(`project:read`, always freshly rendered — no stored-bytes rule, matching the
other 3 warehouse docs), and the `get_project_document` MCP tool.

**Return sheet and delivery docket** (`DOCUMENT_LAYOUTS`'s `byContainer: true`
now set for all three of manifest/return-sheet/delivery-docket — every other
doc type stays `false`/absent) both order by the same container buckets so
all three documents agree (D7/D10). Return-sheet adds a per-top-level-
container "Case returned ☐" (`ContainerHeaderRow`'s `showReturnCheckbox` prop,
`TablePluginConfig.showContainerReturnCheckbox`, depth-0 only — a nested tub
returns with its parent case, D10). Delivery-docket dropped its older
"promote a kit's CHECKED_OUT children into their own section, drop the kit
row" special case (`filterAndGroupItems`'s former delivery-docket branch) —
D7 wants the client to see the kit's own case tag, so a kit is now grouped and
rendered exactly like every other row (own row, CHECKED_OUT children indented
below via the ordinary `showKitChildren`/`ChildrenBlock` path). D7 also drops
the per-row "Received" checkbox column entirely (one signature covers the
whole delivery — a pre-ticked box per line on a CHECKED_OUT-filtered doc read
as "already received") and the per-unit checkbox sub-rows
(`showPerUnitCheckboxes: false`); a multi-unit line's asset tags print inline
via the existing `getAssetTag` dedupe/"+N more" text instead. The docket also
gets a sentence-case title ("Delivery docket", a deliberate docket-scoped
exception to the fixed-vocabulary ALL-CAPS titles every other doc type uses)
and the same container/item/weight summary line as the manifest
(`components/summary-line.tsx`, factored out of `manifest-document.tsx` so
both doc types share one `buildSummaryLine`, not two copies).

Still open (3c, deliberately deferred to its own pass): the docket's
remaining cosmetic layout rework from the design doc §4.2 — a fixed
"job strip" repeating the project number/delivered/return-due dates on every
page, a parties row with the actual delivery address (`venue_address`) and
client PO/order reference (Q11, itself deferred), and a ruled
"condition on receipt / discrepancies" box above the signature block. None of
these are behavioral (D7's itemised-with-one-signature scope is fully landed
above); they're presentational additions layered onto the existing
`DetailsRow`/`Header`/`Footer` primitives and were left out of this pass to
keep it reviewable and to avoid touching those shared primitives' several
other doc-type consumers without dedicated coverage.

## Container & kit labels

A small label to print and tape to each case, so what is inside is obvious
without opening it. `DocumentType`s `"container-label"` and `"kit-label"`
(`src/lib/react-pdf/container-label-document.tsx`), reachable from the Documents menu on the project page and on the
warehouse page ("Container labels", "Kit labels") or
`/api/documents/[projectId]?type=container-label|kit-label`. Add
`&labelId=<container id | kit line item id>` to print just one.

- **One case at a time.** On the warehouse page, Container labels is a submenu: "All containers" or any single container by name (`labelId`). Ad hoc (CUSTOM) containers are ordinary `projectContainers` rows, so they appear and print the same way, just with no asset tag.
- **Layout.** Docket styling (org colour title, tinted contents band), full page
  width so contents run in two columns: wider rather than taller. Header carries
  client, project and rental/event dates. No QR code, no "packed by".
- **Data.** `src/lib/pdfme/container-labels.ts` is pure and runs on the rows
  `structureLineItemsByContainer` already produced (`byContainer: true` in
  `DOCUMENT_LAYOUTS`). That step now stamps `containerId` on every placed row
  and `containerParentId` on container headers; the label builder relies on both.
- **Accessories** print as `+ 8x Name`, quantity only, **never an asset tag**.
- **Accessory in a different case than its parent.** Membership is per unit, so
  the label reads the ACCESSORY child's own units. Only the case it is physically
  in lists it ("accessory of <parent>, packed in <parent's case>"); the parent's
  label does not mention it at all (no "to <case>" pointer). Units unpacked or in the parent's own case stay under the
  parent. An accessory counts once, in the case it physically sits in. (KIT
  children still move with the kit, per D3.)
- **Kits** are not containers, so a kit label is its own document: one per kit
  line on the job (a kit parent), titled with the kit's name and asset tag,
  listing members with their tags and noting the case it is packed in.
- **Nested cases** appear as a line inside the case they are packed in.
- Bulk lines show quantity only (no tag). A label too tall for a page is allowed
  to break across pages; otherwise each label is kept whole.
- Not done: a per-chip "Print label" button on the warehouse container rail
  (use `labelId` meanwhile), and the agent/API document types
  (`AGENT_DOCUMENT_TYPES`).

## Warehouse UI (phase 2, #1299 — in progress)

Landed so far:

- **`models.isContainer`** (schema + `src/lib/validations/model.ts` +
  `convex/modelWrites.ts`/`models.ts` CRUD + the model form's toggle) — a model
  can be flagged as a container regardless of which category it sits in.
  OR'd with category membership, never a replacement for it.
- **Settings → Assets → Containers**: `containerCategoryIds: string[]`
  (`src/lib/org-settings-types.ts`) replaces the singular `prepKitCategoryId`
  (kept readable as a fallback until phase 5) — a multi-select
  (`MultiComboboxPicker`) over several category trees, not just one.
- **`convex/categories.ts`'s `containerAssetSearch`** now unions every
  configured container category's descendants with any model flagged
  `isContainer`, and returns each candidate asset's current `available`
  (status === "AVAILABLE").
- **Equipment tab**: `equipment-row-descriptors.ts` gains `source: "container"`
  (a container's own line item — takes priority over `custom`/`sale`) and
  `hasContainerChip()` (an ordinary line with a `plannedContainerId` or any
  unit's `containerId` set). The Equipment tab renders a **Container** badge
  and makes the container's own line's price cell permanently read-only (D5),
  independent of the project's lock state.
- **Container rail** (`src/components/warehouse/container-rail.tsx`) replaces
  `pick-prep-tab.tsx`'s free-text/creatable `ComboboxPicker` — real chips
  driven by `projectContainers.listForProject` ("Loose" first, dashed; one
  chip per container with its live unit count; exactly one active; "+ New").
- **New container sheet** (`new-container-sheet.tsx`): asset search via
  `containerAssetSearch`, a Custom tab, a "Packed inside" parent picker.
  Bulk-tub containers render disabled ("later", D2 — deferred).
- `page.tsx` threads a real `activeContainerId` alongside the legacy
  `selectedContainer` label at every prep call site
  (`prepItemsBatch`/`prepItemDirect`/`completeCheckAndPack`), so prepping
  through the rail actually writes `projectLineItemUnits.containerId` — not
  just the display label. `quickAddAndCheckOut` (add-and-prep-in-one-step for
  an asset not yet on the job) is a **documented gap**: `quickAddCore` inserts
  a bare line item with no unit row, so there's nothing to stamp a
  `containerId` onto at that exact step — the very next prep action on that
  same line does get the real container.

- **Scan-to-activate**: `projectContainers.listForProject` now resolves each
  container's own asset/bulk-asset tag (`tag: string | null`, batched lookup —
  same shape as `assets.listByIds`, bounded by container count, never a
  point-read per container). The pick/prep scan bar (`handleScanKeyDown`)
  matches the scanned tag against `realContainers` BEFORE calling
  `lookupAssetForScan`: a match switches the active rail chip
  (`handleSelectContainer`) and plays "info" feedback instead of running the
  normal prep flow, which would otherwise either try to re-prep the
  container's own line item or report it as unassigned.

- **Deploy/Return/De-prep sectioning by real containerId**
  (`warehouse-types.ts`'s `resolveItemContainerId`/`buildContainerGroups`,
  wired into `page.tsx`'s `deployContainerGroups`/`returnContainerGroups`/
  `deprepContainerGroups`): each section's identity is now the MAJORITY
  `containerId` among an item's own units (falling back to the legacy
  `prepContainer` string only when no unit carries one yet), resolved to the
  container's current label via `projectContainers.listForProject`. Two
  units in the same real container never split into two sections just
  because their `prepContainer` strings happened to differ or one was never
  backfilled — the display-level version of the same unit/line-split defect
  D9's migration exists to close.

  **Known narrow gap, deliberately not fixed here**: each section's "Remove
  container" button still calls the legacy `clearPrepContainer` mutation,
  which clears by STRING match on `prepContainer` — unchanged from before
  this pass. If a container is renamed after some of its contents were
  packed, the section now correctly shows them together (real containerId),
  but "Remove container" clears by the container's CURRENT label and so
  won't touch items still carrying the OLD label string. Non-destructive
  (only nulls a display field; re-prep re-attaches it) and pre-existing in
  kind — `clearPrepContainer` has never known about real containers. Fixing
  it properly means moving it onto containerId, which touches a core shared
  with a `requireService` mirror; left for the Move-to…/
  `deploy-container-dialog.tsx` generalization work below, which already
  needs to touch this same mutation family.

- **Move-to… (`MoveToContainerDialog`, `warehouse-types.ts`'s
  `resolveSelectionToUnitIds`)**: a "Move to…" button in the Deploy/De-prep/
  Return tabs' action bars, next to the existing selection actions, resolves
  the CURRENT selection (`selectedOut`/`selectedDeprep`/`selectedIn` — the
  SAME key format `handleCheckOutSelected` already parses: a bare line-item
  id, or a positional `bulkUnitKey(lineItemId, index)`) down to real unit
  ids and calls the (already-existing, already-tested)
  `useProjectContainerWrites().moveUnits(unitIds, toContainerId)`. A kit/
  accessory parent's own key resolves to the WHOLE group — every
  descendant's relevant units too, via `childLineItems` recursion (D3's
  "the whole kit moves together" convention). A bulk positional key only
  ever carries a COUNT, exactly like `handleCheckOutSelected`'s own
  `bulkQtyMap` parsing already does (the index has no stable per-unit
  identity anywhere else in the codebase) — N selected indices resolve to
  the first N stage-relevant units in array order, the same order the
  bulk-group row itself renders `units[idx]` in. Each of the 3 tabs supplies
  its own stage predicate (`isMoveableAtDeployStage`/`isMoveableAtReturnStage`/
  `isMoveableAtDeprepStage`) so the SAME resolver is correct for
  PACKED-not-deployed, CHECKED_OUT, and RETURNED-not-deprepped units alike.
  `MoveToContainerDialog` itself is a plain container picker (not
  `ContainerRail` — the rail always mirrors live prep state with exactly one
  chip active; this dialog starts with nothing chosen each time it opens).

- **Relocated accessories** — an accessory is a normal asset on the job that
  happens to nest under a parent. Once some of its units are packed into a
  DIFFERENT container than the parent's ("batteries into the Battery Box"), they
  are *relocated*: they ship with THAT container, not the parent.
  - **One rule, two consumers** — `convex/lib/accessoryRelocation.ts`
    (`isRelocatedAccessoryUnit` / `parentContainerResolver`; pure, shared by the
    server and `src/`). Loose units (no container) never count as relocated.
  - **Server** — the parent's deploy (`checkoutAccessoryChildren`), return
    (`checkinAccessoryChildren`), return-check de-prep
    (`completeCheckAndDeprepLineCore`) and its reversals (`reverseAccessoryChildren`,
    `deprepItemInner`) skip relocated units. Accessories are actioned by unit id
    through `warehouseWrites.stageAccessoryUnits`
    (`to: DEPLOY | RETURN | DEPREP | UNDEPLOY | UNRETURN | UNDEPREP`, optional
    `returnCondition`; all-or-nothing, every id validated as a live unit of an
    ACCESSORY line on the project in the right stage; `high` danger; permission
    follows the line-level twin). `DEPREP` de-preps a RETURNED unit and takes a
    packed-and-waiting one off prep (the unit row goes, like `deprepItem`). The
    container's own line flips with its contents as usual.
  - **Any accessory is actionable on its own**, relocated or not — before or after
    its parent. A parent's own cascade only touches units still in its stage, so
    an accessory already deployed/returned independently is skipped, not
    double-actioned.
  - **UI** — `relocate-accessories.ts` runs on the line list BEFORE the stage
    filters: each (accessory, container, stage) group becomes its own synthetic
    line (`reloc~…` id, one stage so its status/quantities are true), the parent
    is trimmed to what's still under it. Every tab, container section, selection,
    "Deploy container" and Move-to… sees it where it physically is with no tab
    special-casing. A nested accessory row has its own checkbox (and a chevron to
    per-unit sub-rows for a partial selection) via `AccessorySelectionContext`
    (`kit-child-rows.tsx`, provided per tab by the page). `takeAccessorySelection`
    routes the accessory keys of a selection (`reloc~…`, `acc~<line>`,
    `accu~<unit>`) to the unit mutation in the Deploy, Return, De-prep and
    move-back handlers; if the parent is selected too its own cascade covers a
    nested accessory, so that key is dropped. Move-to… uses the same selection,
    so an accessory moves with the ordinary **Move to…** button — there is no
    accessory-specific move button. A parent's Move-to… moves only what is still
    under it.
  - **Still open** — parent un-prep of an accessory *parent* still deletes the
    accessory units tied to the removed parent unit that sit in the parent's own
    container; no accessory selection on the mobile card list (whole-row tap
    targets); the De-prepped tab's "Move to Returned" re-packs a relocated row by
    unit but a nested accessory still goes with its parent's re-pack.

- **Deploy container (D4)**: a "Deploy container" button on each container's
  header in the Deploy tab (desktop table + mobile card, both render paths)
  selects every one of that container's entries
  (`warehouse-types.ts`'s `keysForGroupEntries` — the same per-`GroupEntry`-kind
  key derivation `page.tsx`'s `allOutKeys`/`allPrepKeys`/etc. already use) into
  `selectedOut`, so the EXISTING "Deploy (N)" button — already visible,
  already wired, already covers kit-batch/accessory-gate/partial-verify
  correctly — becomes the trigger. Deliberately NOT a second deploy code
  path, and deliberately NOT a literal extraction of the `kitConfirm` dialog
  (`page.tsx`'s inline kit-verify-then-deploy UI): that dialog is deeply
  embedded in a 3,700-line, production-critical prep/return flow with no
  existing test harness, and refactoring it carries real regression risk for
  what the design doc's own decision table (D4) already frames as "an
  option". This ships the same underlying capability — deploy an entire
  container in one action — without touching that fragile code at all. The
  full scan-to-verify ceremony (mark individual units present before
  offering "Deploy Verified Only" vs "Deploy All") is deliberately deferred;
  today's version deploys everything currently in the container, which is
  the common case (an operator wouldn't click "Deploy container" on a case
  they know is short).

Still open (see the build plan's Phase 2 checklist): the `clearPrepContainer`
label-matching gap noted above (Move-to and Deploy container both move/select
units directly, never by container label, so neither needed to touch it).

## Packing tab (phase 4, #1301 — landed except drag)

A new **Packing** project tab (D11 — its own tab, not a view inside
Equipment; `VALID_TABS` in `src/app/(app)/projects/[id]/page.tsx`, hidden on
template projects same as Finance) lets the PM plan which container each
piece of gear travels in before the warehouse starts prepping.

`src/lib/packing-tab.ts` (plain, React-free) flattens the Equipment tab's
already-reconstructed tree — `collectPlannableLines` walks
`CategoryData[]`/the top-level uncategorized lists, INCLUDING a Project
Group's own member lines and a sub-hire group's synthetic parent's children,
excluding kit children/container line items/cancelled/non-equipment rows. A
kit parent is ONE plannable unit (D3's "whole kit moves together", same
convention Move-to uses) — no per-child split at plan time. `resolvePackingStatus`
answers "packed" (a unit's real `containerId` — physical reality) /
"planned" (`plannedContainerId` — the PM's intent, muted) / "unplanned",
actual always overriding a stale plan; `buildPackingBuckets` groups by that
status the same way `warehouse-types.ts`'s `buildContainerGroups` does for
the warehouse tabs (real container first alphabetically, "Not planned"
bucket last).

`use-packing-tab.ts` wires `useNativeEquipmentTab` (reused verbatim — no new
model/kit/group attachment logic, no risk to the Equipment tab it already
serves) + `projectContainers.listForProject` into that pure module.
`packing-tab.tsx` renders one section per container plus "Not planned", a
native `<select>` per line (disabled once actually packed — the warehouse is
the source of truth from that point on, not this tab) calling
`useProjectContainerWrites().setPlannedContainer`, and reuses
`NewContainerSheet` verbatim for "+ New container".

**Readiness row** (`convex/lib/projectReadiness.ts`'s
`computeProjectPackingReadiness`, wired into `projectReadiness.forProject`'s
`packing` section): "N of M lines not planned yet" — a WARNING, never
blocking (Q8 — unpacked gear is a legitimate "Loose" manifest section, not a
violation), dropped entirely when the project has no plannable equipment
(same "nothing to carry a permanent row for" convention as the crew/services
checks). `work-card.tsx`'s `resolveRowAction` sends its action to the new
`packing` tab.

**Deliberately deferred**: the design doc's preferred interaction is
DRAG (reusing the Equipment tab's `use-equipment-dnd.ts` `buildContainerMap`
pattern, containers as a new drop-target kind). That hook is a 1200+ line,
deeply specialized system the ENTIRE Equipment tab depends on in
production — extending it carries real regression risk to a working, heavily
used surface, for an interaction-only difference (the underlying effect,
`plannedContainerId`, is identical whether set by drag or by the picker
shipped here). Left for its own dedicated pass; the plain `<select>` ships
the feature's full underlying value now.

## Not yet started

Phase 5 (narrow + retire the legacy `prepContainer` string field and
non-stable label-keyed ops, #1302). Phase 6 (container labels/printing, a
bulk-tub picker, client PO reference) is explicitly deferred per the design
doc's own decisions (D2, Q11, Q14) — out of scope for "feature complete" here.

## Custom / untagged qty-1 lines in a container

Container membership is per-unit (`projectLineItemUnits.containerId`). A qty-1 custom item has no asset, so `prepUnit` used to patch only the legacy `prepContainer` label and create no unit. The Deploy/Return tabs then bucketed it as `label:…` next to its neighbours' `id:…` (one case rendered as two sections), and the container label PDF treated it as Loose. `packSingleGenericIntoContainer` (`convex/lib/fulfillment.ts`) now backs it with one qty-1 unit carrying `containerId` whenever a real container is resolved. Regression: `convex/prepContainer.repro.test.ts`.

## Accessories packed in a different case than their parent

Container membership is per unit, so an ACCESSORY child (e.g. AA batteries of an
EW-DX in a Pelican) can sit in another case (the battery box).
`structureLineItemsByContainer` (`hoistRelocatedAccessories`) hoists those units out
of the parent's `childLineItems` into their own row in the receiving case
(`fromKitName` = parent, `fromContainerLabel` = the parent's case), so the
manifest / delivery docket / return sheet list them where they physically are,
with an "accessory of X" note. Unassigned or same-case units stay nested under the
parent. `container-labels.ts` reads the hoisted rows for the same output as before.
