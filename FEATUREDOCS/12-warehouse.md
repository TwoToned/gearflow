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
7. For prep-kit: same `checkOutKit` flow — prep-kits share the kit deploy/return path

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
- `verifiedKitItems` Set tracks confirmed asset IDs
- Checked on all 4 code paths: checkbox deploy, checkbox return, scan deploy, scan return

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

## Preps Tab
Third tab on warehouse page (`?tab=preps`). Create prep-kits, scan items into them, deploy, return, dissolve. See [Preps](./32-preps.md) for full details.

## Conflict Detection
`lookupAssetForScan` checks both line item status AND physical asset status. If asset is `CHECKED_OUT` on another project, returns error with project name/number.

## Cross-Navigation
- **Warehouse → Project**: "View Project" button in warehouse header links to `/projects/[id]`
- **Project → Warehouse**: "Warehouse" button in project header links to `/warehouse/[id]`

## Documents
The warehouse page has a "Documents" dropdown with access to all project PDFs (Pull Slip, Delivery Docket, Return Sheet, Quote, Invoice) — same documents available on the project detail page.

## Online Pick List
Dialog with full item list showing deployment status per line item. Mobile full-screen with safe area padding. Kit and prep-kit groups show as expandable sections with children.
