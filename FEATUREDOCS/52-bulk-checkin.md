# Bulk Check-In Totals

> **⚠️ UI REMOVED.** The Bulk Check-In tab was removed from the warehouse project
> page — accessories are no longer surfaced as a separate warehouse concern (they
> cascade silently with their parent). The backend below (`src/server/bulk-checkin.ts`,
> `src/lib/bulk-checkin.ts` and their tests) is **retained but dormant** — nothing in
> the UI calls it. Re-wire a tab to bring it back.

A project-wide check-in screen: instead of returning each parent's accessories
one parent at a time, the operator sees the **total quantity of each item due
back across the whole job** ("100 clamps", "50 TrueCons", "3 generators", "1
custom stage") and checks a counted quantity in with one action. Supports all
deployed line item types: owned serialised assets, owned bulk assets, sub-hire
items, custom items, AND accessories.

Depends on [Child Assets / Accessories](./48-child-assets-accessories.md).

## Scope

- Aggregate **deployed line items** (CHECKED_OUT status, top-level items +
  accessory children) into per-identity totals:

  | Type | Grouping key | Kind |
  |---|---|---|
  | Bulk accessory (`childKind: ACCESSORY`, has `bulkAssetId`) | `bulk:<bulkAssetId>` | BULK |
  | Serialised accessory (`childKind: ACCESSORY`, has `assetId`) | `serial:<modelId>` | SERIALIZED |
  | Owned serialised asset | `asset:<assetId>` | SERIALIZED |
  | Owned bulk asset | `bulk:<bulkAssetId>` | BULK |
  | Sub-hire item | `subhire:<lineItemId>` | SERIALIZED |
  | Custom item | `custom:<lineItemId>` | SERIALIZED |

- Return a counted quantity per total in one action, distributing it back across
  the underlying line items deterministically.
- Owned serialised/owned bulk/accessory items go through `returnLineUnits` (the
  same primitive the per-parent check-in uses).
- Sub-hire and custom items carry **no `ProjectLineItemUnit` rows** — their
  line-item `status` and `returnedQuantity` are the source of truth and are
  updated directly. The line only flips to `RETURNED` once the cumulative
  returned quantity meets/exceeds `checkedOutQuantity`; a partial return stays
  `CHECKED_OUT` so the remaining quantity is still visible to
  `getBulkCheckInTotals` (which filters on `status: CHECKED_OUT`). Because these
  lines have no units, `syncLineItemRollup` is deliberately **not** called on
  this path — it would recompute every counter from an empty unit set and zero
  out the quantities just written.

## Pure helpers — `src/lib/bulk-checkin.ts`

No Prisma / IO.

- `itemGroupKey(item)` — grouping key per type.
- `aggregateCheckInTotals(items)` → `BulkCheckInTotal[]` — sums `outstanding`
  per key, drops zero-outstanding items, returns a deterministically ordered
  list (kind → label → key). Each total carries an `itemType` field for
  UI badge rendering.
- `distributeReturn(children, quantity)` → `{ allocations, distributed, requested }`
  — walks a group's children in `(sortOrder, lineItemId)` order, filling each up
  to its `outstanding`. Never allocates beyond a child's outstanding or beyond
  `quantity`. `distributed < requested` is the over-return signal.

## Server actions — `src/server/bulk-checkin.ts`

- **`getBulkCheckInTotals(projectId)`** — read-only, `getOrgContext()`-scoped.
  Loads every deployed line item (top-level + accessory children) with unit rows
  and returns aggregated, serialised totals.
- **`checkInBulkTotals(projectId, returns)`** —
  `requirePermission("warehouse", "check_in")`, all work in one
  `prisma.$transaction`.
  - **Authoritative outstanding.** Quantities recomputed server-side from live
    unit rows inside the transaction.
  - **Distribution.** Per-type processing: `returnLineUnits` for owned/accessory
    items, direct status update for sub-hire/custom items (status flips to
    RETURNED only when fully returned; partials stay CHECKED_OUT).
  - **Over-return rejected.** Throws and rolls back the whole batch.
  - **Idempotent / empty-safe.** Zero-quantity entries skipped, empty array is
    a no-op.
  - **Audit.** Per-asset `AssetScanLog` + per-group summary + `logActivity`.
  - The existing per-parent `checkInItems` path is untouched.

## UI — `src/components/warehouse/bulk-checkin-tab.tsx`

A **Bulk Check-In** tab on the warehouse project page. Each total renders with
its label, model number, item-type badge (Asset / Bulk / Sub-Hire / Custom /
Accessory), "Due Back" count, and a number input defaulting to the full
outstanding. A single condition select applies to the batch. Over-typed
quantities block submit. On success it invalidates both
`bulk-checkin-totals` and `warehouse-project` queries.

## Tests

- `src/lib/bulk-checkin.test.ts` — pure aggregation + distribution
- `src/server/bulk-checkin.int.test.ts` — full pipeline against the test DB
