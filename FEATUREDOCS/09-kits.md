# Kit System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Kits List Page (`src/components/kits/kits-list.tsx`, UX Phase 14)
A `ListPage` (config in `src/lib/list-views/kits.ts`) over `kitsList.listPage`: server-side search,
filter words (Category, Location, Tags), derived strip `All · Complete · Missing items · On a job`
(counts from `kitsList.segmentCounts`), one page per query via `useAuthedQuery`. Columns: Items, Complete,
On job, Location; opt-in from ⋯ › Columns: Value (purchase price, redacted for a `noFinancials` key),
Condition, Tags. Row ⋯: Open, Edit, Force return (only for a kit that is out; confirm, no Undo). Bulk:
`Print list n` (a CSV of the selected kits) and `Force return n` (only when a selected kit is out; each
kit that is not out is skipped and the toast says so). Duplicate and Archive arrive with the kit record
(14b-2): a kit archive releases members and has no exact reverse yet.

## Kit state is DERIVED (D75, `convex/lib/kitState.ts`)
Incomplete is derived from the kit's contents OR the stored `INCOMPLETE` marker (below); Reserved and
Available are derived. The stored physical statuses (`CHECKED_OUT`, `IN_MAINTENANCE`, `RETIRED`) are still
written by the warehouse and maintenance flows and still win. Precedence: Retired > Out > In maintenance >
Incomplete > Reserved > Available, so a missing item beats a reservation. An archived or retired kit is
unbookable (Retired wins); an archived or retired MEMBER counts as missing, so it makes the kit Incomplete
and unbookable too.
- **Missing**: a serialised member whose asset is gone, `LOST` or retired; a bulk member whose bulk asset
  is gone or holds less in total than the kit needs. A member in maintenance is "in repair", not missing.
- **Reserved**: a parent kit line on the LIVE version of a confirmed-or-later job that has not ended.
  A reservation never blocks adding the kit to a job (the dated double-booking check owns clashes).
- **The stored `INCOMPLETE` is the human-cleared "reported missing" marker** (review ruling on D75). A
  MISSING return of a kit writes it (`warehouseOps` `checkinKit`), because a kit with only bulk members has
  no `LOST` member to derive from (bulk `totalQuantity` is never reduced by a return). The derived state is
  (a member is missing) OR (the marker is set), and both block booking. ONLY `kitWrites.markCompleteNative`
  ("Mark complete" in the row menu, gated as a kit edit, with an exact field-edit Undo through
  `fieldEditUndo`) clears it: a found asset set back to `AVAILABLE` does not. Legacy `INCOMPLETE` rows keep
  blocking exactly as before. A kit with the marker can still have items added, archived or deleted.
- **Every surface prints the derived state.** The Kits list, the kit page (`kitDetail.bundle` carries `state`; header,
  Status section) and the location record's kit list (`locations.detail`) all read `convex/lib/kitState.ts`; the
  stored status is only the physical lifecycle. The kit page's header has `Mark complete` (absent without
  `kit:update`, with the same Undo) and its status select no longer offers Incomplete (and is hidden while the kit
  is reported missing). The kit sheet's Status is locked on a reported-missing kit. `kitWrites.updateNative` /
  `createNative` refuse to set the marker (only a MISSING return does) or clear it (only Mark complete does);
  re-saving a kit that carries it, unchanged, is fine. **Check-out refuses a kit reported missing**
  (`warehouseOps.checkoutKitPreflight`, shared by the single and batch deploy: `KIT_REPORTED_MISSING`, the same
  derived-OR-marker state as `loadKitBookingGate`, for the kit and each nested kit; the per-line deploy
  `checkoutItemsCore`, which MCP `dispatch_gear` calls, runs the same check on a kit parent line, and the batch
  report carries `code` beside `message`). The booking gate only runs at
  add-line, so a kit already booked on job B and then reported missing on job A's return would otherwise go out on
  B and have its marker overwritten; Mark complete is the way through.
- **The Kit sheet** (UX Phase 14, 14b-2; `src/components/kits/kit-sheet.tsx`, opened by `KitSheetHost` from `?new=1` /
  `?edit=1` / `?copy=1`): create, edit and duplicate in ONE `FormSheet`; there is no Status field. The host opens only for
  a caller who may (`kit:create` for New and Duplicate, `kit:update` for Edit) once their permissions have arrived,
  otherwise it drops the param with a toast. `kitSheetInitialOf` (`src/lib/kit-sheet-initial.ts`) is the ONE mapping from
  a kit read to the sheet's values: a stored `0` weight or price stays `0` (an unchanged save must not clear it), and the
  purchase date shows as `yyyy-mm-dd`. Duplicate keeps the case and the setup but not `purchasePrice` or `purchaseDate`
  (a different physical kit). `kitWrites.editNative` sets and CLEARS fields in one field-edit audit row; a save that
  changes nothing (an absent `tags` and `[]` count as the same) writes nothing and offers no Undo.
- **Kit cost follows the read line.** `purchasePrice` is `KIT_COST_FIELDS` (`lib/gearCostFields.ts`). A `noFinancials`
  key can neither set nor clear it through `editNative` or `createNative`, and its `undoEditNative` refuses as a whole
  (`NOT_UNDOABLE`) when the edit it would reverse touched it. `undoCreateNative` refuses once ANY of `kitSerializedItems`,
  `kitBulkItems`, `projectLineItems`, `kitMedia`, `kitCheckItems`, `groupTemplateItems`, `maintenanceRecords`,
  `checkRecords`, `assetScanLogs` or `kitRevenueAllocations` names the kit.
- **Reads are budgeted.** `kitsList.listPage` / `segmentCounts` draw every member, booking-line and
  member-count read from ONE per-call budget (`convex/lib/readBudget.ts`). A kit the budget cannot cover has
  `state: null` (the row prints a dash, never a guess), and the response says `truncated`. The strip is
  `All · Complete · Missing items · On a job · In maintenance · Retired`; the booking gate reads ONE kit and
  is never budgeted.
- **Sort is an allow-list** (`assetTag, name, condition, purchasePrice, category, location, state`); an
  unknown key, or `purchasePrice` for a `noFinancials` key, falls back to the default order, ascending
  whatever direction was asked.
- **The three booking gates use the one helper** (`loadKitBookingGate`): `lineItemWrites.addKitNative`,
  `groupTemplatesWrites.applyNative`, and `src/server/line-items.ts` `checkKitAvailability` (through the
  `kitsList.bookingGate` query). A kit blocks booking exactly when it is In maintenance or Incomplete.

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

### Discount (issue #883)
`KIT_PRICE` kits support a flat `$` discount off the parent row's
`unitPrice`, set at add time in `KitAddForm`. Reuses the existing
`ProjectLineItem.discount` field (no schema change — kits never had their
own pricing table) via `createKitLineItemCore` /
`convex/lineItemWrites.ts` `addKitNative` /
`useLineItemWrites().addKit()`. Not available in `ITEMIZED` mode — there's
no parent-row price to discount against; discount each child individually
via `EditLineItemDialog` instead. Validated by the existing
`assertLineMoneyFields` bound (finite, 0–999999.99) shared with every
other line-item discount.

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

## Bulk stock accounting
A kit's bulk members leave `bulkAssets.availableQuantity` **when they are added to the kit** (`kitWrites.addBulkItemNative`) and return to it when removed or the kit is archived. Deploy, return, un-deploy, un-return and force-return **never** adjust bulk availability — the stock is already out of the pool. Consuming it again at deploy double-counted it and failed with "Insufficient stock" whenever the kit held all of a bulk asset. `checkoutKitPreflight` also rejects a kit that is already `CHECKED_OUT`.

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

## Catalog changes after a kit is already on a project — resynced on demand, not automatically

A kit's member list is snapshotted onto the project as concrete child
`ProjectLineItem` rows at `createKitLineItemCore` time (see "Data Model" above) —
there is no live join back to `KitSerializedItem`/`KitBulkItem`. Editing a kit's
membership after it's already on an open (not-yet-checked-out) project does
**not** retroactively add/remove the project's child rows on its own.

`resyncProjectKitsNative` (`convex/lineItemWrites.ts`, reconcile core in
`convex/lib/kits.ts`'s `reconcileKitLineChildren`) closes that gap the same way
`resyncProjectAccessoriesNative` (FEATUREDOCS/48) does for accessories: an
explicit, PM-initiated, per-project action — never a trigger on the catalog
write itself, since editing one kit can affect many open jobs at once and an
already-quoted job's composition shouldn't change out from under the PM without
them asking for it. Surfaced as the "Sync kits" toolbar action next to "Sync
accessories" in the Equipment tab (`src/components/projects/equipment-tab.tsx`).

For every kit parent line (`kitId` set, not itself a child) with no deployed
unit anywhere on the line — parent or member child, since kit fulfillment can
deploy members one at a time (`kitLineHasDeployedUnit`) — it diffs the line's
current children against the kit's CURRENT membership:

- A member no longer on the kit: its child line (+ units) is deleted.
- A member the kit doesn't have a child for yet: a new child line is inserted,
  same shape `createKitLineItemCore` would create for it.
- A kept bulk member whose kit-configured `quantity` changed: the child's
  `quantity` (and, in `ITEMIZED` mode, its price) is rescaled to match.

**Pricing a newly-added member** mirrors `createKitLineItemCore` exactly, which
is what answers the "needs its own design pass" question this section used to
raise: `ITEMIZED` pulls the member's model `defaultRentalPrice`, same as at
add-time; `KIT_PRICE` leaves it unpriced, because the bundle price is a
hand-set number on the PARENT row and a new member can't assign itself a share
of it — resync never touches the parent's own price. The mutation returns
`unpricedChildrenAdded` for exactly this case (a `KIT_PRICE` addition, or an
`ITEMIZED` member whose model has no rate configured) so the toolbar can flag
"N added — review pricing" instead of implying every resync leaves the job
fully priced.

Never touched: an existing kept child's price when the kit member's own model
rate changes after the fact — the same "office decides" boundary
`resyncProjectAccessoriesNative` draws around a kept accessory. Repricing an
already-quoted child from a catalog-rate change is a distinct, un-designed
feature, not part of membership resync.
