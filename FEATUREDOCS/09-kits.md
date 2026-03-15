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
- Kit checkout: `checkOutKit()` — atomic transaction updating kit + all member assets
- Kit checkin: `checkInKit()` — same atomic pattern
- If scanning a member asset, warehouse shows "scan the kit instead"
- In warehouse UI, kit items detected by `kitId` must route to `kitCheckOutMutation`, NOT regular `checkOutItems`

## Kit Verification
- Before deploying or returning a kit, unverified items trigger a confirmation dialog
- `verifiedKitItems` Set tracks confirmed asset IDs
- Verification circles are clickable (manual toggle) for all children and grandchildren — not scan-only
- Dialog shows "X/Y items verified" with option to proceed or cancel
- Applies to both regular kits and prep-kits
