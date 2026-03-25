# Warehouse Operations

## UI Terminology
- "Check Out" is displayed as **"Deploy"** in the UI
- "Check In" is displayed as **"Return"** in the UI
- `CHECKED_OUT` status displays as **"Deployed"**
- Internal code (function names, enum values, API params) still uses `checkOut`/`checkIn`/`CHECKED_OUT`

## Three-Phase Warehouse Flow

The warehouse uses a Pick/Prep → Deploy → Return flow. Items are **prepped** (packed) before being **deployed** (checked out).

### Pick/Prep Tab
- Scan or select items to prep
- Container dropdown next to scan input — select a case asset or type a custom container name
- Container assets (from configured case category) auto-added to project on first prep
- `prepItemDirect()` sets `prepStatus=PACKED` and `prepContainer` without deploying (status stays `CONFIRMED`)
- **Unified split approach**: both serialized and bulk multi-qty items use the same split pattern:
  - When prepping 1 unit from a qty > 1 item, a new qty=1 line item is created with `prepStatus=PACKED`
  - For serialized items: the split item gets the assigned `assetId`
  - For bulk items: the split item inherits the `bulkAssetId`
  - The original item's `quantity` decrements by 1
  - When original reaches qty=0, it's hidden from the prep tab
  - When original reaches qty=1, the last unit is prepped in-place (no split)
- Items with no check items assigned are prepped directly; items with checks go through the check queue
- Bulk items display as expandable groups with individual unit rows (Unit 1, Unit 2, etc.) — each unit gets its own check dialog
- `deprepItem()` reverses prep: clears `prepStatus` to PENDING (split items stay as independent line items)

### Deploy Tab
- Shows items with `prepStatus=PACKED` and `quantity > 0` (prepped but not yet deployed)
- Split items (qty=1) flow through the serialized deploy path regardless of whether they have a `bulkAssetId`
- Items grouped by `prepContainer` with section headers (Package icon + container name)
- X button on container headers to clear container assignment
- Container line items auto-deploy when all contents are deployed (`syncContainerStatus`)

### Return Tab
- Shows items with `status === "CHECKED_OUT"` only
- Split bulk items (qty=1 with bulkAssetId) use the serialized return path
- Items grouped by `prepContainer` with section headers (same as Deploy tab)
- Container line items auto-return when all contents are returned (`syncContainerStatus`)

### Scan Flow
- `quickAddAndCheckOut()` adds items to project and **preps** them (sets `status: "CONFIRMED"`, `prepStatus: "PACKED"`) — does NOT deploy directly
- `lookupAssetForScan()` treats scanned serialized assets as serialized (not bulk) even if the matching line item has qty > 1

### Kit/Prep-Kit Flows
- Kit checkout: `checkOutKit()` — atomic transaction updating kit + all member assets + grandchildren
- Kit checkin: `checkInKit()` — same pattern, handles grandchildren and prep-kit assets
- For prep-kit: same `checkOutKit` flow via `ProjectLineItem.assetId` (not `KitSerializedItem`)

## Return Flow (Check In)
1. User selects items to return, specifies condition per item
2. `checkInItems` based on condition:
   - GOOD → asset status `AVAILABLE`, disconnects `assetId` from line item
   - DAMAGED → asset status `IN_MAINTENANCE`, disconnects
   - MISSING → asset status `LOST`, disconnects
3. For kit/prep-kit: `checkInKit` atomically reverses deployment

## Kit Verification
Before deploying or returning a kit (or prep-kit) with unverified items:
- Confirmation dialog shows "X/Y items verified — deploy/return anyway?"
- Verification circles are **clickable** for manual toggle on all children and grandchildren
- `verifiedKitItems` Set tracks confirmed line item IDs
- Checked on all 4 code paths: checkbox deploy, checkbox return, scan deploy, scan return
- `collectAllVerifiableIds(children, mode)` filters by mode: deploy counts non-CHECKED_OUT items, return counts CHECKED_OUT items — so the X/Y badge reflects only relevant items

## Kit Groups in Deploy/Return Tabs
Kits and prep-kits appear as expandable groups in the Deploy and Return tabs. Uses `kit-group` GroupEntry variant. Parent line item has `kitId` set, children have `isKitChild: true`. Checkbox selection routes to `kitCheckOutMutation`/`kitCheckInMutation`.

### Nested Kit Rendering (`KitChildRows`)
Children of a kit/prep-kit that are themselves kits render with:
- Chevron expand/collapse toggle
- Container icon + Kit badge
- Their own indented children (grandchildren) at deeper indent level
- Clickable verification circles on all levels

### Asset Tag Display
- Regular kits: show their asset tag
- Prep-kits with case asset: show the case asset tag
- Auto-generated `PREP-*` tags: hidden (display `—`)

## Prep Containers
Container dropdown on Pick/Prep tab for visual asset grouping. See [Preps](./32-preps.md) for full details.

## Partial Deploy/Return
Kits and prep-kits support partial deployment:
- When not all children are verified, confirmation dialog offers "Deploy Verified Only" or "Deploy All"
- "Deploy Verified" uses `checkOutItems` (individual line items) instead of `checkOutKit` (atomic)
- Partially deployed kits appear in BOTH deploy and return tabs with filtered children per tab
- `KitChildRows` accepts `mode` prop (`"deploy"` or `"return"`) to filter grandchildren per tab
- Parent line item is included in partial deploy only if not already `CHECKED_OUT`
- Nested kit parent line items are automatically included when any of their grandchildren are being deployed verified
- All 4 filter layers (checkOutItemsList, checkedOutItems, groupItems, groupCheckinItems) are grandchild-aware
- `checkOutItems` skips already-deployed line items (status `CHECKED_OUT`) during partial re-deploy instead of throwing

## Availability Checks
When adding assets/kits to projects:
- **Serialized assets**: Only `RETIRED` and `LOST` statuses are blocked. `CHECKED_OUT` assets can still be added.
- **Kits**: Only `IN_MAINTENANCE` and `INCOMPLETE` statuses are blocked. `CHECKED_OUT` kits can still be added.
- This allows planning future projects while equipment is deployed on current ones.

## Conflict Detection
`lookupAssetForScan` checks both line item status AND physical asset status. If asset is `CHECKED_OUT` on another project, returns error with project name/number.

## Cross-Navigation
- **Warehouse → Project**: "View Project" button in warehouse header links to `/projects/[id]`
- **Project → Warehouse**: "Warehouse" button in project header links to `/warehouse/[id]`

## Force Return
When assets or kits are stuck in `CHECKED_OUT` status (e.g., project deleted while items deployed, data inconsistency), "Force Return" buttons allow resetting them to `AVAILABLE`:

### Server Actions (`src/server/warehouse.ts`)
- **`forceReturnAsset(assetId)`** — Finds all CHECKED_OUT line items for the asset across all projects, sets them to RETURNED, resets asset status to AVAILABLE, restores default location (or null). Also dissolves any prep-kits using this asset as a case.
- **`forceReturnKit(kitId)`** — For regular kits: resets kit + all children (including nested kits and grandchildren) to AVAILABLE, sets all related line items to RETURNED, always resets location (even to null). For prep-kits: dissolves entirely (un-parents children, deletes Kit record, returns `{ deleted: true }`).
- **`bulkForceReturnAssets(assetIds)`** — Batch force return for multiple assets in one transaction.

### UI Locations
- **Asset detail page** (`/assets/registry/[id]`): Force Return button in header, visible when `status === "CHECKED_OUT"`
- **Kit detail page** (`/kits/[id]`): Force Return button in header, visible when `status === "CHECKED_OUT"`. Redirects to `/kits` if prep-kit was dissolved.
- **Model detail page** (`/assets/models/[id]`): Per-row Force Return icon button in serialized assets table for each `CHECKED_OUT` asset
- **Asset list page**: Bulk Force Return button in selection bar
- **Kit list page**: Bulk Force Return button in selection bar
- All use `confirm()` pattern, amber text color, `RotateCcw` icon
- Permission: `warehouse.check_in`

## Documents
The warehouse page has a "Documents" dropdown with access to all project PDFs (Pull Slip, Delivery Docket, Return Sheet, Quote, Invoice) — same documents available on the project detail page.

### Deployment-Aware Filtering
- **Delivery Docket**: Only shows deployed items. Kit/prep-kit children are filtered to CHECKED_OUT only. Nested kit grandchildren are also filtered to CHECKED_OUT.
- **Return Sheet**: Only shows deployed/returned items. Kit children filtered to CHECKED_OUT or RETURNED. Nested grandchildren similarly filtered.
- **Pull Slip**: Shows all non-cancelled items. Already-deployed items display with a filled checkbox (tick) instead of an empty one. Bulk per-unit rows tick the first N units matching `checkedOutQuantity`. Kit children and nested grandchildren also show ticked/unticked based on their deployment status.
- **Quote / Invoice**: Show all items regardless of deployment status (for pricing).

### Total Item Counts
- **Pull Slip** and **Delivery Docket** display a "Total Items" count in the header info section.
- Kit/prep-kit parents are NOT counted as 1 — instead, all individual children and nested kit grandchildren are counted.
- Delivery docket counts only deployed children (`CHECKED_OUT`). Pull slip counts all children.

## Online Pick List
Dialog with full item list showing deployment status per line item. Mobile full-screen with safe area padding. Kit and prep-kit groups show as expandable sections with children.

## Warehouse Dashboard Display (TV Screen)

### Overview
A public, token-authenticated dashboard page designed for wall-mounted TVs/monitors in the warehouse. Shows today's dispatch, returns, prep status, and upcoming schedule. Dark background, large text readable from 3+ metres, auto-refreshes every 60 seconds, no interactive elements.

### Data Model
`WarehouseDashboardToken` — stores access tokens scoped to an organization and optional location. Fields: `name`, `token` (raw hex token for URL display), `tokenHash` (SHA-256, unique, for lookup), `locationId` (optional location scope), `layout` ("standard", "compact", "dispatch-only"), `isActive`, `createdById`, `lastAccessedAt`.

### Access
- URL pattern: `/warehouse/display/{token}` (64-char hex token)
- Token is generated in Settings > Displays
- URL is viewable any time via the edit dialog (raw token stored in DB)
- No login required — added to middleware public routes
- API endpoint: `GET /api/warehouse/display/{token}` returns JSON data

### Settings UI
`/settings/displays` — create, list, edit, and revoke display tokens. Each token has a name, optional warehouse location scope, and layout selection.
- **Create**: Shows URL on creation with copy button
- **Edit** (pencil icon): Change name, location, and layout. Shows current display URL with copy button. Regenerate URL button (invalidates old URL, generates new one).
- **Revoke** (trash icon): Deletes the token permanently

### Display Layouts
| Layout | Description |
|--------|-------------|
| **standard** | Full dashboard: dispatch, returns, prep status, 7-day upcoming, alerts |
| **compact** | Dispatch + returns only, larger text |
| **dispatch-only** | Today's dispatch with large prep status cards |

### Dashboard Sections
- **Today's Dispatch**: Projects with delivery services or loadIn/rentalStart today. Shows delivery time, destination, vehicle, pack progress (green/amber/red).
- **Returns Due Today**: Projects with pickup services or loadOut/rentalEnd today. Shows due time and expected item count.
- **Prep Status**: Compact cards for projects being prepped (CONFIRMED/PREPPING). Shows packed/total items with progress bar.
- **Upcoming (7 days)**: Day grid showing dispatch and return counts per day.
- **Alerts**: Unprepped dispatches, partially packed dispatches, overdue returns.

### Server Actions (`src/server/warehouse-display.ts`)
- `getDisplayTokens()` — list tokens for the org (includes raw token for URL display)
- `createDisplayToken({ name, locationId?, layout? })` — generates token, stores raw + hash, returns raw token + record
- `updateDisplayToken(id, { name?, locationId?, layout? })` — update display settings
- `regenerateDisplayToken(id)` — generates new token (invalidates old URL), returns new raw token
- `revokeDisplayToken(id)` — deletes the token
- `getWarehouseDisplayData(orgId, locationId?)` — assembles all dashboard data
- `validateDisplayToken(rawToken)` — hash-validates, updates lastAccessedAt

### Integration Points
- Services: Delivery/pickup services drive dispatch/return sections, falls back to project dates
- Location scoping: Tokens with `locationId` filter to projects at that location
- Activity log: Token creation/revocation logged
- Middleware: `/warehouse/display/` and `/api/warehouse/display/` are public routes
