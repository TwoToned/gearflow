# Preps (Pre-Packing & Warehouse Staging)

## Overview
Preps allow warehouse staff to pre-allocate assets into physical containers before checkout. They work like temporary kits — items are scanned into a prep during packing, then at checkout a parent-child line item structure is created (mirroring how kits work). Scanning a container at checkout deploys all contents atomically. Preps are project-specific and dissolved on unpack.

## Data Model

### `Prep`
- `id`, `organizationId`, `projectId`, `name`, `containerAssetId?` (unique, links to Asset)
- `status`: `PACKING` | `PACKED` | `CHECKED_OUT` | `RETURNED` | `UNPACKED` | `CANCELLED`
- `preparedById`, `preparedAt`, `checkedOutAt`, `returnedAt`, `unpackedAt`, `notes`
- Relations: `items: PrepItem[]`, `lineItems: ProjectLineItem[]` (via `PrepLineItems`), `containerAsset: Asset?`, `project: Project`, `preparedBy: User?`
- Indexes: `organizationId`, `projectId`, `containerAssetId`

### `PrepItem`
- `id`, `prepId`, `assetId?`, `bulkAssetId?`, `kitId?`, `quantity` (for bulk), `lineItemId?`
- `addedAt`, `addedById`, `sortOrder`
- Unique: `[prepId, assetId]` (each asset in at most one prep)
- Relations: `prep: Prep`, `asset: Asset?`, `bulkAsset: BulkAsset?`, `kit: Kit?`, `lineItem: ProjectLineItem?`, `addedBy: User?`

### `ProjectLineItem` — Prep Fields
- `prepId: String?` — set on the parent line item, points to the Prep record
- `isPrepChild: Boolean @default(false)` — true on child rows grouped under a prep parent
- Uses shared `parentLineItemId` / `childLineItems` relation (same as kits)
- Parent line item created at checkout time (not at pack time)

## Two-Phase Lifecycle

### Phase A: PACKING (PrepItem is source of truth)
```
CREATE -> PACKING -> PACKED
```
- Staff scan items into the prep, creating `PrepItem` records
- Assets are pre-assigned to matched line items (`lineItem.assetId = asset.id`)
- No parent line item exists yet — prep appears only in the Preps tab

### Phase B: CHECKOUT onwards (ProjectLineItem parent-child structure)
```
CHECKED_OUT -> RETURNED -> UNPACKED
```
- `checkOutPrep` creates a parent `ProjectLineItem` with `prepId` set
- Matched line items become children (`isPrepChild: true`, `parentLineItemId` set)
- Prep groups now appear in Deploy/Return tabs (like kits)
- `unpackPrep` dissolves the structure: children become standalone, parent deleted

### Bulk Quantity Splitting
When a prep takes a partial quantity (e.g., 4 of 8 battery chargers):
- At checkout: original line item reduced to 4x, new child created for 4x under prep parent
- At unpack: child merged back, original restored to 8x

## Server Actions (`src/server/preps.ts`)

### CRUD
- `createPrep(data)` — Creates prep with name, optional container asset
- `updatePrep(id, data)` — Update name, notes
- `deletePrep(id)` — Delete (only if not CHECKED_OUT)
- `getProjectPreps(projectId)` — List preps for a project
- `getPrepById(id)` — Get single prep with items

### Packing
- `addPrepItem(prepId, assetTag)` — Scan asset into prep. Auto-matches to unassigned line item on the project. Works for serialized assets, bulk assets, and kits.
- `addBulkPrepItem(prepId, bulkAssetId, quantity)` — Add bulk asset with quantity
- `removePrepItem(itemId)` — Remove item from prep (only when PACKING). Unassigns assetId from line item.

### Status Transitions
- `markPrepPacked(id)` — PACKING -> PACKED
- `reopenPrep(id)` — PACKED -> PACKING
- `checkOutPrep(prepId)` — Atomic: creates parent line item, re-parents children, handles bulk splits, deploys container + all items
- `checkInPrep(prepId, conditions?)` — Returns container + all items, updates prep parent line item to RETURNED. Children stay parented for Return tab display.
- `unpackPrep(id)` — RETURNED -> UNPACKED. Dissolves parent-child structure, merges split bulk quantities.

### Lookup
- `lookupPrepByContainerScan(assetTag, projectId)` — Find prep by container asset tag
- `lookupPrepByContainerAssetId(assetId)` — Find prep by container asset ID

## Warehouse Integration

### Scanner Detection (`lookupAssetForScan`)
- **`prep_container`**: Scanning a container asset returns `type: "prep_container"` with `prepId`, `prepItemCount`
- **`prep_member`**: Scanning an asset inside a prep returns `type: "prep_member"` with prep info and message to scan the container instead

### Atomic Checkout (`checkOutPrep`)
1. Creates prep parent line item (`prepId` set, `isPrepChild: false`, description = prep name)
2. Re-parents matched line items as children (`isPrepChild: true`, `parentLineItemId` set)
3. For partial bulk quantities: splits the line item (reduces original, creates child)
4. Checks out the container asset itself (if tracked)
5. Updates all asset statuses to `CHECKED_OUT`
6. Creates scan log entry

### Atomic Check-in (`checkInPrep`)
1. Returns all assets, updates statuses based on condition
2. Updates prep parent line item to `RETURNED`
3. Children remain parented (visible as group in Return tab)

### Unpack (`unpackPrep`)
1. Merges split bulk quantities back to original line items
2. Un-parents non-bulk children
3. Deletes the prep parent line item
4. Marks prep `UNPACKED`

## UI

### Warehouse Page — Deploy/Return Tabs
- Prep groups render like kit groups: expandable parent row with purple "Prep" badge, indented children
- `GroupEntry` type includes `prep-group` variant alongside `kit-group`
- `isPrepParent(item)` predicate: `!!item.prepId && !item.isPrepChild`
- Checkbox selection routes to `prepCheckOutMutation` / `prepCheckInMutation`

### Warehouse Page — Preps Tab (`/warehouse/[projectId]?tab=preps`)
- Component: `src/components/warehouse/preps-tab.tsx`
- Lists preps with status badges, item counts, container info
- "New Prep" button creates a prep for the project
- Each prep card opens a detail dialog with scanner for packing

### PDF Documents
- Prep parent items show as group headers (like kit groups) with `[Prep]` prefix
- Prep children render as indented sub-rows
- Filters exclude `isPrepChild` items from top-level lists

### Pull Sheet / Pick List
- Pull sheet data annotates line items with `preppedIn` (prep name)
- Pick list shows prep groups like kit groups with expandable children

## Permissions
- Uses `warehouse.prep` permission for CRUD and packing operations
- Uses `warehouse.check_out` and `warehouse.check_in` for deploy/return
- All roles with warehouse access get `prep` permission by default

## Validation Schemas (`src/lib/validations/prep.ts`)
- `createPrepSchema` — projectId, name, containerAssetId?, notes?
- `updatePrepSchema` — name?, notes?
- `addPrepItemSchema` — prepId, assetTag
- `addBulkPrepItemSchema` — prepId, bulkAssetId, quantity

## Prep vs Kit
| | Kit | Prep |
|---|---|---|
| Purpose | Permanent physical container | Temporary project-specific packing |
| Lifecycle | Created once, reused across projects | Created per project, dissolved on unpack |
| Contents | Fixed membership (KitSerializedItem, KitBulkItem) | Dynamic (PrepItem, packed for one job) |
| Container | Kit IS the container (has own asset tag) | Container is optional (any tracked asset) |
| Partial qty | Not supported (whole kit) | Supported (split bulk line items) |
| Line items | Created when kit added to project | Created at checkout time |
| On documents | Kit group header with children | Prep group header with children |
| Parent field | `kitId` on ProjectLineItem | `prepId` on ProjectLineItem |
| Child field | `isKitChild` | `isPrepChild` |
| Shared | `parentLineItemId`, `childLineItems` relation | Same |
