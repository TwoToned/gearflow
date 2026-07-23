# Prep Containers (Visual Grouping for Project Staging)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Overview
Prep containers provide **visual grouping** of assets during the Pick/Prep phase of warehouse operations. When a warehouse operator selects a container (a physical case, custom name, or case category asset) and then preps an asset, that asset is tagged with the container name. This grouping carries into the Deploy tab as section headers so operators can see which assets are packed together.

Containers are **not backed by kits** — they are purely a `prepContainer` string field on `ProjectLineItem`. There are no bulk operations on containers (no bulk deploy/return). Each item is still deployed/returned individually.

## Data Model

### `ProjectLineItem.prepContainer`
- Type: `String?` (nullable)
- Stores the container name/label for visual grouping
- Set during prep (Pick/Prep tab scan) based on the currently selected container
- Cleared via the X button on container headers in the Deploy tab

### `ProjectLineItem.isContainerLineItem`
- Type: `Boolean` (default: `false`)
- Marks line items that represent the physical container asset itself
- Container line items are hidden from equipment lists and auto-managed
- Auto-deployed when all contents are deployed, auto-returned when all contents are returned

### Container Sources
1. **Case category assets** — Assets from the org's configured case category (`prepKitCategoryId` in org settings). Searched via the `containerAssetSearch` query in `convex/categories.ts`. Dropdown shows asset tag alongside the name.
2. **Custom names** — Users can type any name in the creatable combobox to create ad-hoc container names.
3. **Existing containers** — Any `prepContainer` value already set on project line items appears in the dropdown.

## Server Actions

Container operations are now browser-direct Convex mutations (see
[54-convex-data-layer](./54-convex-data-layer.md)), called via
`src/hooks/use-warehouse-writes.ts`.

### `containerAssetSearch(query)` — `convex/categories.ts`
Searches assets in the configured case category tree (BFS from `prepKitCategoryId`). Returns `{ value, label, assetId, assetTag, modelId }[]` for the combobox. Shows asset tag in labels. Supports searching by asset tag, custom name, or model name. Limited to 20 results.

### `clearPrepContainer(projectId, containerName)` — `convex/warehouseWrites.ts`
Nulls out `prepContainer` on all line items matching the given container name. Used by the X button on container headers.

### `ensureContainerOnProject(projectId, assetId, modelId, containerName)` — `convex/warehouseWrites.ts`
Adds a container asset to the project as a line item with `isContainerLineItem: true` if not already present. Called automatically when prepping the first item into a container asset. The container line item gets `prepContainer` set to its own container name and `prepStatus: PACKED`.

### `syncContainersBatch(projectId, containerNames)` — `convex/warehouseWrites.ts`
Checks if all non-container items in a container are deployed or returned, and auto-updates the container line item's status accordingly:
- All deployed → container auto-deployed (status: `CHECKED_OUT`, asset status: `CHECKED_OUT`)
- All returned → container auto-returned (status: `RETURNED`, asset status: `AVAILABLE`)
Called after every checkout/checkin operation. (The old singular `syncContainerStatus` was dropped — no live caller — in favour of the batched version.)

### Batched prep (`prepItemsBatch`)
Bulk prep flows ("Prep Selected", finish-check-queue direct prep, asset-picker
confirm) used to fire **one `prepItemDirect` server round-trip per unit** — up to
`items × quantity` (dozens) sequential network calls, which is the felt slowness
on large preps. `prepItemsBatch(projectId, items[])` (`src/server/check-records.ts`)
collapses that into **one** server round-trip backed by a single atomic Convex
mutation `checkRecordOps.prepItems`, which loops `prepUnit` over the items **in
array order** — reproducing the exact sequence (and the "sequential to avoid
same-`lineItemId` races" ordering) of the old loop. Callers pre-expand quantity
into one entry per unit (a bulk-no-check line of qty 3 → three `{quantity:1}`
entries) so the server replays the identical `prepUnit` calls. The blocking-comment
gate is read once (project summary + line groups) instead of per item; a
project/line/group blocker fails the whole (atomic) batch, matching the old loop's
throw-on-first-blocked behaviour. Parity with the per-item loop was originally proven in
`src/server/warehouse-prep.int.test.ts` ("prepItemsBatch — parity …"); that Prisma-backed
int test was deleted in the Phase 3 Convex-native decommission (dropped domain tables) —
no direct Convex-side parity test currently covers `checkRecordOps.prepItems`. See
`../docs/designs/archive/bulk-operations-batching.md` (Wave 1a).

### Modified Actions
- **`prepItemDirect()`** — Accepts optional `prepContainer` parameter (6th arg). Sets `prepContainer` on the line item during prep. Still used for genuine single-item preps (drag-drop, single scan); bulk loops now use `prepItemsBatch`.
- **`completeCheckAndPack()`** — Reads `prepContainer` from the submitted check data and sets it on the line item.
- **`quickAddAndCheckOut()`** — Accepts `prepContainer` in the data object, sets it on the created line item.

## UI

### Container Dropdown (Pick/Prep Tab)
Located next to the scan input on the Pick/Prep tab:
- `ComboboxPicker` with `creatable` and `allowClear` props
- Options merged from: case category assets + existing `prepContainer` values on line items
- Case category assets show asset tag in the label (e.g., "Pelican 1510 — CASE001")
- Search filters on label, value, and description (supports asset tag search)
- When a container is selected, all subsequent prep operations tag items with that container name
- "No container" (empty) means items are prepped without grouping
- Selecting a container asset auto-adds it to the project on first prep

### Container Groups (Deploy & Return Tabs)
Items in the Deploy and Return tabs are grouped by `prepContainer`:
- Section headers with Package icon and container name
- Items without a container appear at the bottom (ungrouped)
- X button on each container header in Deploy tab to clear the container assignment
- Groups sorted alphabetically, ungrouped last
- Container line items are hidden from the table (auto-managed)

### PDF Documents
Container grouping appears on all generated PDFs (packing list, delivery docket, return sheet, quote, invoice):
- Items with `prepContainer` are grouped under the container name as a section header (uses `groupName` fallback)
- Container line items (`isContainerLineItem`) are excluded from PDFs — they are not real equipment
- If an item has both `groupName` and `prepContainer`, `groupName` takes precedence

### Settings
- **Prep Containers** section in Settings > Assets (`src/app/(app)/settings/assets/page.tsx`)
- Category dropdown to select which asset category contains cases/containers
- Uses `prepKitCategoryId` org setting (shared with the old system, name kept for migration compatibility)

## Permissions
- Uses existing `warehouse.check_out` for prep operations and container clearing
- No additional permissions needed — container management is part of warehouse workflow
