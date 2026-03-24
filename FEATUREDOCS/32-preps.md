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

No separate container table exists. The container name is denormalized onto each line item.

### Container Sources
1. **Case category assets** — Assets from the org's configured case category (`prepKitCategoryId` in org settings). Searched via `searchContainerAssets()` in `src/server/categories.ts`.
2. **Custom names** — Users can type any name in the creatable combobox to create ad-hoc container names.
3. **Existing containers** — Any `prepContainer` value already set on project line items appears in the dropdown.

## Server Actions

### `searchContainerAssets(query)` — `src/server/categories.ts`
Searches assets in the configured case category tree (BFS from `prepKitCategoryId`). Returns `{ value, label }[]` for the combobox. Limited to 20 results.

### `clearPrepContainer(projectId, containerName)` — `src/server/warehouse.ts`
Nulls out `prepContainer` on all line items matching the given container name. Used by the X button on container headers.

### Modified Actions
- **`prepItemDirect()`** — Accepts optional `prepContainer` parameter (6th arg). Sets `prepContainer` on the line item during prep.
- **`completeCheckAndPack()`** — Reads `prepContainer` from the submitted check data and sets it on the line item.
- **`quickAddAndCheckOut()`** — Accepts `prepContainer` in the data object, sets it on the created line item.

## UI

### Container Dropdown (Pick/Prep Tab)
Located next to the scan input on the Pick/Prep tab:
- `ComboboxPicker` with `creatable` and `allowClear` props
- Options merged from: case category assets + existing `prepContainer` values on line items
- When a container is selected, all subsequent prep operations tag items with that container name
- "No container" (empty) means items are prepped without grouping

### Container Groups (Deploy Tab)
Items in the Deploy tab are grouped by `prepContainer`:
- Section headers with Package icon and container name
- Items without a container appear at the bottom (ungrouped)
- X button on each container header to clear the container assignment from all items in that group
- Groups sorted alphabetically, ungrouped last

### Settings
- **Prep Containers** section in Settings > Assets (`src/app/(app)/settings/assets/page.tsx`)
- Category dropdown to select which asset category contains cases/containers
- Uses `prepKitCategoryId` org setting (shared with the old system, name kept for migration compatibility)

## Permissions
- Uses existing `warehouse.check_out` for prep operations and container clearing
- No additional permissions needed — container management is part of warehouse workflow
