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
| `CheckRecord` | Individual check result | context, result, value, notes, photos[], snapshotLabel, snapshotType |
| `WarehouseClose` | Close-out record per project | storedCount, damagedCount, lostCount, closedById |

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

### Check Records (`src/server/check-records.ts`)

| Function | Permission | Description |
|----------|-----------|-------------|
| `pullItem(projectId, lineItemId)` | warehouse.scan | Set prepStatus=PULLED |
| `unpackItem(projectId, lineItemId)` | warehouse.scan | Set returnStatus=UNPACKED |
| `completeCheckAndPack(data)` | warehouse.scan | Save records + checkout + PACKED |
| `completeCheckAndFlag(data)` | warehouse.scan | Save records + flag (FAULTY/TT_OVERDUE) |
| `completeCheckAndStore(data)` | warehouse.scan | Save records + checkin + condition |
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

- **Item Check Form** (`item-check-form.tsx`): Sheet slide-over with check items. Pass/Fail buttons (Fail LEFT red, Pass RIGHT green), measurement with auto-pass/fail, dropdown with isFail, "Pass All" with 3-second undo toast. Supports embedded mode for ad-hoc page.
- **Close-Out Tab** (`close-out-tab.tsx`): Summary stats, exceptions table, two-step close confirmation.
- **Batch Close-Out**: Multi-select on warehouse dashboard for returned projects.

### Asset Detail

- **Checks Tab** (`asset-checks-tab.tsx`): Timeline of all check records grouped by session. Filter by context.

### Ad-Hoc Check

- **Route** (`/check/[assetTag]`): Standalone page to check any asset outside a project.

## Feature Gate

Models with 0 check items skip the check form entirely. The `model._count.modelCheckItems` count (included in warehouse queries) is checked before opening the form — preserving existing behavior for models without checks.

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
