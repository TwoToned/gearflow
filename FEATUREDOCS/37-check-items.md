# 37 — Check Items & Quality Checks

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

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
- Kit check item CRUD: `kitCheckItems.assignmentsForKit` (read) in `convex/kitCheckItems.ts`; `addCheckItemToKitNative`, `removeCheckItemFromKitNative`, `reorderKitCheckItemsNative` (writes) in `convex/checkItemsWrites.ts`

### Modified Models

- `ProjectLineItem`: Added `prepStatus PrepStatus?` and `returnStatus ReturnStatus?`

## Server Actions

### Check Item Library (`convex/checkItems.ts` reads + `convex/checkItemsWrites.ts` browser-direct mutations; model assignment reads in `convex/modelCheckItems.ts`)

| Function | Permission | Description |
|----------|-----------|-------------|
| `checkItems.list` | read | List all org check items |
| `checkItems.getById` | read | Single item with usage count |
| `checkItemsWrites.createCheckItemNative` | checkItem.create | Create library item |
| `checkItemsWrites.updateCheckItemNative` | checkItem.update | Update library item |
| `checkItemsWrites.deleteCheckItemNative` | checkItem.delete | Delete (blocked if in use) |
| `modelCheckItems.assignmentsForModel` | read | Items assigned to a model |
| `checkItemsWrites.addCheckItemToModelNative` | checkItem.update | Assign to model |
| `checkItemsWrites.removeCheckItemFromModelNative` | checkItem.update | Unassign |
| `checkItemsWrites.reorderModelCheckItemsNative` | checkItem.update | Reorder |
| `checkItemsWrites.bulkAddCheckItemsToModelsNative` | checkItem.update | Bulk assign checks to multiple models |

### Check Records

`pullItem`, `prepItemDirect`, `prepItemsBatch`, `deprepItem`, `deprepKit`, `deprepItemsBatch`,
`unpackItem`, `lookupAssetForAdHocCheck`, `getCheckHistory`, `getModelFailureAnalytics` are
still server actions in `src/server/check-records.ts`. The five `completeCheckAnd*` /
`saveAdHocCheck` mutations below moved browser-direct to Convex — called via
`src/hooks/use-check-record-writes.ts`:

| Function | Permission | Description |
|----------|-----------|-------------|
| `pullItem(projectId, lineItemId)` | warehouse.scan | Set prepStatus=PULLED |
| `prepItemDirect(projectId, lineItemId, assetId?, qty?)` | warehouse.check_out | Prep without checks (PACKED) |
| `deprepItem(projectId, lineItemId, qty?)` | warehouse.check_out | Reverse prep (back to PENDING) |
| `unpackItem(projectId, lineItemId)` | warehouse.scan | Set returnStatus=UNPACKED |
| `checkRecordWrites.completeCheckAndPack` | warehouse.scan | Save records + checkout + PACKED |
| `checkRecordWrites.completeCheckAndFlag` | warehouse.scan | Save records + flag (FAULTY/TT_OVERDUE) |
| `checkRecordWrites.completeCheckAndStore` | warehouse.scan | Save records + checkin + condition |
| `checkRecordWrites.completeCheckAndDeprep` | warehouse.check_out | Save RETURN records + reset prepStatus (deprep-gate check) |
| `checkRecordWrites.saveAdHocCheck` | warehouse.scan | Standalone check (AD_HOC context) |
| `lookupAssetForAdHocCheck(tag)` | read | Asset lookup for ad-hoc page |
| `getCheckHistory(assetId, context?)` | read | All records for an asset |
| `getModelFailureAnalytics(modelId)` | read | Per-check-item failure rates |

### Warehouse Close (`convex/warehouseCloses.ts` reads + `convex/warehouseCloseWrites.ts` browser-direct mutations)

| Function | Permission | Description |
|----------|-----------|-------------|
| `warehouseCloses.closeOutSummary` | warehouse.close | Summary stats + exceptions |
| `warehouseCloseWrites.closeOutNative` | warehouse.close | Create WarehouseClose record |
| `warehouseCloseWrites.batchCloseOutNative` | warehouse.close | Close up to 25 projects |

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
- **Audio feedback**: Uses the shared `useScanFeedback` hook (`@/hooks/use-scan-feedback`,
  see FEATUREDOCS/12 §"Scan Feedback (Audio)" and FEATUREDOCS/14 §"Audio / Scan Feedback")
  with a `<ScanAudioToggle>` in the page header. `exception` plays once when the tag lookup
  resolves and the asset isn't found (unknown tag); `submitMutation` plays `success` on save
  and `error` on failure.

## Check Queue

The warehouse page builds a **check queue** when prepping or returning multiple items. Items with check items assigned go through the `ItemCheckForm` sheet one at a time; items without checks are prepped/returned directly via `prepItemDirect` or `deprepItem`.

### Scan Input Auto-Refocus

When a check queue completes (single item or multi-item), `finishCheckQueue` returns focus to the correct scan input via `requestAnimationFrame` (PREP → main scan input, RETURN → return-tab scan input, RETURN-with-fromDeprep → deploy-tab scan input). This lets barcode scanners flow scan-to-scan without a mouse click between checks. The `requestAnimationFrame` delay lets the Sheet focus trap release before the refocus runs, avoiding a race.

### ⚠️ Which transition fires a check — one policy, `transitionNeedsCheck`

The "does this transition need a check?" decision was copy-pasted across ~7 handlers
in `warehouse/[projectId]/page.tsx` (each re-deriving `modelCheckItems > 0` and
branching on context), which let coverage drift per transition. It now lives in ONE
place: [`src/lib/warehouse-check-policy.ts`](../src/lib/warehouse-check-policy.ts) —
`transitionNeedsCheck(context, { hasCheckItems, fromDeprep })`, plus
`lineHasModelChecks(li)` / `kitHasChecks(kit)` (the deduped inline gates). Every
trigger site routes through it (`startKitCheckFlow` has the central kit guard).
Cross-transition test: `warehouse-check-policy.test.ts`.

**Policy (product decision 2026-07): checks fire at PREP and DE-PREP only.**

Outbound flow: `pick/prep → CHECK → deploy (staging) → on truck`.
Inbound flow: `truck → return → deploy (staging) → CHECK → pick/prep (inventory)`.

- **PREP** (Pick → Prep): the outbound gate — a check runs when the model/kit has
  check items. (Deploy / checkout fires NO check; prep is the gate.)
- **DE-PREP** (shelf-in, `fromDeprep: true`, `context: "RETURN"`): the inbound gate —
  a check runs at the inventory↔staging boundary as gear is stowed.
- **Return-scan** (truck-in, `context: "RETURN"`, no `fromDeprep`): **no check.**
  Previously an additive "dual-check" also ran here; per the product decision the
  return check now runs *only* at de-prep, so the single-item scan, the batch
  "Return Selected", and kit return-scans all return directly (`checkInMutation` /
  `kitCheckInMutation` / `kitBatchInMutation`) without opening the form.

Implementation of the de-prep gate:
- `handleDeprep` intercepts deprep clicks for returned items (`status === "RETURNED"`,
  `prepStatus === "PACKED"`) whose model has check items, and builds a check queue
  with `fromDeprep: true, context: "RETURN"`.
- On submit, the queue dispatches to `completeCheckAndDeprep` (not
  `completeCheckAndStore`) which writes RETURN-context `CheckRecord` rows and resets
  `prepStatus=PENDING` in one transaction — without changing `status` (already RETURNED).
- Items never deployed (outbound deprep) or whose model has no check items bypass the
  form and call `deprepItem` directly.
- Flagged/damaged items (`prepStatus !== "PACKED"`) also bypass the form and deprep
  directly — they route to a fault workflow rather than the standard shelf-in check.
- Kit deprep respects `KitCheckMode` via `startKitCheckFlow(..., fromDeprep=true)`.
  `KIT_LEVEL` kits get one kit-level check; `PER_ITEM` kits get a queue entry per
  child. When the queue finishes, `finishCheckQueue` calls `deprepKit` instead of
  `kitCheckInMutation`.

### Bulk Items in Check Queue
- Each selected bulk unit generates a separate `CheckQueueItem` entry
- `completeCheckAndPack` caps `checkedOutQuantity` at `lineItem.quantity` via `Math.min` to prevent over-counting
- No-check bulk items are prepped directly before the check queue starts (not passed as `directItems` to avoid double-prep)

### Multi-Qty Serialized Items
- When prepping/checking out a serialized item with `quantity > 1` and a specific `assetId`, both `prepItemDirect` and `checkOutItems` split off a new line item with `qty=1` for the assigned asset and decrement the original

## Feature Gate

Models with 0 check items skip the check form entirely. The `model._count.modelCheckItems` count (included in warehouse queries) is checked before opening the form — preserving existing behavior for models without checks. Kit check items use `kit._count.kitCheckItems` similarly.

### Empty check-list guard (defensive)

The warehouse page routes zero-check items to `prepItemDirect`, but two paths can still mount `ItemCheckForm` with an empty list: the brief window while the `getModelCheckItems`/`getKitCheckItems` query is still loading, and the ad-hoc `/check/[assetTag]` page which has no count gate. The form must therefore guard against an empty submit itself.

`allComplete` is computed as `items.length > 0 && items.every(...)`. The `items.length > 0` clause is load-bearing: `Array.prototype.every` returns `true` for an empty array, so without it the submit button (and the keyboard `Enter` path) would be enabled with zero rows and POST an empty `checks[]`. The server schemas in `src/lib/validations/check-item.ts` declare `checks: z.array(...).min(1)`, so an empty array throws an uncaught `ZodError` (`too_small`) → 500. When `items.length === 0`, the form renders a "No check items are configured for this {kit|model}." empty-state instead of a blank form with a dead button. Regression coverage: `src/components/warehouse/__tests__/item-check-form.test.tsx` ("ItemCheckForm with zero check items").

The `ItemCheckForm` is not the only client path that can produce an empty `checks[]`. The **"Pass all remaining"** action (`onPassAllRemaining` on the warehouse page) bypasses the form entirely: for each queued item it fetches `getModelCheckItems`/`getKitCheckItems` live and maps the result straight into `checks`, then calls `completeCheckAndPack` / `completeCheckAndStore` / `saveKitLevelChecks` / `saveChildItemChecks` (all `.min(1)`). The queue itself is built from the **cached** project snapshot's `model._count.modelCheckItems > 0` gate, which can diverge from that live fetch — e.g. an admin removes a model's check items after the warehouse page cached the project. The gate then says "has checks" (queues the item) while the live fetch returns `[]`, so the mapped `checks` is empty and the PREP path 500s with `ZodError` `path: ["checks"]` `too_small min 1`. This bit bulk checkout in production (a bulk line of quantity N queues N units, and a single empty fetch crashes the whole "pass all"). `onPassAllRemaining` now guards `checks.length === 0` and routes each item to its no-check equivalent — `prepItemDirect` (PREP), `completeCheckAndDeprep` (return deprep, which tolerates an empty `checks[]`), `checkInItems` (return store), or a skip for kit-level / kit PER_ITEM children (their deploy/return is finalized in `finishCheckQueue`).

## Predictive Maintenance

After saving check records, if any check item has a FAIL result:
1. Query last 3 CheckRecords for that asset + check item
2. If 2+ are FAIL, auto-create a MaintenanceRecord (type=PREVENTATIVE)
3. Runs in-transaction inside the calling check mutation (`checkPredictiveMaintenanceCore.ts`) — atomic with the check-record write, not a post-commit fire-and-forget.

## Immediate incident report on FAIL

**(GitHub #898, FEATUREDOCS/64 — additional to the predictive trigger above, not a
replacement.)** Every FAIL, not just the 2nd-of-3, immediately opens a linked
`MaintenanceRecord` (`type: REPAIR`, `incidentType: NEEDS_SERVICE`) instead of only
flipping `prepStatus=FLAGGED_FAULTY` — `convex/lib/checkIncidentReportCore.ts`. The
`ItemCheckForm` requires a reason + at least one photo on any FAILed row before the
check can submit. See FEATUREDOCS/64 for the full data-model + entry-point writeup,
including the separate mid-deploy "Report Issue" flow (a different trigger path,
since checks only fire at PREP/DE-PREP — see the policy note above).

## Permissions

- Resource: `checkItem` with actions: read, create, update, delete
- Action: `warehouse.close` for close-out operations
- Default grants: owner/admin/manager get all checkItem actions; member/staff/warehouse get read
- All read server actions enforce `requirePermission("checkItem", "read")` —
  `getCheckItems`, `getCheckItem`, `getModelCheckItems`, `getKitCheckItems`.
  Custom roles without `checkItem.read` cannot see the library at all.

## Notifications

- `flagged_asset` notification type: queries for line items with FLAGGED_FAULTY or FLAGGED_TT_OVERDUE prepStatus

## Search & Navigation

- CheckItem added to global search (label, category, description matching)
- "Check Items" added to Settings page commands for command palette
