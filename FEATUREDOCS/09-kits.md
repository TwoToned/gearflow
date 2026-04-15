# Kit System

## Data Model
- `Kit` has own `assetTag`, `status`, `condition`
- `Kit.checkMode`: `KIT_LEVEL` (default) or `PER_ITEM` — controls whether kit-level check items are used or each child uses its model's checks
- Contents: `KitSerializedItem[]` (Kit → Asset, one asset per kit) and `KitBulkItem[]` (Kit → BulkAsset with quantity)
- `KitCheckItem[]`: check items assigned to the kit (used when `checkMode=KIT_LEVEL`)
- Join tables use `addedAt` (not `createdAt`), plus `position`, `sortOrder`, `addedById`, `notes`

## Line Item Representation
- Parent line item: `kitId` set, `isKitChild: false`, `pricingMode` = `KIT_PRICE` or `ITEMIZED`
- Child line items: `isKitChild: true`, `parentLineItemId` pointing to parent
- Detection: `!!lineItem.kitId && !lineItem.isKitChild` = kit parent
- Children can themselves be kits (nested kits)

## Nested Kits
- A kit inside another kit becomes a child line item with its own `kitId`
- Queries must include 2 levels of `childLineItems` with `kit: true` to render nested kit contents
- This applies to: warehouse page, project page, PDF document API route, pull sheet queries
- UI renders nested kits with chevron expand, Container icon, Kit badge, and indented grandchildren

## Pricing Modes
- **KIT_PRICE**: Single price on parent row, children have `unitPrice: 0`
- **ITEMIZED**: Individual prices on each child row, parent has `unitPrice: 0`

## Warehouse Operations
- Kit checkout: `checkOutKit()` — atomic transaction updating kit + all member assets + grandchildren (nested kits)
- Kit checkin: `checkInKit()` — same pattern, handles grandchildren
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

## Force Return
- `forceReturnKit()` resets kit + all children (including nested kits and grandchildren) to AVAILABLE, sets line items to RETURNED, always resets location (even to null if no default)
- Bulk force return available from kit list page selection bar

## Delete Kit
- Two-tier delete exposed via `DeleteKitDialog` on the kit detail page
- `archiveKit()` (soft): releases serialized assets, restores bulk quantities, sets `isActive=false, status=RETIRED`. Always available while kit is AVAILABLE + active
- `deleteKit()` (hard): blocked when any `ProjectLineItem` references the kit (historical data preservation). Transaction clears `kitId` on assets, deletes `KitSerializedItem`/`KitBulkItem`/`KitCheckItem`, removes the `Kit` row
- `canDeleteKit(id)` predicate feeds the dialog: returns `{ canArchive, canHardDelete, referencingLineItems, reason }` so the UI disables the hard-delete option with a human-readable reason
- Permission gate: `kit:delete`

## Group Templates with Kit Items
- `GroupTemplateItem` supports **either** a `modelId` **or** a `kitId` (Zod XOR refine in `src/lib/validations/group-template.ts`)
- Enables flexible packages: a "Drum Mic Kit" template = 2x SM57 model + 3x e904 model; a "FOH Package" template = 2x SM57 model + 1x rack kit (rigid)
- `saveGroupAsTemplate` captures both model-backed and kit-backed parent line items from the source group (skips free-text lines and `isKitChild` rows)
- `applyGroupTemplate` splits template items into model vs kit at apply time:
  - Model items are created as `ProjectLineItem` rows inside the same transaction as the new `ProjectGroup` (rate pulled from the model at project's rental period)
  - Kit items are delegated to `addKitLineItem(projectId, kitId, "ITEMIZED", undefined, undefined, categoryId, groupId)` **after** the tx commits, once per unit of `quantity` (so "2x rack kit" becomes two independent parent rows, matching physical pull behavior)
  - Each kit expansion is wrapped in try/catch: conflicts (e.g., kit already on an overlapping project) are collected as `warnings[]` rather than aborting the whole apply, so warehouse staff still get the model items
  - Kit expansion runs its own availability check and its own transaction for parent + children + grandchildren
- Project totals are recalculated via `recalculateProjectTotals()` when any kit items were expanded
- Activity log summary includes skipped kit warnings
