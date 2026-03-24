# Prep Containers (Visual Grouping for Project Staging)

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
1. **Case category assets** — Assets from the org's configured case category (`prepKitCategoryId` in org settings). Searched via `searchContainerAssets()` in `src/server/categories.ts`. Dropdown shows asset tag alongside the name.
2. **Custom names** — Users can type any name in the creatable combobox to create ad-hoc container names.
3. **Existing containers** — Any `prepContainer` value already set on project line items appears in the dropdown.

## Server Actions

### `searchContainerAssets(query)` — `src/server/categories.ts`
Searches assets in the configured case category tree (BFS from `prepKitCategoryId`). Returns `{ value, label, assetId, assetTag, modelId }[]` for the combobox. Shows asset tag in labels. Supports searching by asset tag, custom name, or model name. Limited to 20 results.

### `clearPrepContainer(projectId, containerName)` — `src/server/warehouse.ts`
Nulls out `prepContainer` on all line items matching the given container name. Used by the X button on container headers.

### `ensureContainerOnProject(projectId, assetId, modelId, containerName)` — `src/server/warehouse.ts`
Adds a container asset to the project as a line item with `isContainerLineItem: true` if not already present. Called automatically when prepping the first item into a container asset. The container line item gets `prepContainer` set to its own container name and `prepStatus: PACKED`.

### `syncContainerStatus(projectId, containerName)` — `src/server/warehouse.ts`
Checks if all non-container items in a container are deployed or returned, and auto-updates the container line item's status accordingly:
- All deployed → container auto-deployed (status: `CHECKED_OUT`, asset status: `CHECKED_OUT`)
- All returned → container auto-returned (status: `RETURNED`, asset status: `AVAILABLE`)
Called after every `checkOutItems` and `checkInItems` operation.

### Modified Actions
- **`prepItemDirect()`** — Accepts optional `prepContainer` parameter (6th arg). Sets `prepContainer` on the line item during prep.
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
