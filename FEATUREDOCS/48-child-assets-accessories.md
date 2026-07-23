# Child Assets / Accessories

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

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

1. **Attach** (asset-level — browser-direct [`convex/assetAccessoriesWrites.ts`](../convex/assetAccessoriesWrites.ts),
   formerly `src/server/asset-accessories.ts`) — `addSerializedNative`,
   `addBulkNative` (was `addSerializedChildToAsset`/`addBulkChildToAsset`), plus
   `removeSerializedNative`/`removeBulkNative` (detach). Guards:
   self/nesting/already-attached, kit↔accessory dual membership (symmetric
   check in `kits.ts`), one-level-deep, cross-org. UI:
   `AssetAccessoriesManager` on the asset detail page.

   **Attach (model-level — browser-direct [`convex/modelBulkAccessoriesWrites.ts`](../convex/modelBulkAccessoriesWrites.ts),
   formerly `src/server/model-accessories.ts`)** —
   `addNative` / `removeNative` (was `addModelBulkAccessory` / `removeModelBulkAccessory`). The unique
   `(modelId, bulkAssetId)` constraint surfaces as `ACCESSORY_DUPLICATE`. UI:
   `ModelAccessoriesManager` on the Model detail page. Removing a model
   accessory after a project has already expanded it does NOT retroactively
   delete the project line item — it's a concrete row at that point.
2. **Onto a project** — two entry points, both producing accessory child lines
   (`isKitChild:true`, `childKind:ACCESSORY`, `parentLineItemId`) AND both
   unioning the asset's own bulk children with the asset's model's
   `bulkAccessories`, deduped by `bulkAssetId` so asset-level overrides win
   on conflict:
   - Office, **specific asset**: adding a specific serialised asset
     (`expandAccessoryChildLines`, ported to [`convex/lib/fulfillment.ts`](../convex/lib/fulfillment.ts) —
     formerly `expandAccessoryChildren` in `src/server/line-items.ts`) auto-expands
     its serialised + bulk children, atomic with the parent line.
   - Office, **by model** (the common quoting flow): adding a line *by model*
     (no specific asset) expands the **model's** default bulk accessories
     (`ModelBulkAccessory`), quantity scaled by the line quantity (`2x IMX6A` →
     `2x` of each model accessory), so the accessory shows on the project +
     documents immediately. Serialised asset-level accessories can't expand here
     (no specific asset is picked) — they materialise at warehouse prep.
   - Warehouse: assigning a specific unit to a *model-level* line at prep or
     deploy (`expandAccessoriesForAsset`, [`convex/lib/fulfillment.ts`](../convex/lib/fulfillment.ts) —
     formerly `src/lib/line-item-fulfillment.ts` — hooked
     into `prepUnit` (same file, called from `convex/checkRecordOps.ts`) +
     `checkOutItems`). Idempotent — dedups serialised by
     assetId, bulk by bulkAssetId (the `(parentLineItemId, bulkAssetId)` unique
     index backstops it), and **reconciles** the office-created model-accessory
     row's quantity to the units actually assigned. So re-scans don't duplicate.
   **Known limitation:** the quantity-merge path in `addLineItem` (adding the
   same model again increments an existing line) does not re-scale the accessory
   child; and changing a line's quantity later doesn't retroactively rescale.
   Add the full quantity in one go for an exact accessory count.
   No units created at expansion — units stay lazy-at-prep. `removeLineItem`
   cascade-deletes children (transactional) and blocks direct child removal.
3. **Warehouse** (`src/server/warehouse.ts`) — `lookupAssetForScan` returns
   `type: "asset_child"` ("scan the parent") for a scanned accessory.
   `checkOutItems`/`checkInItems` cascade the parent's deploy/return to accessory
   child lines through the same unit path (`ensureSerialisedUnit` /
   `ensureBulkUnit` / `returnLineUnits`) inside the parent's transaction. The
   return cascade lives in `convex/lib/fulfillment.ts:checkinAccessoryChildren`
   (formerly `line-item-fulfillment.ts`; shared, not warehouse-private) so the
   **check-and-store** return flow (browser-direct
   `convex/checkRecordWrites.ts:completeCheckAndStore`, formerly
   `check-records.ts:completeCheckAndStore`) cascades too — any code path that
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

   **Deploy/return tabs** — ⚠️ **stale, needs a follow-up audit.** This section
   previously described a dedicated `accessory-child-rows.tsx`
   (`AccessoryChildRows` / `getAccessoryChildren`) component wired into
   `deploy-tab.tsx`/`return-tab.tsx`; that file no longer exists in current code
   and no `AccessoryChildRows` component could be found anywhere in the repo.
   `getAccessoryChildren` now lives in
   [`src/components/warehouse/pick-list-progress.ts`](../src/components/warehouse/pick-list-progress.ts),
   but it's used for pick-progress counting (consumed by `online-pick-list.tsx`),
   not for rendering rows in the deploy/return tabs. Whether the deploy/return
   tabs still render accessory children distinctly (vs. folded into the generic
   `KitChildRows` path, which does not check `childKind`) is unverified — treat
   this paragraph as unconfirmed until someone re-audits `deploy-tab.tsx` /
   `return-tab.tsx` against current behaviour.

   **Known gap (not yet wired):** the pick/prep tab (`pick-prep-tab.tsx`) does
   not yet show accessories nested; expansion still happens at prep server-side.
4. **PDFs** — accessories render indented under the parent on **all** docs
   (internal and customer-facing). An accessory parent is detected by
   "top-level line, no `kitId`, has `ACCESSORY` children"; both the render
   (`gearflow-table.ts`) and the height calc (`section-renderer.ts`) handle it,
   so children are reserved and never tail-dropped.

   **Grouped accessory parents (the two-level case).** When an accessory parent is
   a **project-group member**, `structureLineItems` nests it as the synthetic
   group row's `childLineItems`, so the accessory parent is a *child* and its
   accessories are *grandchildren*. The plugin/height previously only recursed
   into grandchildren for nested kits (`child.kitId`), silently dropping a grouped
   accessory parent's accessories. Both `gearflow-table.ts` and `section-renderer.ts`
   now also recurse when a child is an accessory parent (`!child.kitId` +
   `childKind:ACCESSORY` grandchildren). Tested via the grouped-member case in
   `accessories-render.test.ts`.

   **Per-unit on packing docs.** On packing-list/pull-slip docs (showPerUnitCheckboxes),
   a qty>1 accessory expands into one checkable line per unit — an accessory is
   just an auto-added asset, so it gets the same per-unit treatment a real asset
   row does. This holds even when the accessory is a grandchild (its parent is a
   group member): `gearflow-table.ts` draws the per-unit lines and
   `section-renderer.ts` reserves their height.

## Tests

> The `src/server/*.int.test.ts` Prisma integration tests below were removed
> along with the server actions they covered. Equivalent coverage now lives in
> `convex/assetAccessoriesWrites.test.ts` (attach/detach, both allocation modes,
> guards) and `convex/modelBulkAccessoriesWrites.test.ts` (model inheritance).
> Project-expansion and checkout/checkin-cascade coverage is folded into the
> broader `convex/lineItemWrites.test.ts` / `convex/warehouseWrites.test.ts` /
> `convex/checkRecordWrites.test.ts` suites rather than dedicated accessory files.
> `src/components/warehouse/accessory-child-rows.test.ts` could not be located in
> current code — see the "Deploy/return tabs" caveat above.

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

## Exclude accessories toggle

Both `addLineItem` and `checkOutItems` accept an optional `includeAccessories`
parameter (default `true`):

- **`addLineItem(projectId, data, allowOverbook, forceSeparate, includeAccessories)`**
  — when `false`, skips `expandAccessoryChildren` so no accessory child lines are
  created alongside the parent. Useful for return-only or bulk-import flows where
  accessories are managed separately.
- **`checkOutItems(projectId, items, includeAccessories)`** — when `false`, skips
  `expandAccessoriesForAsset` and `checkoutAccessoryChildren` so no accessories
  are deployed. The parent line still checks out with its units and status.

The project equipment tab (`equipment-add-form.tsx`) shows a **"Include accessories"**
checkbox when the selected model or asset has accessories (`hasAccessories` on the
`checkAvailability` / `lookupAssetByTag` response). Unchecking it passes
`includeAccessories: false` to the server action. The `hasAccessories` field was
added to both return types as part of the Quattro review.

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
- **`bulk-group` tab rendering.** `AccessoryChildRows` was wired into the
  `bulk-group` branch of the deploy/return tabs too, so a multi-qty serialised
  model line (which `groupItems` classifies `bulk-group`) shows its accessories
  — see the "Deploy/return tabs" caveat above; this component no longer exists
  under that name and current behaviour is unverified.

`resolveAssetAccessories` is the shared per-asset profile (serialised children +
bulk accessories, asset-level unioned with model-level) used by both expansion and
the per-unit return scoping. Tests: the multi-quantity isolation block in
`warehouse-accessories.int.test.ts` (return-isolation, DAMAGED + MISSING
isolation, mixed-condition batch, whole-line return, bulk scale + per-unit return,
double-check-in no over-return, idempotent re-scan, savepoint recovery).

**Concurrency & idempotency.** This domain now lives in Convex
([`convex/lib/fulfillment.ts`](../convex/lib/fulfillment.ts), ported from
`src/lib/line-item-fulfillment.ts`); the two Postgres-specific tricks below no
longer apply as described — the file's header comment notes both collapse for
free under Convex's per-document serializable mutations:
- Accessory child creation is backstopped by the partial unique indexes (below);
  `createAccessoryChildIfAbsent` is now a plain check-then-insert — a concurrent
  racer serializes and the loser re-reads, no SAVEPOINT needed (Postgres
  previously wrapped each create in a SAVEPOINT so a 23505 conflict didn't
  poison the whole interactive transaction).
- `expandAccessoriesForAsset` no longer needs the Postgres `FOR UPDATE` row lock
  on the parent line — a Convex mutation is serialised for free, so two stations
  expanding different units of the same line still serialize and bulk demand
  sees every committed sibling (no concurrent undercount). Demand excludes
  RETURNED / CANCELLED units.
- The return cascade only fires when the parent return actually flipped a unit
  (`unitsFlipped > 0`), so a retry / double-scan can't re-return the shared bulk
  accessory.

**Known edge cases (bulk only; serialised is exact).** Bulk demand and the
per-unit return share are recomputed live from current config, not snapshotted at
checkout, so a **config edit mid-deployment** (changing/removing a model/asset
bulk accessory qty) only reconciles on the next expansion of a unit that still
ships it. An **orphaned serialised accessory** (parent asset deleted →
`parentAssetId` null) returns only via a whole-line return, not a per-unit scan.
**Per-unit deprep** clears every bulk accessory row's `prepStatus` (bulk rows are
shared) — staging-board cosmetic only. The robust fix is to snapshot each unit's
accessory contribution at deploy; tracked in TODOS.md.

**Still out of scope (pre-existing, untouched):** `checkOutItems` fetches+updates
an asset by global `assetId` without re-scoping to `organizationId` (cross-tenant
write risk), and accessories are materialised after the T&T checkout preflight
(`assertTestTagAllowsCheckout`) so a non-compliant accessory can deploy unchecked.
Both are tracked in TODOS.md.

**Perf note:** bulk demand recompute resolves each distinct parent-unit asset once
per expansion call (O(units) per call, O(units²) over a full multi-unit deploy).
Fine for typical rental line sizes; revisit if very large lines appear.
