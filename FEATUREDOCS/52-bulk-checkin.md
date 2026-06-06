# Bulk Check-In Totals

Roadmap **Phase 1.3**. A project-wide accessory check-in screen: instead of
returning each parent's accessories one parent at a time, the operator sees the
**total quantity of each accessory due back across the whole job** ("100 clamps",
"50 TrueCons") and checks a counted quantity in with one action. This is the
warehouse-staff workflow — count the pile, tick it off — not a per-light
drill-down.

Depends on [Child Assets / Accessories](./48-child-assets-accessories.md): only
makes sense once accessories are modelled as `childKind: ACCESSORY` child line
items with units.

## Scope of this slice

- Aggregate **deployed accessory child line items** (already materialised on the
  project via the accessory expansion + checkout cascade) into per-identity
  totals. **Bulk** accessories group by `bulkAssetId` (one shared "Clamp" pool
  across every parent); **serialised** accessories group by `modelId` (50 distinct
  TrueCon assets, one model row).
- Return a counted quantity per total in one action, distributing it back across
  the underlying child lines deterministically.
- Does **not** recompute demand from live accessory config — it reads the
  materialised `ProjectLineItem` accessory children (their unit rows are the
  source of truth for what's deployed). Snapshotting per-unit contributions is a
  separate deferred follow-up (see TODOS.md).

## Pure helpers — `src/lib/bulk-checkin.ts`

No Prisma / IO, so the aggregation + distribution rules are unit-tested in
isolation (`src/lib/bulk-checkin.test.ts`).

- `accessoryGroupKey(child)` — `bulk:<bulkAssetId>` | `serial:<modelId>` | `null`
  (unaggregatable). This is the identity a total is keyed on.
- `aggregateAccessoryTotals(children)` → `BulkCheckInTotal[]` — sums
  `outstanding` per key, drops fully-returned children (`outstanding <= 0`),
  returns a deterministically ordered list (kind → label → key).
- `distributeReturn(children, quantity)` → `{ allocations, distributed, requested }`
  — walks a group's children in `(sortOrder, lineItemId)` order, filling each up
  to its `outstanding`. Never allocates beyond a child's outstanding or beyond
  `quantity`. A non-positive `quantity` yields an empty result (the empty/repeat
  no-op). `distributed < requested` is the over-return signal the caller rejects on.

## Server actions — `src/server/bulk-checkin.ts`

- **`getBulkCheckInTotals(projectId)`** — read-only, `getOrgContext()`-scoped.
  Loads every `childKind: ACCESSORY` line on the project with its unit rows,
  computes each child's `outstanding` (sum over `CHECKED_OUT` units of
  `quantity - returnedQuantity`, with a denormalised line-counter fallback for
  any legacy unit-less child), and returns the aggregated, serialised totals.
- **`checkInBulkAccessoryTotals(projectId, returns)`** —
  `requirePermission("warehouse", "check_in")`, all work in one
  `prisma.$transaction`.
  - **Authoritative outstanding.** Quantities are recomputed server-side from the
    live unit rows inside the transaction; the client's numbers are never trusted.
  - **Distribution.** Per requested total, `distributeReturn` maps the quantity to
    concrete child lines; each allocation is applied through the canonical
    `returnLineUnits` helper (`src/server/line-item-fulfillment.ts`) — the SAME
    physical-return primitive the per-parent `checkInItems` path uses, so the two
    flows can't drift. Serialised allocations flip the asset's unit (and asset
    status by condition); bulk allocations accumulate onto the shared bulk unit's
    `returnedQuantity`, flipping to `RETURNED` only once fully back.
  - **Over-return rejected.** If a requested quantity exceeds what is currently
    deployed for that identity (`distributed < requested`), the whole batch throws
    and the transaction rolls back — nothing is returned.
  - **Idempotent / empty-safe.** Entries with `quantity <= 0` are skipped; an
    empty `returns` array is a clean no-op; `returnLineUnits` clamps every child,
    so a repeated submit can never drive a child below zero. Repeated partial
    returns simply accumulate until the identity is fully returned (then drops off
    the totals), and a further attempt is rejected as an over-return.
  - **Audit.** Per-asset `AssetScanLog` rows for serialised returns + a per-group
    summary scan log, and a `logActivity("CHECK_IN")` per returned group.

## UI — `src/components/warehouse/bulk-checkin-tab.tsx`

A self-contained **Bulk Check-In** tab on the warehouse project page
(`src/app/(app)/warehouse/[projectId]/page.tsx`), alongside Pick/Prep, Deploy,
Return, and Close-Out. Follows the `CloseOutTab` pattern: own query
(`getBulkCheckInTotals`) + mutation (`checkInBulkAccessoryTotals`),
`useCanDo("warehouse", "check_in")` gating, `EmptyState` when nothing is
deployed.

Each total renders as a row with its label, "Due Back" count, and a number input
defaulting to the full outstanding. A single condition select (Good / Damaged /
Missing) applies to the batch, mirroring the Return tab's global condition.
Over-typed quantities are flagged inline and block submit. On success it
invalidates both `bulk-checkin-totals` and `warehouse-project` queries so the
Return tab's counts update. The existing per-parent Return tab is untouched —
this is an additive, parallel view over the same accessory child data and the
same `returnLineUnits` primitive.

## Tests

- `src/lib/bulk-checkin.test.ts` — pure aggregation + distribution (12): grouping
  keys, cross-parent bulk sum, serialised-by-model sum, fully-returned exclusion,
  deterministic order, in-order partial fill, exact-total fill, over-request
  capping, zero/negative no-op, order-independence.
- `src/server/bulk-checkin.int.test.ts` — full pipeline against the test DB (7):
  aggregation across two distinct parent lines, partial aggregate return
  distributes deterministically across child lines, over-return rejected (tx
  rolled back), empty/zero submit safe no-op, repeated partial returns accumulate
  without over-returning, serialised-by-model aggregation + one-at-a-time return,
  and the existing per-parent `checkInItems` cascade still returns a parent's own
  accessory.

## Not in this slice (deferred)

- Per-unit accessory contribution snapshots at deploy (bulk demand/return is still
  recomputed live — see the "Snapshot per-unit accessory contributions" TODO).
- Bulk parents ("50 lights each with 2 clamps" where the *parent* is bulk) — v1
  accessory parents are serialised only, so totals come from per-line accessory
  children, not a single bulk parent line.
- Per-row condition (the batch shares one condition); per-accessory pricing.
