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

## Documents (phase 3a landed; 3b/3c open — #1300)

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

Still open: `build-document-data.ts` wiring (loading `projectContainers` +
joining units, passing `byContainer` for the actual doc types), the
`ContainerHeaderRow` render component, the **Manifest** document (3b, new
`DocumentType`), and the delivery-docket/return-sheet rework (3c).

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

Still open (see the build plan's Phase 2 checklist): scan-to-activate (a
scanned container asset switches the active chip instead of erroring),
Prepped/Return/De-prep tabs regrouping by `containerId` instead of the label,
the Move-to… sheet, and generalizing the kit-verify dialog into a shared
`deploy-container-dialog.tsx`.

## Not yet started

Phase 4 (Packing tab — planning UI, drag helper, readiness check, #1301) and
Phase 5 (narrow + retire the legacy `prepContainer` string field and
non-stable label-keyed ops, #1302). Phase 6 (container labels/printing, a
bulk-tub picker, client PO reference) is explicitly deferred per the design
doc's own decisions (D2, Q11, Q14) — out of scope for "feature complete" here.
