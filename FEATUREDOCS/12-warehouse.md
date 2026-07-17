# Warehouse Operations

## UI Terminology
- "Check Out" is displayed as **"Deploy"** in the UI
- "Check In" is displayed as **"Return"** in the UI
- `CHECKED_OUT` status displays as **"Deployed"**
- Internal code (function names, enum values, API params) still uses `checkOut`/`checkIn`/`CHECKED_OUT`

## Lifecycle Flow

Gear flows **left to right** through five stages. The primary button in each tab advances
gear one step; a secondary **"Move to …"** button reverses one step (see *Move-back* below)
for correcting a misclick — the derivation itself still keys off the item's real
status/prepStatus, so a reversed item is simply re-derived at its new stage:

```
Pick/prep → Prepped → Deployed → Returned → De-prepped   (→ forward buttons)
Pick/prep ← Prepped ← Deployed ← Returned ← De-prepped   (← Move-to back buttons)
```

The project warehouse page header renders a **lifecycle stepper** (`WarehouseLifecycle`,
fed by `summarizeWarehouseStages` from `warehouse-stages.ts`) showing a live count of gear
at each stage as a distribution — so returned gear sits in its own node and is never folded
back into Prep or Deploy. The stage model is a single pure function, `deriveItemStage`,
unit-tested in `warehouse-stages.test.ts`.

**The cardinal rule: `status === "RETURNED"` always wins.** A returned piece of gear reads
as *Returned* (still `prepStatus=PACKED`, awaiting de-prep) or *De-prepped* (`prepStatus`
reset off PACKED), and can never be re-derived as "needs prepping". This fixes two confusing
bugs where the flow appeared to run in reverse:
- An early-returned item used to reappear in **Pick/Prep**, looking like it had never gone out.
- A returned item used to show in the **Deploy** tab (because the de-prep action lived there),
  so returning gear "went back to Deploy".

**The tabs are named after the stage the gear is IN, not the action** — so the tab bar reads
exactly like the lifecycle: **Pick → Prepped → Deployed → Returned → De-prepped** (then
**Close-out** as a trailing utility). The primary button inside each tab
performs the action that advances gear to the next stage:

| Tab (stage gear is in) | Shows | Button → next stage |
| --- | --- | --- |
| Pick | `pickPrepItems` (not yet PACKED) | Prep → Prepped · (first stage, no back) |
| Prepped | `preppedItems` (PACKED, not out) | Deploy → Deployed · **Move to Pick → Pick** (deprep) |
| Deployed | `checkedOutItems` (CHECKED_OUT) | Return → Returned · **Move to Prepped → Prepped** (un-deploy) |
| Returned | `returnedItems` (RETURNED + PACKED) | Deprep → De-prepped · **Move to Deployed → Deployed** (un-return) |
| De-prepped | `deprepedItems` (RETURNED, prepStatus off PACKED) | **Move to Returned → Returned** (un-deprep, per row) |

### Move-back (reverse a stage)
Every stage's primary button advances gear one step; each stage past Pick also has a
**secondary "Move to …" button** that reverses one step, so an operator can correct a
misclick without a workaround. The reverses mirror their forward mutation exactly —
flipping unit + asset status (and kit bulk-availability, opposite sign) back:

| Reverse | Server action → Convex mutation | Effect |
| --- | --- | --- |
| Prepped → Pick | `deprepItem` / `deprepKit` | remove packed units, `prepStatus` → PENDING |
| Deployed → Prepped | `undeployItems` / `undeployKit` → `warehouseOps.undeployItems`/`.undeployKit` | units CHECKED_OUT → prepped, assets → AVAILABLE @ default location, kit bulk availability +1 |
| Returned → Deployed | `unreturnItems` / `unreturnKit` → `.unreturnItems`/`.unreturnKit` | units RETURNED → CHECKED_OUT, assets → CHECKED_OUT @ project location, kit bulk availability −1 |
| De-prepped → Returned | `undeprepLine` → `.undeprepLine` | line `prepStatus` → PACKED (status stays RETURNED) |

Selection is parsed by the shared `moveBackSelection` helper (same bulk `id:idx` / line-id /
kit-parent parsing as the forward handlers), routing kit parents to the kit reverse and the
rest to the item reverse. **Reverses flip whole units** — they do not sub-split a tagged bulk
pool's quantity (matches how bulk deploy/return create whole unit rows). Legacy unit-less
lines (deployed via `checkOutDeployWholeLine`) restore their line counters directly and skip
the unit rollup (which would otherwise zero them).

(Internal `TabsTrigger`/`TabsContent` values are unchanged — `pick-prep`, `check-out`,
`check-in`, `deprep`, `deprepped` — only the visible labels are the stage names.) Items are
**prepped** (packed) before being **deployed** (checked out), and **de-prepped** (return checks
run, back into inventory) after being **returned**.

### Pick/Prep Tab
- Scan or select items to prep
- Container dropdown next to scan input — select a case asset or type a custom container name
- Container assets (from configured case category) auto-added to project on first prep
- `prepItemDirect()` sets `prepStatus=PACKED` and `prepContainer` without deploying (status stays `CONFIRMED`)
- **Per-unit fulfillment model (no line splitting)**: prep never splits the line or decrements its
  `quantity`. A multi-qty line stays one row; each prepped item is a `projectLineItemUnit` row
  (`prepStatus=PACKED`) carrying its own `assetId` (serialized), `bulkAssetId` (tagged bulk), or
  neither (untagged bulk — see "Partial prep of untagged bulk lines" below). The line's
  `packedQuantity`/`checkedOutQuantity`/`returnedQuantity` counters and coarse `status`/`prepStatus`
  are **rolled up** from its units by `syncLineItemRollup`. Which stage a bulk line's units belong
  to is derived from those unit rows (see quantity-aware staging below), so a partial prep leaves the
  remaining units in Pick instead of moving the whole line.
- Items with no check items assigned are prepped directly; items with checks go through the check queue
- **Sub-hire items skip the asset picker**: When `handlePrepSelected()` processes selected items, it checks `!li.isSubhire` before routing a serialized item (no `assetId`, no `bulkAssetId`, SERIALIZED model) to the asset picker. Sub-hire items are third-party gear with no internal asset record, so they are prepped directly without asset assignment.
- **Serialised routing is `assetType !== "BULK"`, NOT `=== "SERIALIZED"`.** `handlePrepSelected()` decides whether a non-bulk-asset line needs the asset picker. The Convex model mirror stores `assetType` as OPTIONAL, so a model whose mirror doc omitted it reads back `undefined`. Testing `=== "SERIALIZED"` then failed and the line fell through to the bulk/generic prep path. Prisma defaults `assetType` to `SERIALIZED`, so "not BULK" is the mirror-gap-proof reading for a line with no `bulkAssetId`. Genuine BULK lines are routed to the bulk path (below). Per-asset prep is regression-tested in `warehouse-prep.int.test.ts`.

#### Partial prep of untagged bulk lines (quantity-aware staging)
A genuine BULK line with **no bulk asset tag assigned** (no per-unit identity) used to be
prepped/deployed **whole-line**: `prepUnit`'s no-asset/no-bulk branch flipped the entire line to
`prepStatus=PACKED`, so ticking *1 of 10* moved **all 10** into Prepped ("they don't have asset
tags" and all jump over). Now these lines track prep **per unit**, exactly like tagged bulk:
- `prepUnit` (in `convex/lib/fulfillment.ts`) creates one **generic** qty-1 `projectLineItemUnit`
  (no `assetId`, no `bulkAssetId`, `prepStatus=PACKED`) per packed item, capped at the line's
  ordered `quantity`. The single-unit / legacy (`quantity <= 1`) case keeps the whole-line flip.
- Deploy: `checkoutItems`' no-asset/no-bulk branch calls `checkOutGenericUnits` (in
  `convex/warehouseOps.ts`), flipping up to `want` prepped generic units to `CHECKED_OUT`. Only
  lines that were never unit-prepped fall back to `checkOutDeployWholeLine`.
- Deprep + return already handled generic units (`deprepItem` deletes packed units LIFO by count;
  `returnLineUnits` §3 flips checked-out units up to `quantity`).
- **UI staging is unit-derived** (not the binary line `prepStatus`). `bulkUnpackedRemaining` /
  `bulkPackedWaiting` (in `warehouse-types.ts`, unit-tested in `bulk-unit-counts.test.ts`) split a
  bulk line's units across stages: the Pick tab shows/counts units still to pick, the Prepped tab
  shows/counts units packed-and-waiting — so one line can appear in **both** Pick and Prepped
  during a partial prep. The `pickPrepItems`/`preppedItems` filters and `groupItems`' bulk
  `unitCount` (via the `countStage` arg) all read these helpers. This uniformly fixes tagged bulk
  and serialized-unassigned multi-qty lines too. Regression-tested in `warehouse-prep.int.test.ts`
  ("untagged bulk: …").
- Bulk items display as expandable groups with individual unit rows (Unit 1, Unit 2, etc.) — each unit gets its own check dialog
- `deprepItem()` reverses prep: clears `prepStatus` to PENDING (split items stay as independent line items)

#### ⚠️ Tagged-bulk quantity — the ONE unit carries the packed count (don't overwrite it)
A **tagged** bulk line (`bulkAssetId` set) keeps exactly ONE `projectLineItemUnit`
per `(line, bulkAsset)` whose `quantity` is the total packed/checked-out count; the
line's `checkedOutQuantity`/`packedQuantity`/`returnedQuantity` rollups are *derived*
from it by `syncLineItemRollup` → `computeRollupCounters`. Bug history (issue #8):
`prepUnit`'s bulk branch OVERWROTE that unit's `quantity` to `args.quantity` on every
call, and the client expanded a bulk prep into N `{quantity: 1}` entries — so a
16-unit prep collapsed the unit to `quantity: 1` ("16 on the job, shows qty 1").
That cascaded: deploy → `checkedOutQuantity: 1`, and the return path decremented 1 at
a time (return had to be clicked 16×). Fixes:
- `prepUnit` bulk branch **accumulates** (`existing.quantity + addQty`), capped at the
  line's ordered `quantity` — correct whether the caller sends one aggregate entry or
  N per-unit entries, and for incremental prep. The warehouse page now sends ONE
  aggregate entry per bulk line.
- `warehouseOps.checkoutKit` deploys each line at its **own** `quantity`, not a
  hardcoded `1` (a bulk kit member of qty 16 was rolling up as 1).
- `returnLineUnits`' bulk branch defaults `quantity` to the **full remaining**
  checked-out quantity (was `?? 1`), so one return action brings back all 16; an
  explicit `quantity` is still honoured for partial returns.
- Regression: `convex/bulk-fulfillment-quantity.test.ts` drives prep → return through
  the real `prepUnit`/`returnLineUnits` with a `convex-test` harness.

### Deploy Tab
- Shows items with `prepStatus=PACKED` and `quantity > 0` (prepped but not yet deployed)
- **Move to Pick (deprep) button** — a secondary `variant="line"` button next to Deploy that
  sends the selected prepped units *back* to the Pick stage. It reuses `handleDeprep(selectedOut)`
  (the same callback the De-prep tab uses): prepped-but-never-deployed items have no RETURN check,
  so they route straight through `deprepItem`/`deprepKit`, which removes the packed unit rows and
  resets the line's `prepStatus` to `PENDING`. Partial selections are honoured (deprep N of M).
  This is the "move stuff back a stage, not just forward" affordance — every stage's primary
  button advances gear; the Prepped stage additionally offers a reverse.
- **Excludes `status === "RETURNED"`** (leaf, kit-child and grandchild filters) — returned gear belongs in the De-prep tab, not here
- Split items (qty=1) flow through the serialized deploy path regardless of whether they have a `bulkAssetId`
- Items grouped by `prepContainer` with section headers (Package icon + container name)
- X button on container headers to clear container assignment
- Container line items auto-deploy when all contents are deployed (`syncContainerStatus`)
- Permanent accessories (`childKind === "ACCESSORY"`) cascade with their parent automatically (they're permanently attached). **There is no warehouse UI for accessories** — the "Include accessories" toggle was removed; `checkOutItems` is always called with `includeAccessories: true`, so accessories deploy/return silently whenever their parent does. See [Child Assets / Accessories](./48-child-assets-accessories.md).

### Return Tab
- Shows items with `status === "CHECKED_OUT"` only
- Split bulk items (qty=1 with bulkAssetId) use the serialized return path
- Items grouped by `prepContainer` with section headers (same as Deploy tab)
- Container line items auto-return when all contents are returned (`syncContainerStatus`)
- Permanent accessories cascade back with their parent automatically on return — no separate rows or toggle. See [Child Assets / Accessories](./48-child-assets-accessories.md).

### De-prep Tab
- Shows gear at the **Returned** stage: `status === "RETURNED"` and `prepStatus === "PACKED"` (`returnedItems` filter; kit parents surface if any child/grandchild matches). Once de-prepped, `prepStatus` resets off PACKED and the item leaves this tab.
- Renders by **reusing `DeployTab` with `mode="deprep"`** — identical grouping (`groupItems(returnedItems, "deploy")`), container sectioning (`deprepContainerGroups`) and selection keys (`allDeprepKeys` / `selectedDeprep`), so `handleDeprep` parses them exactly as before. Only the chrome differs: no deploy scanner, no accessories toggle, a single primary **Deprep** button, and the "remove container" action is hidden.
- The **Deprep action moved here from the Deploy tab.** `handleDeprep` (lifted to a named callback in the page) runs RETURN checks where the model has check items (`fromDeprep: true` check queue), otherwise deprep straight back into inventory via `deprepItem`/`deprepKit`. Kits route through `startKitCheckFlow(..., "RETURN", "GOOD", true)`.

### Bulk Check-In Tab — REMOVED
The project-wide accessory-totals check-in tab was **removed from the warehouse UI**
(accessories are no longer surfaced as a separate warehouse concern — they cascade
silently with their parent). `src/server/bulk-checkin.ts`, its int test, and the
`bulk-checkin-tab.tsx` component are gone; only the pure helper library
`src/lib/bulk-checkin.ts` (+ its unit tests) remains, dormant. See
[Bulk Check-In Totals](./52-bulk-checkin.md) for the dormant backend.

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

**Partial return of identical units.** A single order line of N identical serialised units (e.g. "SM58 x4") has no line-level `assetId` and no `bulkAssetId` — the assets live on the per-unit `ProjectLineItemUnit` rows. Ticking some-but-not-all units in the return tab sends `{ lineItemId, quantity: K }` with no `assetId`, which lands in `returnLineUnits`' whole-line branch. That branch honours `quantity`: it flips exactly K still-out units (lowest ordinal first) and leaves the rest deployed; omitting `quantity` flips every still-out unit ("return whole line"). Bug history: the branch used to ignore `quantity` and flip all N units, so ticking one of four returned all four (fixed + regression-tested in `line-item-fulfillment.int.test.ts`). The checkout side already honoured the count via `expandPrepUnitAssignments`.

4. Returning a parent asset cascades the return to its permanent accessories via `checkinAccessoryChildren` (`line-item-fulfillment.ts`) — shared, so both `checkInItems` AND the **check-and-store** flow (`completeCheckAndStore`) release the accessories; de-prep also clears them from the deploy-staging board. On a multi-quantity model line, the cascade is **scoped to the returned unit** (`returnedAssetId`): serialised accessories return only with their own host asset, and the shared bulk accessory clears one unit's share per return, fully releasing once every host unit is back. The cascade only fires when the parent return actually flipped a unit (`unitsFlipped > 0`), so re-scanning an already-returned unit can't double-return the shared accessory. See [Child Assets / Accessories](./48-child-assets-accessories.md).

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

## Checkout Safety Invariants
Two invariants `checkOutItems` enforces (see `warehouse-tenant-tt-safety.int.test.ts`):

- **Org-scoped asset writes.** The asset id used for a serialised checkout can come from the untrusted scan payload (`item.assetId`), so it is re-scoped to the caller's org with `findFirst({ id, organizationId })` before any write; a miss throws "Asset not found in this organization". The status/location mutation is an org-scoped `updateMany` (defense-in-depth), as is the accessory-cascade asset write in `checkoutAccessoryChildren`. Without this a caller could flip another tenant's asset status/location by scanning its id onto their own line.
- **Accessories are T&T-gated.** The top-level T&T preflight (`assertTestTagAllowsCheckout`) only sees the scanned parent lines + their units. Accessory children are **separate line items** with their own ids/units (materialised at prep time on different line ids, or at scan time *after* the preflight runs), so they never reach the top-level gate. `checkoutAccessoryChildren` therefore runs its own `assertTestTagAllowsCheckout` over the accessory children's asset/bulk ids before flipping them — a failed/overdue accessory throws `TestTagBlockError` and rolls back the whole batch. The gate is scoped to children that are **not already `CHECKED_OUT`** (mirroring the cascade's skip-already-out guards) so an already-shipped sibling accessory whose T&T lapsed doesn't block a later partial deploy of the same multi-quantity parent line. (A not-yet-deployed sibling accessory is still gated, since the line-scoped cascade would flip it — true per-unit scoping is the deferred "snapshot per-unit accessory contributions" follow-up.) See [Child Assets / Accessories](./48-child-assets-accessories.md).

## Cross-Navigation
- **Warehouse → Project**: "View Project" button in warehouse header links to `/projects/[id]`
- **Project → Warehouse**: "Warehouse" button in project header links to `/warehouse/[id]`

## Custom Items in Warehouse

Custom line items (`isCustomItem: true`) appear in all three warehouse tabs with a muted "Custom" badge. They have no asset tag and cannot be scanned — operators check them out/in via the existing button/checkbox mechanism.

**Pick/Prep:** Custom items appear in the pick/prep list. They can be manually marked as Packed (same checkbox as bulk items). No scanning required.

**Deploy:** Custom items appear in the deploy list. Since `isBulk` check (`!lineItem.assetId && lineItem.quantity > 1`) routes them to the bulk checkout path, all units deploy at once via button press.

**Free-text / custom lines cannot carry asset tags (intended).** A line with no catalog model (`modelId: null`, including `isCustomItem` lines) deploys generically: `lookupAssetForScan` binds a scanned asset to a line by matching `modelId`, so a model-less line can never have a physical asset assigned, and `checkOutItems` falls through to the "deploy whole line" branch (flips status, no unit, no asset). Consequence: such a line shows **no per-unit asset tags on the delivery docket** — only its name + quantity — even with `showPerUnitCheckboxes` on. This is by design: free-text lines are for ad-hoc/consumable items (cables, gaffer). Serialised gear that needs asset-tag tracking must be entered as a **catalog model**, not typed by name. (Product decision 2026-05-30: keep free-text non-tracked rather than override the scan match or add a line→model link flow.)

**Return:** Custom items appear in the return list. They are returned via the return button; no asset tag scan possible.

**Checkout server path:** `checkOutItems()` handles custom items without changes — null `assetId` + qty=1 takes the serialized path (skips asset status checks), qty>1 takes the bulk path (deploys full quantity).

**Scan conflict:** Custom items have no barcode. If an operator scans a barcode that doesn't match any asset, the existing "not found" error is returned — no conflict with custom items.

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
Dialog with full item list showing deployment status per line item. Mobile full-screen with safe area padding. Kit and prep-kit groups show as expandable sections with children. Permanent accessories render indented under their parent asset line, badged "Accessory", and count toward pick progress (`pick-list-progress.ts`) — the same rows appear on the printable pull sheet (`pull-sheet/page.tsx`). On mobile the pull sheet uses **`StickyTable`** (frozen checkbox + Item columns, the rest scroll sideways with smart wrapping so nothing overlaps; empty cells render blank, no "—" noise). All sticky/scroll enhancements reset under `@media print`, so the physical printed sheet is unchanged. See `FEATUREDOCS/25-datatable.md` → Mobile data-table primitives. See [Child Assets / Accessories](./48-child-assets-accessories.md).

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
