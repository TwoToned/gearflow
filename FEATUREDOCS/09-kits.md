# Kit System

## Data Model
- `Kit` has own `assetTag`, `status`, `condition`, `isPrep` (default `false`)
- Contents: `KitSerializedItem[]` (Kit → Asset, one asset per kit) and `KitBulkItem[]` (Kit → BulkAsset with quantity)
- Join tables use `addedAt` (not `createdAt`), plus `position`, `sortOrder`, `addedById`, `notes`
- `isPrep: true` kits are temporary prep-kits — see [Preps](./32-preps.md) for full details

## Line Item Representation
- Parent line item: `kitId` set, `isKitChild: false`, `pricingMode` = `KIT_PRICE` or `ITEMIZED`
- Child line items: `isKitChild: true`, `parentLineItemId` pointing to parent
- Detection: `!!lineItem.kitId && !lineItem.isKitChild` = kit parent
- Children can themselves be kits (nested kits) — e.g., a kit inside a prep-kit

## Nested Kits
- A kit added to a prep-kit becomes a child line item with its own `kitId`
- Queries must include 2 levels of `childLineItems` with `kit: true` to render nested kit contents
- This applies to: warehouse page, project page, PDF document API route, pull sheet queries
- UI renders nested kits with chevron expand, Container icon, Kit badge, and indented grandchildren

## Pricing Modes
- **KIT_PRICE**: Single price on parent row, children have `unitPrice: 0`
- **ITEMIZED**: Individual prices on each child row, parent has `unitPrice: 0`

## Warehouse Operations
- Kit checkout: `checkOutKit()` — atomic transaction updating kit + all member assets + grandchildren (nested kits) + prep-kit child assets (via `ProjectLineItem.assetId`)
- Kit checkin: `checkInKit()` — same pattern, handles grandchildren and prep-kit assets
- `checkOutItems` skips already-deployed line items during partial re-deploy (no "already deployed" errors)
- If scanning a member asset, warehouse shows "scan the kit instead"
- In warehouse UI, kit items detected by `kitId` must route to `kitCheckOutMutation`, NOT regular `checkOutItems`

## Kit Verification
- Before deploying or returning a kit, unverified items trigger a confirmation dialog
- `verifiedKitItems` Set tracks confirmed line item IDs
- Verification circles are clickable (manual toggle) for all children and grandchildren — not scan-only
- `collectAllVerifiableIds(children, mode)` filters by mode: deploy counts non-CHECKED_OUT items, return counts CHECKED_OUT items
- Dialog shows "X/Y items verified" with option to proceed or cancel
- "Deploy Verified" automatically includes nested kit parent line items when grandchildren are verified
- Applies to both regular kits and prep-kits

## Force Return
- **Regular kits**: `forceReturnKit()` resets kit + all children (including nested kits and grandchildren) to AVAILABLE, sets line items to RETURNED, always resets location (even to null if no default)
- **Prep-kits**: `forceReturnKit()` dissolves entirely — un-parents children, deletes Kit record, returns `{ deleted: true }`
- `forceReturnAsset()` also dissolves any prep-kits using the asset as a case
- Bulk force return available from kit list page selection bar
