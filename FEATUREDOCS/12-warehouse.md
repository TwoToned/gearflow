# Warehouse Operations

## UI Terminology
- "Check Out" is displayed as **"Deploy"** in the UI
- "Check In" is displayed as **"Return"** in the UI
- `CHECKED_OUT` status displays as **"Deployed"**
- Internal code (function names, enum values, API params) still uses `checkOut`/`checkIn`/`CHECKED_OUT`

## Deploy Flow (Check Out)
1. User opens project in warehouse view (`/warehouse/[projectId]`)
2. Scans barcode or selects asset from dropdown
3. `lookupAssetForScan` validates: asset exists, matches a line item model, not already deployed elsewhere
4. For serialized: `checkOutItems` assigns `assetId` to line item, sets asset status to `CHECKED_OUT`
5. For bulk: increments `checkedOutQuantity` on line item, decrements `availableQuantity` on bulk asset
6. For kit: `checkOutKit` atomically updates kit + all member assets + all child line items
7. For prep container: `checkOutPrep` atomically deploys container + all packed items (see [Preps](./32-preps.md))

## Return Flow (Check In)
1. User selects items to return, specifies condition per item
2. `checkInItems` based on condition:
   - GOOD → asset status `AVAILABLE`, disconnects `assetId` from line item
   - DAMAGED → asset status `IN_MAINTENANCE`, disconnects
   - MISSING → asset status `LOST`, disconnects
3. For kit: `checkInKit` atomically reverses deployment

## Prep Container Detection
`lookupAssetForScan` checks if a scanned asset is a prep container (`type: "prep_container"`) or a member of a prep (`type: "prep_member"`). Prep containers trigger atomic bulk checkout/return. Prep members prompt the user to scan the container instead.

## Conflict Detection
`lookupAssetForScan` checks both line item status AND physical asset status. If asset is `CHECKED_OUT` on another project, returns error with project name/number.

## Cross-Navigation
- **Warehouse → Project**: "View Project" button in warehouse header links to `/projects/[id]`
- **Project → Warehouse**: "Warehouse" button in project header links to `/warehouse/[id]`

## Documents
The warehouse page has a "Documents" dropdown with access to all project PDFs (Pull Slip, Delivery Docket, Return Sheet, Quote, Invoice) — same documents available on the project detail page.

## Prep Groups in Deploy/Return Tabs
After checkout, preps appear as expandable groups in the Deploy and Return tabs — identical to how kits display. Uses `prep-group` GroupEntry variant with purple "Prep" badge. Parent line item has `prepId` set, children have `isPrepChild: true`. Checkbox selection routes to `prepCheckOutMutation`/`prepCheckInMutation`. See [Preps](./32-preps.md) for full architecture.

## Preps Tab
Third tab on warehouse page (`?tab=preps`). Create preps, scan items into them, mark packed, deploy, return, unpack. See [Preps](./32-preps.md) for full details.

## Online Pick List
Dialog with full item list showing deployment status per line item. Mobile full-screen with safe area padding. Kit and prep groups show as expandable sections with children.
