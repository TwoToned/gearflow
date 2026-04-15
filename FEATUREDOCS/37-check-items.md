# 37 — Check Items & Quality Checks

## Overview

Quality check system integrated into the warehouse prep/return flow. Warehouse operators scan an asset, fill out model-specific check items (pass/fail, measurement, notes, dropdown), and the system records results before completing checkout/checkin. Includes a check item library, model assignment, ad-hoc checks, close-out workflow, and predictive maintenance triggers.

## Data Model

### New Enums

| Enum | Values | Purpose |
|------|--------|---------|
| `CheckItemType` | PASS_FAIL, NOTES, MEASUREMENT, DROPDOWN | Check item input type |
| `CheckContext` | PREP, RETURN, AD_HOC | When the check was performed |
| `CheckResult` | PASS, FAIL, NOTES_ONLY | Outcome of a check |
| `PrepStatus` | PENDING, PULLED, FLAGGED_FAULTY, FLAGGED_TT_OVERDUE, PACKED | Line item prep state |
| `ReturnStatus` | PENDING, UNPACKED, STORED, DAMAGED, LOST | Line item return state |

### New Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `CheckItem` | Library of check definitions | label, type, category, measurementUnit/Min/Max, dropdownOptions |
| `ModelCheckItem` | Join: model ↔ check item | modelId, checkItemId, sortOrder |
| `KitCheckItem` | Join: kit ↔ check item | kitId, checkItemId, sortOrder |
| `CheckRecord` | Individual check result | context, result, value, notes, photos[], snapshotLabel, snapshotType, kitId? |
| `WarehouseClose` | Close-out record per project | storedCount, damagedCount, lostCount, closedById |

### Kit Check System

- `KitCheckMode` enum: `KIT_LEVEL` (check kit once, all contents inherit) or `PER_ITEM` (each child uses its model's checks)
- `Kit.checkMode` field defaults to `KIT_LEVEL`
- `KitCheckItem` join table links check items to kits (like `ModelCheckItem` for models)
- `CheckRecord.kitId` — optional FK for kit-level check results
- Kit check item CRUD: `getKitCheckItems`, `addCheckItemToKit`, `removeCheckItemFromKit`, `reorderKitCheckItems` in `src/server/check-items.ts`

### Modified Models

- `ProjectLineItem`: Added `prepStatus PrepStatus?` and `returnStatus ReturnStatus?`

## Server Actions

### Check Item Library (`src/server/check-items.ts`)

| Function | Permission | Description |
|----------|-----------|-------------|
| `getCheckItems()` | read | List all org check items |
| `getCheckItem(id)` | read | Single item with usage count |
| `createCheckItem(data)` | checkItem.create | Create library item |
| `updateCheckItem(id, data)` | checkItem.update | Update library item |
| `deleteCheckItem(id)` | checkItem.delete | Delete (blocked if in use) |
| `getModelCheckItems(modelId)` | read | Items assigned to a model |
| `addCheckItemToModel(modelId, checkItemId)` | checkItem.update | Assign to model |
| `removeCheckItemFromModel(modelId, checkItemId)` | checkItem.update | Unassign |
| `reorderModelCheckItems(modelId, orderedIds)` | checkItem.update | Reorder |
| `bulkAddCheckItemsToModels(modelIds[], checkItemIds[])` | checkItem.update | Bulk assign checks to multiple models |

### Check Records (`src/server/check-records.ts`)

| Function | Permission | Description |
|----------|-----------|-------------|
| `pullItem(projectId, lineItemId)` | warehouse.scan | Set prepStatus=PULLED |
| `prepItemDirect(projectId, lineItemId, assetId?, qty?)` | warehouse.check_out | Prep without checks (PACKED) |
| `deprepItem(projectId, lineItemId, qty?)` | warehouse.check_out | Reverse prep (back to PENDING) |
| `unpackItem(projectId, lineItemId)` | warehouse.scan | Set returnStatus=UNPACKED |
| `completeCheckAndPack(data)` | warehouse.scan | Save records + checkout + PACKED |
| `completeCheckAndFlag(data)` | warehouse.scan | Save records + flag (FAULTY/TT_OVERDUE) |
| `completeCheckAndStore(data)` | warehouse.scan | Save records + checkin + condition |
| `completeCheckAndDeprep(data)` | warehouse.check_out | Save RETURN records + reset prepStatus (deprep-gate check) |
| `saveAdHocCheck(data)` | warehouse.scan | Standalone check (AD_HOC context) |
| `lookupAssetForAdHocCheck(tag)` | read | Asset lookup for ad-hoc page |
| `getCheckHistory(assetId, context?)` | read | All records for an asset |
| `getModelFailureAnalytics(modelId)` | read | Per-check-item failure rates |

### Warehouse Close (`src/server/warehouse-close.ts`)

| Function | Permission | Description |
|----------|-----------|-------------|
| `getCloseOutSummary(projectId)` | warehouse.close | Summary stats + exceptions |
| `closeOutProject(data)` | warehouse.close | Create WarehouseClose record |
| `batchCloseOut(projectIds[])` | warehouse.close | Close up to 25 projects |

## UI Components

### Settings

- **Check Item Library** (`/settings/check-items`): CRUD page with type-specific fields (measurement thresholds, dropdown options with isFail flags). Grouped by category.

### Model Detail

- **Checks Tab** (`model-checks-tab.tsx`): Assigned check items with reorder, add from library picker, remove.
- **Failure Analytics** (`model-failure-analytics.tsx`): Per-check-item failure rate bars.

### Warehouse

- **Item Check Form** (`item-check-form.tsx`): Sheet slide-over with check items. Pass/Fail buttons (Fail LEFT red, Pass RIGHT green), measurement with auto-pass/fail, dropdown with isFail, "Pass All" with 3-second undo toast. Supports embedded mode for ad-hoc page. **Keyboard shortcuts:** `P` pass focused PASS_FAIL row, `F` fail, `A` pass all remaining, `↑`/`↓` move focused-row cursor (skips non-PASS_FAIL rows), `Enter` submit when all answered. Shortcuts are suppressed when focus is on a text input / textarea / number input, while submitting, or with a modifier key held. The focused row gets a `ring-2 ring-primary` highlight. A desktop-only hint bar shows the available keys in the footer.
- **Close-Out Tab** (`close-out-tab.tsx`): Summary stats, exceptions table, two-step close confirmation.
- **Batch Close-Out**: Multi-select on warehouse dashboard for returned projects.

### Asset Detail

- **Checks Tab** (`asset-checks-tab.tsx`): Timeline of all check records grouped by session. Filter by context.

### Ad-Hoc Check

- **Route** (`/check/[assetTag]`): Standalone page to check any asset outside a project.

## Check Queue

The warehouse page builds a **check queue** when prepping or returning multiple items. Items with check items assigned go through the `ItemCheckForm` sheet one at a time; items without checks are prepped/returned directly via `prepItemDirect` or `deprepItem`.

### Scan Input Auto-Refocus

When a check queue completes (single item or multi-item), `finishCheckQueue` returns focus to the correct scan input via `requestAnimationFrame` (PREP → main scan input, RETURN → return-tab scan input, RETURN-with-fromDeprep → deploy-tab scan input). This lets barcode scanners flow scan-to-scan without a mouse click between checks. The `requestAnimationFrame` delay lets the Sheet focus trap release before the refocus runs, avoiding a race.

### Deprep Check Gate (inbound symmetry)

Outbound flow: `pick/prep → CHECK → deploy (staging) → on truck`.
Inbound flow: `truck → return → deploy (staging) → CHECK → pick/prep (inventory)`.

The Deploy tab is the staging ground on both sides of the truck. The check always happens at the inventory↔staging boundary. On the inbound side, that means a second RETURN-context check runs at **deprep time** in addition to the existing return-scan check (additive, dual-check). Implementation:

- `handleDeprep` in `src/app/(app)/warehouse/[projectId]/page.tsx` intercepts deprep clicks for returned items (`status === "RETURNED"`, `prepStatus === "PACKED"`) whose model has check items, and builds a check queue with `fromDeprep: true, context: "RETURN"`.
- On submit, the queue dispatches to `completeCheckAndDeprep` (not `completeCheckAndStore`) which writes RETURN-context `CheckRecord` rows and resets `prepStatus=PENDING` in one transaction — without changing `status` (already RETURNED).
- Items that were never deployed (outbound deprep) or whose model has no check items bypass the form and call `deprepItem` directly.
- Flagged/damaged items (`prepStatus !== "PACKED"`) also bypass the form and deprep directly — the return-scan check already captured the fault, and a second pass would be duplicate noise.
- Kit deprep respects `KitCheckMode` via `startKitCheckFlow(..., fromDeprep=true)`. `KIT_LEVEL` kits get one kit-level check; `PER_ITEM` kits get a queue entry per child. When the queue finishes, `finishCheckQueue` calls `deprepKit` instead of `kitCheckInMutation`.

### Bulk Items in Check Queue
- Each selected bulk unit generates a separate `CheckQueueItem` entry
- `completeCheckAndPack` caps `checkedOutQuantity` at `lineItem.quantity` via `Math.min` to prevent over-counting
- No-check bulk items are prepped directly before the check queue starts (not passed as `directItems` to avoid double-prep)

### Multi-Qty Serialized Items
- When prepping/checking out a serialized item with `quantity > 1` and a specific `assetId`, both `prepItemDirect` and `checkOutItems` split off a new line item with `qty=1` for the assigned asset and decrement the original

## Feature Gate

Models with 0 check items skip the check form entirely. The `model._count.modelCheckItems` count (included in warehouse queries) is checked before opening the form — preserving existing behavior for models without checks. Kit check items use `kit._count.kitCheckItems` similarly.

## Predictive Maintenance

After saving check records, if any check item has a FAIL result:
1. Query last 3 CheckRecords for that asset + check item
2. If 2+ are FAIL, auto-create a MaintenanceRecord (type=PREVENTATIVE)
3. Runs as post-commit hook with `.catch(console.error)` to not block the main flow

## Permissions

- Resource: `checkItem` with actions: read, create, update, delete
- Action: `warehouse.close` for close-out operations
- Default grants: owner/admin/manager get all checkItem actions; member/staff/warehouse get read

## Notifications

- `flagged_asset` notification type: queries for line items with FLAGGED_FAULTY or FLAGGED_TT_OVERDUE prepStatus

## Search & Navigation

- CheckItem added to global search (label, category, description matching)
- "Check Items" added to Settings page commands for command palette
