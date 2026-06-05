# Child Assets / Accessories

Permanently attach accessories (cables, clamps, adaptors) to a parent serialised
asset so they travel together — onto projects, through warehouse checkout/checkin,
and onto documents. Roadmap Phase 1.1; foundational for Bulk Check-In (1.3).

Accessories are **not kits**. A kit is a physical container with its own asset
tag and rental contract; an accessory is inseparable from its parent — no
container, no separate booking, no separate price. The implementation is
**unit-native** (built on `ProjectLineItemUnit`), distinct from the kit
mechanism but reusing its parent/child *line-item* shape.

## Data model

- **`Asset.parentAssetId`** — self-relation (`onDelete: SetNull`). A serialised
  child has exactly one parent. Parents are always serialised (Asset rows).
- **`AssetBulkChild`** — join table for bulk accessories (e.g. "2 clamps"), with
  `quantity` and `allocationMode`. Asset-level — overrides the model template
  for the same `bulkAssetId`.
- **`ModelBulkAccessory`** — join table for **model-level** default bulk
  accessories. "Every asset of this model ships with N of this bulk asset."
  Unique on `(modelId, bulkAssetId)`. Inheritance kicks in at project
  expansion: both office add and warehouse scan-time union the asset's own
  bulk children with the model's defaults, deduped by `bulkAssetId` (asset
  wins on conflict). Always SHIPS_WITH — DEDICATED at the model level would
  drain the whole shelf in one click. Bulk only at the model level; serialised
  accessories stay asset-level (you can't pick "the" specific cable for every
  asset of a model).
- **`AccessoryAllocationMode`** — `SHIPS_WITH` (default) | `DEDICATED`.
  - `SHIPS_WITH`: the parent "ships with" N of a bulk asset; the N are drawn
    from the live pool at prep/checkout (a normal booking). The shared pool is
    **not** decremented at attach time. Default because a zip-tied clamp is not
    a sealed-container kit item — permanently draining the pool for idle parents
    creates false shortages.
  - `DEDICATED`: N are pulled out of the shared pool at attach (guarded
    `adjustBulkAvailability`) and restored on detach/remove.
- **`ProjectLineItem.childKind`** — `KIT | ACCESSORY`. See the critical
  convention below.

## The `isKitChild` + `childKind` convention (read before touching filters)

`isKitChild: true` is the **structural** "this is a non-top-level child" flag.
It is set on kit children, sub-hire group children, **and** accessory children.
The ~40 `where: { isKitChild: false }` filters across the app (project totals,
item counts, warehouse displays) rely on it to exclude every kind of child from
top-level aggregates. Accessories set `isKitChild: true` so they inherit that
exclusion **with zero migration**.

`childKind` is the **behaviour** discriminator — it distinguishes kit-vs-accessory
where rendering or logic differs (PDF label/bold, `removeLineItem` error copy,
the warehouse cascade, scan routing). Do **not** migrate the structural filters
to `parentLineItemId != null`; `isKitChild` already covers the same set and is
what every existing query keys off.

## Flow

1. **Attach** (asset-level — `src/server/asset-accessories.ts`) —
   `addSerializedChildToAsset`, `addBulkChildToAsset`, plus detach. Guards:
   self/nesting/already-attached, kit↔accessory dual membership (symmetric
   check in `kits.ts`), one-level-deep, cross-org. UI:
   `AssetAccessoriesManager` on the asset detail page.

   **Attach (model-level — `src/server/model-accessories.ts`)** —
   `addModelBulkAccessory` / `removeModelBulkAccessory`. The unique
   `(modelId, bulkAssetId)` constraint surfaces as `ACCESSORY_DUPLICATE`. UI:
   `ModelAccessoriesManager` on the Model detail page. Removing a model
   accessory after a project has already expanded it does NOT retroactively
   delete the project line item — it's a concrete row at that point.
2. **Onto a project** — two entry points, both producing accessory child lines
   (`isKitChild:true`, `childKind:ACCESSORY`, `parentLineItemId`) AND both
   unioning the asset's own bulk children with the asset's model's
   `bulkAccessories`, deduped by `bulkAssetId` so asset-level overrides win
   on conflict:
   - Office: adding a *specific* serialised asset (`expandAccessoryChildren`,
     `line-items.ts`) auto-expands children atomic with the parent line.
   - Warehouse: assigning a specific unit to a *model-level* line at prep or
     deploy (`expandAccessoriesForAsset`, `line-item-fulfillment.ts`, hooked
     into `prepUnit` + `checkOutItems`). Idempotent — dedups serialised by
     assetId, bulk by bulkAssetId, so re-scans don't duplicate.
   No units created at expansion — units stay lazy-at-prep. `removeLineItem`
   cascade-deletes children (transactional) and blocks direct child removal.
3. **Warehouse** (`src/server/warehouse.ts`) — `lookupAssetForScan` returns
   `type: "asset_child"` ("scan the parent") for a scanned accessory.
   `checkOutItems`/`checkInItems` cascade the parent's deploy/return to accessory
   child lines through the same unit path (`ensureSerialisedUnit` /
   `ensureBulkUnit` / `returnLineUnits`) inside the parent's transaction. The
   return cascade lives in `line-item-fulfillment.ts:checkinAccessoryChildren`
   (shared, not warehouse-private) so the **check-and-store** return flow
   (`check-records.ts:completeCheckAndStore`) cascades too — any code path that
   returns a parent must call it, or accessories stick at `CHECKED_OUT`.
   `completeCheckAndDeprep` resets accessory children `prepStatus` so they don't
   linger on the deploy-staging board.

   **Pick sheets** — accessories hang off a normal top-level asset line (not a
   kit), so both the interactive (`online-pick-list.tsx`) and printable
   (`pull-sheet/page.tsx`) sheets render them indented under their parent,
   badged "Accessory", and count them in pick progress. The `getProjectPullSheet`
   filter drops accessory rows from the flat list (`isKitChild:true`) — they
   travel on the parent's `childLineItems` instead. Detect a renderable
   accessory child by `childKind === "ACCESSORY"`.

   **Project equipment table** (`equipment-rows.tsx`) — `describeRow` treats an
   accessory parent (top-level asset line, no `kitId`, has `ACCESSORY` children)
   as an expandable parent so its children render indented like kit members,
   each badged "Accessory". Accessory children are hidden from the flat list by
   `isHiddenFromList` (they're `isKitChild:true`).

   **Deploy/return tabs** — the scan-driven deploy/return tabs render accessory
   children as read-only indented rows under their parent via
   `accessory-child-rows.tsx` (`AccessoryChildRows` / `getAccessoryChildren`),
   wired into both the `single` and `serialized-group` entry branches in
   `deploy-tab.tsx` and `return-tab.tsx`. They're informational (no separate
   verify/select — accessories cascade atomically with the parent); mode filter
   mirrors `KitChildRows` (deploy shows not-yet-out, return shows checked-out).
   Accessory parents are plain serialised lines, so `groupItems` routes them to
   `single`/`serialized-group`, never `kit-group`.

   **Known gap (not yet wired):** the pick/prep tab (`pick-prep-tab.tsx`) does
   not yet show accessories nested; expansion still happens at prep server-side.
4. **PDFs** — accessories render indented under the parent on **all** docs
   (internal and customer-facing). An accessory parent is detected by
   "top-level line, no `kitId`, has `ACCESSORY` children"; both the render
   (`gearflow-table.ts`) and the height calc (`section-renderer.ts`) handle it,
   so children are reserved and never tail-dropped.

## Tests

- `src/server/asset-accessories.int.test.ts` — attach/detach, both allocation
  modes, rollback, all guards (10).
- `src/server/project-accessories.int.test.ts` — project expansion, cascade
  delete, child-removal block, totals exclusion (5).
- `src/server/warehouse-accessories.int.test.ts` — checkout/checkin cascade,
  check-and-store cascade, scan-the-parent (6).
- `src/components/projects/equipment-rows.test.ts` — `describeRow` accessory
  parent → expandable; `isHiddenFromList` nests accessory children (4).
- `src/components/warehouse/accessory-child-rows.test.ts` — `getAccessoryChildren`
  mode filtering for the deploy/return tabs (4).
- `src/lib/pdfme/plugins/accessories-render.test.ts` — full pipeline: filter →
  indented render → height reservation (3).
- `src/server/model-accessories.int.test.ts` — model inheritance: office add,
  asset override wins, warehouse scan-time inheritance + idempotency, unique
  constraint, "removing the template doesn't affect past expansions" (5).

## Not in v1

Bulk parents (only serialised assets can be parents), nested accessories,
per-accessory pricing (`unitPrice` is nullable so a future ITEMIZED mode is a
data change), kit↔accessory conversion.

## Multi-quantity / model-level parents

A multi-quantity / model-level parent line (one `ProjectLineItem`, `quantity > 1`,
specific units assigned per-unit at prep/checkout) accumulates one accessory child
set per assigned parent unit. These are handled per-unit:

- **Per-unit return scoping.** `checkinAccessoryChildren` takes a `returnedAssetId`.
  On a per-unit return (`checkInItems`/`completeCheckAndStore` with a scanned
  asset) only that unit's accessories return — **serialised** children whose
  accessory `asset.parentAssetId === returnedAssetId`, plus the returned unit's
  **per-unit share** of each bulk accessory (a partial `returnLineUnits`, so the
  bulk child flips to RETURNED only once every parent unit is back). A whole-line
  return (no `returnedAssetId`) returns every child in full. So returning Light A
  no longer returns Light B's still-deployed cable, and a DAMAGED return only
  maintenance-routes the returned unit's accessories. `completeCheckAndDeprep`
  scopes its `prepStatus` reset the same way (serialised by `parentAssetId` +
  shared bulk rows).
- **Bulk demand scales with units.** `expandAccessoriesForAsset` keeps ONE bulk
  child per `bulkAssetId` but recomputes its quantity as the total demand across
  every assigned parent unit (qty-N line × 1 clamp each → bulk child quantity N).
  Recompute (not increment) keeps it idempotent under re-scans. Checkout syncs the
  bulk unit quantity from the child, so it tracks demand as units deploy.
- **Expansion race closed.** Partial unique indexes (migration
  `20260605120000_accessory_child_unique_index`) on `(parentLineItemId, assetId)`
  and `(parentLineItemId, bulkAssetId)` where `childKind = 'ACCESSORY'` backstop
  the read-before-create; the create catches the violation (`isUniqueViolation`)
  and falls back to an update. Prisma's DSL can't express partial indexes, so they
  are raw-SQL only and not in `schema.prisma` (see the migration's note on
  `migrate dev` drift).
- **`bulk-group` tab rendering.** `AccessoryChildRows` is wired into the
  `bulk-group` branch of the deploy/return tabs too, so a multi-qty serialised
  model line (which `groupItems` classifies `bulk-group`) shows its accessories.

`resolveAssetAccessories` is the shared per-asset profile (serialised children +
bulk accessories, asset-level unioned with model-level) used by both expansion and
the per-unit return scoping. Tests: the multi-quantity isolation block in
`warehouse-accessories.int.test.ts` (return-isolation, DAMAGED isolation,
whole-line return, bulk scale + per-unit return, idempotent re-scan).

**Still out of scope (pre-existing, untouched):** `checkOutItems` fetches+updates
an asset by global `assetId` without re-scoping to `organizationId` (cross-tenant
write risk), and accessories are materialised after the T&T checkout preflight
(`assertTestTagAllowsCheckout`) so a non-compliant accessory can deploy unchecked.
Both are tracked in TODOS.md.

**Perf note:** bulk demand recompute resolves each distinct parent-unit asset once
per expansion call (O(units) per call, O(units²) over a full multi-unit deploy).
Fine for typical rental line sizes; revisit if very large lines appear.
