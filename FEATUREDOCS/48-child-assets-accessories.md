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
  `quantity` and `allocationMode`.
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

1. **Attach** (`src/server/asset-accessories.ts`) — `addSerializedChildToAsset`,
   `addBulkChildToAsset`, plus detach. Guards: self/nesting/already-attached,
   kit↔accessory dual membership (symmetric check in `kits.ts`), one-level-deep,
   cross-org. UI: `AssetAccessoriesManager` on the asset detail page.
2. **Onto a project** — two entry points, both producing accessory child lines
   (`isKitChild:true`, `childKind:ACCESSORY`, `parentLineItemId`):
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
   `ensureBulkUnit` / `returnLineUnits`) inside the parent's transaction.
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
  scan-the-parent (3).
- `src/lib/pdfme/plugins/accessories-render.test.ts` — full pipeline: filter →
  indented render → height reservation (3).

## Not in v1

Bulk parents (only serialised assets can be parents), nested accessories,
per-accessory pricing (`unitPrice` is nullable so a future ITEMIZED mode is a
data change), kit↔accessory conversion.
