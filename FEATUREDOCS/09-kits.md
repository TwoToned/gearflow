# Kit System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Kits List Page (`src/app/(app)/kits/page.tsx`)
Server-side paginated: `kits.listPage` (filter/sort/category+location joins done in
Convex, one query per page) via `useAuthedQuery`, not a whole-org live subscription
(perf fix, 2026-07 — see `docs/designs/perf-convex-efficiency-2026-06.md` Finding #1).
Member-item counts + primary photo are a separate, cross-domain, non-reactive merge
(`useKitCounts`) applied after the paginated fetch.

## Data Model
- `Kit` has own `assetTag`, `status`, `condition`
- `Kit.checkMode`: `KIT_LEVEL` (default) or `PER_ITEM` — controls whether kit-level check items are used or each child uses its model's checks
- Contents: `KitSerializedItem[]` (Kit → Asset, one asset per kit) and `KitBulkItem[]` (Kit → BulkAsset with quantity)
- `KitCheckItem[]`: check items assigned to the kit (used when `checkMode=KIT_LEVEL`)
- Join tables use `addedAt` (not `createdAt`), plus `position`, `sortOrder`, `addedById`, `notes`

## Kit Form (`KitForm`)
`src/components/kits/kit-form.tsx` — the create/edit form (`/kits/new` +
`/kits/[id]/edit`, edit pre-fills, both reuse the component), on the shared
`SmartFormLayout` shell (see [08-assets § Shared shell](./08-assets.md)). Helper
rail + live preview, single clean page, "More details" accordion.

- **Sections:** Identity (name, asset tag — `AssetTagInput` mono, pre-filled via
  `peekNextAssetTags(1)`; category + location `ComboboxPicker`, location with
  inline `QuickCreateLocation`; status / condition / check-mode registry `Select`s
  with explicit `SelectValue` children) → **Contents** (kit membership is managed
  on the kit's detail page, NOT in this form — the section links there once the kit
  exists; the create/edit form has never carried a member builder) → Case
  information (case type / dimensions / weight) → "More details" accordion
  (purchase date / price, description, notes, tags).
- **Check mode** — the field-level hint switches copy between `KIT_LEVEL`
  ("checked once, contents inherit") and `PER_ITEM` ("each asset gets its own model
  checks"), preserving the original behaviour.
- **Live preview** — kit card (`Boxes` icon + name + asset tag in mono + status
  pill via `StatusIndicator category="kit"` + a check-mode chip).
- **Preserved:** same `kitSchema`, all fields, and `kit` create/update permission
  gates on the route pages. Native `<select>` for status / condition / checkMode
  swapped for registry `Select`. Submit is browser-direct via `useKitWrites()`
  (`src/hooks/use-kit-writes.ts`), calling `convex/kitWrites.ts`'s
  `createNative` / `updateNative` mutations (the old `createKit` / `updateKit`
  server actions are gone).

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
- No discount concept exists for kits today (unlike individual line items, which
  have a `discount` field). Adding one — plumbed through `recalcProjectTotals` and
  its parity tests, plus the PDF pipeline's line-item consumers — is scoped out as
  a deliberate follow-up; see "Deferred from issue #883" in
  [FEATUREDOCS/47](./47-cross-type-equipment-unification.md).

## Warehouse Operations
- Kit checkout: `checkOutKit()` — atomic transaction updating kit + all member assets + grandchildren (nested kits)
- Kit checkin: `checkInKit()` — same pattern, handles grandchildren
- `checkOutItems` skips already-deployed line items during partial re-deploy (no "already deployed" errors)
- If scanning a member asset, warehouse shows "scan the kit instead"
- In warehouse UI, kit items detected by `kitId` must route to `kitCheckOutMutation`, NOT regular `checkOutItems`
- Live warehouse page calls these browser-direct: `convex/warehouseWrites.ts`
  (`checkOutKit`, `checkInKit`, `checkOutItems`, `checkInItems`) via
  `src/hooks/use-warehouse-writes.ts`. The same-named functions in
  `src/server/warehouse.ts` are retained only as int-test entrypoints against
  real Postgres + Convex, not the live call path.

## Kit Verification
- Before deploying or returning a kit, unverified items trigger a confirmation dialog
- `verifiedKitItems` Set tracks confirmed line item IDs
- Verification circles are clickable (manual toggle) for all children and grandchildren — not scan-only
- `collectAllVerifiableIds(children, mode)` filters by mode: deploy counts non-CHECKED_OUT items, return counts CHECKED_OUT items
- Dialog shows "X/Y items verified" with option to proceed or cancel
- "Deploy Verified" automatically includes nested kit parent line items when grandchildren are verified

## Force Return
- `forceReturnKit()` (`convex/warehouseWrites.ts`, called via `src/hooks/use-warehouse-writes.ts`) resets kit + all children (including nested kits and grandchildren) to AVAILABLE, sets line items to RETURNED, always resets location (even to null if no default)
- Bulk force return available from kit list page selection bar

## Delete Kit
- Two-tier delete exposed via `DeleteKitDialog` on the kit detail page
- `archiveNative` (`convex/kitWrites.ts`, soft delete): releases serialized assets, restores bulk quantities, sets `isActive=false, status=RETIRED`. Always available while kit is AVAILABLE + active
- `deleteNative` (`convex/kitWrites.ts`, hard delete): blocked when any `ProjectLineItem` references the kit (historical data preservation). Transaction clears `kitId` on assets, deletes `KitSerializedItem`/`KitBulkItem`/`KitCheckItem`, removes the `Kit` row
- `deletability` query (`convex/kits.ts`) feeds the dialog: returns `{ canArchive, canHardDelete, referencingLineItems, reason }` so the UI disables the hard-delete option with a human-readable reason
- Permission gate: `kit:delete`

## Group Templates with Kit Items
- `GroupTemplateItem` supports **either** a `modelId` **or** a `kitId` (Zod XOR refine in `src/lib/validations/group-template.ts`)
- Enables flexible packages: a "Drum Mic Kit" template = 2x SM57 model + 3x e904 model; a "FOH Package" template = 2x SM57 model + 1x rack kit (rigid)
- `saveGroupAsTemplateNative` (`convex/groupTemplatesWrites.ts`) captures both model-backed and kit-backed parent line items from the source group (skips free-text lines and `isKitChild` rows)
- `applyNative` (`convex/groupTemplatesWrites.ts`) splits template items into model vs kit at apply time, atomically in one mutation (no separate post-commit step, unlike the old `src/server/group-templates.ts` split):
  - Model items are created as `ProjectLineItem` rows alongside the new `ProjectGroup`, in the same mutation (rate pulled from the model at project's rental period)
  - Kit items are expanded inline, once per unit of `quantity` (so "2x rack kit" becomes two independent parent rows, matching physical pull behavior)
  - Kit availability is a non-throwing pre-check per kit: an unavailable/double-booked kit is skipped (with a warning collected in `kitWarnings[]`) rather than aborting the whole apply, so warehouse staff still get the model items
- Project totals are recalculated inline (org tax rate) as part of the same mutation when any kit items were expanded
- Activity log summary includes skipped kit warnings
