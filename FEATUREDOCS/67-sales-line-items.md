# Sales Line Items (WS11 #950)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-27 (review quarterly — POLICY.md R-5.5)_

## What this is

A new `LineItemType` value, `SALE`, alongside the existing `EQUIPMENT` /
`SERVICE` / `LABOUR` / `TRANSPORT` / `MISC`. Every model is sellable — bulk
and serialised — with a hybrid taxonomy: `type: "SALE"` plus a `saleMode`
field (`NEW_STOCK` | `FROM_RENTAL_STOCK`), stamped once at add time and never
inferred or changed afterward.

- **`NEW_STOCK`** (default) — "we sell *a* SM58, not *our* SM58." No rental-asset
  impact at all. Decrements `Model.saleStockQuantity`, a single per-model
  sale-stock pool independent of rental assets/bulk. Oversell is allowed
  (warn, never block) — a negative pool surfaces on the Overbookings & Gaps
  board's "Sale stock to procure" section (FEATUREDOCS/65).
- **`FROM_RENTAL_STOCK`** — disposes of an owned unit out of the rental fleet.
  A serialised asset flips to the terminal `AssetStatus: "SOLD"`; a bulk
  quantity decrements `totalQuantity`/`availableQuantity` together, floored at
  whatever's currently deployed (can't sell units out on a job right now).
  Both are reversible via the explicit "un-sell" action.

Sale lines always force `pricingType: FLAT, duration: 1` — there's no rental
window to blend into a rate. `Model.salePrice` auto-prices a NEW_STOCK/
FROM_RENTAL_STOCK line's unit price when left blank (no fallback chain — an
unset `salePrice` requires manual entry, a deliberate spec decision, unlike
rental auto-pricing's dailyRate/weeklyRate blend).

## Where it lives

```
convex/lib/validators.ts       — LineItemType += "SALE", new SaleMode union, AssetStatus += "SOLD"
convex/schema.ts               — projectLineItems.saleMode, models.salePrice/saleStockQuantity,
                                  projects.saleRevenue/saleCostTotal
prisma/schema.prisma            — mirror enums (LineItemType, SaleMode, AssetStatus, AllocationBasis)
src/lib/validations/line-item.ts — Zod type/saleMode
src/lib/validations/model.ts     — Zod salePrice/saleStockQuantity
src/lib/validations/asset.ts     — Zod status += "SOLD"

convex/lib/saleStock.ts         — the 4 write primitives (see below)
convex/lineItemWrites.ts        — wires saleStock.ts into addNative/addLineItemSmartNative/
                                   patchNative/removeNative/removeManyNative, plus the
                                   dedicated unsellLineItemNative mutation
convex/lib/allocation.ts        — AllocationBasis += "EXCLUDED_SALE" (see FEATUREDOCS/57)
convex/lib/recalc.ts            — projects.saleRevenue / saleCostTotal buckets
convex/projectCosts.ts          — surfaces the new buckets in the P&L panel query
convex/lib/overbookingBoard.ts  — "Sale stock to procure" section (FEATUREDOCS/65)

src/lib/pdfme/types.ts               — DocumentLineItem.type (new field)
src/lib/pdfme/plugins/gearflow-table.ts — SALE badge + filter special-case
src/lib/pdfme/document-composer.ts      — getFilteredParentItems mirrors the same filter

src/components/projects/sale-add-form.tsx    — the "Sale" kind in UnifiedAddDialog
src/components/projects/unified-add-dialog.tsx
src/hooks/use-line-item-writes.ts            — add()/unsell() wrappers

src/server/csv.ts               — salePrice/saleStockQuantity CSV columns
src/lib/rate-import.ts          — salePrice in the narrow rate-only CSV import
```

## The 4 write primitives (`convex/lib/saleStock.ts`)

- **`adjustModelSaleStock`** — `Model.saleStockQuantity += delta` (negative on
  a sale, positive on a restore). Used on add/delete/qty-change for a
  NEW_STOCK line. Writes an activity-log entry with
  `details.saleStock: {from, to, projectId, lineItemId}`.
- **`sellSerializedAssetForSale`** — flips an asset to `SOLD` (+`isActive:
  false`, mirroring `assetWrites.ts`'s `archiveNative` RETIRED pattern so
  dashboard counters and fleet ROI's `isActive` filter drop it for free — see
  FEATUREDOCS/57's ROI note). Pre-checks `findAssetConflict` for a future
  overlapping booking and returns a **non-blocking warning** rather than
  throwing (the same warn-never-block philosophy every availability gate in
  this codebase already follows) — sold anyway; the conflicting booking needs
  a different unit. Throws only for genuine errors (missing asset,
  already-`SOLD`).
- **`unsellSerializedAsset`** — reverses the above: `SOLD` -> `AVAILABLE`,
  `isActive: true`.
- **`adjustBulkTotal`** — decrements/restores a bulk asset's `totalQuantity` +
  `availableQuantity` together. Floored at the deployed quantity
  (`totalQuantity - availableQuantity`) on a sell — returns the ACTUAL
  quantity decremented, which can be less than requested if the floor
  clamps it; the caller (lineItemWrites.ts) surfaces the shortfall as a
  non-blocking warning. Status auto-flips to `OUT_OF_STOCK` at zero; a
  restore that brings it back above zero flips an `OUT_OF_STOCK` row back to
  `ACTIVE`.

## Extra permission: `asset:update`

Selling from rental stock (either mode) requires `asset:update` **on top of**
`project:manage_line_items` — disposing of a physical asset is an asset
action, not just a line-item edit (spec decision). `unsellLineItemNative`
requires the same pair. NEW_STOCK sales only need `project:manage_line_items`
(no asset is touched).

## Gates that stay `type === "EQUIPMENT"`-only (no code change needed)

Every EQUIPMENT-only gate in `lineItemWrites.ts` — the availability/
double-booking check, the merge-dedup block, the accessory-expansion gate —
already excludes SALE lines simply because the gate condition requires
`type === "EQUIPMENT"`. A SALE line never gets double-booking-checked, never
merges (satisfying the spec's "never across type or saleMode" requirement by
construction), and never expands accessories. The **one exception** was the
auto-pricing block in `addLineItemSmartNative`, which was NOT gated by type
(any model-backed line with no manual price auto-priced via the rental
`computeBlendedCharge` blend) — that block now branches explicitly on
`type === "SALE"` to use `Model.salePrice` instead, a deliberately separate,
simpler mechanism.

Similarly, every **warehouse read site** (`warehouseCloses.ts`,
`warehouseCloseWrites.ts`, `project-line-item-read.ts`,
`warehouse-detail-reconstruct.ts`, `line-item-count-read.ts`,
`warehouse/page.tsx`) already filters strictly on `type === "EQUIPMENT"`, so
SALE lines are invisible to the check-in/return/prep workflow "for free" —
goods are handed over at the docket, not pulled/returned through the
warehouse flow. See the regression tests pinning this in
`line-item-count-read.test.ts` and `warehouse-detail-reconstruct.test.ts`.

## PDF pipeline (see also FEATUREDOCS/13)

- Quote/invoice: SALE lines included, with a green "SALE" badge
  (`BADGE_STYLES.sale` in `gearflow-table.ts`). No `/day` suffix — a SALE
  line is always `pricingType: FLAT`, whose label is already "flat".
- Delivery docket + packing list: SALE lines always included, regardless of
  status (goods handed over, never checked out through the warehouse flow).
  Packing-list already had no `filterByStatus` at all, so this was free;
  delivery-docket's `["CHECKED_OUT"]` filter now special-cases
  `type === "SALE"` to bypass it.
- Return sheet: SALE lines excluded entirely, regardless of status — never
  expected back.
- Sale lines ride in their existing category/group — no separate "Sales"
  bucket; the badge is the only differentiator.

## Revenue / P&L (see also FEATUREDOCS/10, FEATUREDOCS/57)

- `projects.saleRevenue` — standalone (ungrouped) SALE lines' `lineTotal`,
  mirroring how `standaloneRevenue` sums everything else, excluded from
  `equipmentRevenue`. `subtotal = equipmentRevenue + serviceRevenue +
  saleRevenue`. A SALE line inside a **priced** project group still rides the
  group's bundle price (unaffected) — the "no separate Sales bucket" decision
  is a PDF/badge distinction, not a revenue one.
- `projects.saleCostTotal` — COGS: for each non-cancelled, non-optional SALE
  line, the first positive value in `asset.purchasePrice ->
  model.defaultPurchasePrice -> bulkAsset.purchasePricePerUnit ->
  model.replacementCost`, times quantity. Folds into `margin` alongside
  service/labour/sub-hire costs. Surfaced in the ProjectCostsPanel as a "Sale
  cost of goods" row (shown only when non-zero) and a "Sale revenue" detail
  row.
- Allocation: `AllocationBasis += "EXCLUDED_SALE"` — a SALE line takes no
  weight in any kit/group split and is never rolled up into
  `projectModelRevenues` (never counts toward a model's rental ROI). See
  FEATUREDOCS/57.

## CSV / rate import

`Model.salePrice`/`saleStockQuantity` follow the exact `defaultPurchasePrice`/
`replacementCost` pattern: full-model CSV export/import columns, the narrow
rate-only CSV import (alias `saleprice|sale|sellprice|rrp|retail`), and
`bulkUpdateRatesNative`'s `rateType` union (+ the model-table.tsx bulk
rate-update dialog).

## Out of scope (this workstream)

- The dead `SERVICE`/`LABOUR`/`TRANSPORT`/`MISC` line-item-type cleanup — a
  separate hygiene follow-up (these types have no live writer; `projectServices`
  is a wholly separate table from `projectLineItems`).
- Sale-stock receipting/purchasing workflow — the Overbookings & Gaps board's
  procure list is the v1 answer; no PO-generation flow yet.
- Disposal-proceeds reporting (what a sold *rental* asset's proceeds were,
  reconciled against its book value) — noted as a gap in FEATUREDOCS/57's ROI
  section, not built here.
