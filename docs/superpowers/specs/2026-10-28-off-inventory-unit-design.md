# Off-inventory unit ("Prep as custom item")

> Status: approved in chat 2026-10-28. Owner: Jayden Nawotka.

## Problem

A job books 3× Model X (serialised) but only 2 are free. Today the third unit
shows as overbooked and there is no way to say "I'll source this one outside the
fleet — it's temporary" without breaking the line apart. Splitting it into a
separate custom line loses the model link (docs, grouping, price).

## Goal / success criteria

- One click converts **one unassigned unit** of a model line into an
  **off-inventory unit**: still part of the line (`3× X` on quotes, invoices,
  PDFs, groups, categories — price untouched), but not backed by a serial and
  **not counted as stock demand**, so the overbook clears.
- Primary entry point: the **warehouse pick/prep screen** ("Prep as custom
  item" — flags the unit and marks it prepped). Secondary: the Equipment tab's
  per-unit rows. Same mutation.
- Flagged units are prepped / deployed / returned by manual tick, like existing
  custom lines — no scanning.
- Reversible in one click ("Convert back to inventory"); assigning a real serial
  to a flagged unit also un-flags it.

## Non-goals (YAGNI)

Auto-revert when stock frees up; bulk (non-serialised) models; a separate
cost/price for the flagged unit; kit children, accessories, sale and sub-hire
lines.

## Data model

| Field | Table | Meaning |
|---|---|---|
| `offInventoryQuantity?: number` | `projectLineItems` | how many of the line's units are off-inventory; absent = 0. **The single source of truth** for stock demand and for the "custom" display. |

No per-unit flag (it would be a second copy of the same fact, R-3.1). The
fulfilment side already has the needed shape: a **generic unit** (a
`projectLineItemUnits` row with no `assetId`/`bulkAssetId`, quantity 1 —
created by `prepUnit`'s untagged-multi-quantity branch) counts toward
`assignedQuantity`, so the scan path's spare-capacity test
(`assignedQuantity < quantity`, `src/server/warehouse.ts`) already stops a scan
from filling the custom slot. Converting a unit creates one generic unit and
bumps the counter in the same transaction; converting back removes one
not-yet-deployed generic unit and decrements it.

No backfill (absent = off). `quantity`, `unitPrice`, `lineTotal`, discount and
tax are never touched, so finance/PDF/ROI/allocation need no change.

**Invariant:** for a line with `offInventoryQuantity = k`, it has at least `k`
generic units after conversion; `quantity ≥ k` always (a quantity patch below
`k` is rejected with "convert N back first"). The counter lives on the line
because demand is summed across every line of a model on hot queries.

## Stock demand — single helper

`stockBackedQty(line) = max(0, (line.quantity ?? 0) − (line.offInventoryQuantity ?? 0))`
in a plain module shared by Convex and `src/` (placed where both can import,
alongside the existing availability/overbooking cores). Every site that sums
`quantity` as stock demand switches to it. Known sites (the plan opens with a
full `by_modelId` / `quantity` audit and a guard test that fails if a demand
site sums raw `quantity`):

- `convex/lib/availabilityCore.ts` (booked sum, ~L253)
- `convex/availability.ts` (windowed demand rows, ~L149)
- `convex/availabilityCheck.ts`
- `convex/overbooking.ts` + `src/lib/overbooking-core.ts` (`bumpTotal` /
  `bumpClaim`, ~L353)
- `convex/lib/overbookingBoard.ts` (`applyDemandLine`, ~L203),
  `overbookingFetch.ts`, `overbookingConfirmImpact.ts`
- in-mutation availability checks in `convex/lineItemWrites.ts`
  (`addNative`, `addLineItemSmartNative`, `patchNative`)
- `projectReadiness` shortage check (shares `ownGearModelIds`)

The overbook badge, the Overbookings board, the confirm gate and readiness all
clear automatically once the helper is in.

## Mutations (`convex/lineItemWrites.ts` or a sibling `*Writes.ts`)

Following the existing warehouse pattern: `*Core` functions in
`convex/warehouseOps.ts`, a browser-direct wrapper in `convex/warehouseWrites.ts`
(kill-switch + `enforceBrowserWriteLimit` + RBAC `warehouse/check_out`, boundary
org checks, audit via `writeActivityLog`, `resolveActor`) and a method on
`useWarehouseWrites`. No `requireService` mirror (nothing server-side calls it).

- `convertUnitToOffInventoryCore(ctx, { organizationId, projectId, lineItemId, prep, now })`
  - Preconditions: line in org+project; `type EQUIPMENT`; has `modelId`; not
    kit child / accessory child / container / sale / sub-hire / cancelled; the
    model is serialised (the line is not bulk-backed); a free slot exists:
    `quantity − offInventoryQuantity − (units with an asset/bulk) ≥ 1`.
  - Effects: `offInventoryQuantity += 1`; insert one generic unit (qty 1,
    `status CONFIRMED`, `prepStatus` `PACKED` when `prep`, else `PENDING`);
    `syncLineItemRollup`. Returns `{ unitId, offInventoryQuantity }`.
- `convertUnitBackToInventoryCore(ctx, { organizationId, projectId, lineItemId, now })`
  — removes the highest-ordinal generic unit that is not `CHECKED_OUT` /
  `RETURNED`, decrements the counter, re-syncs the rollup. Rejects when
  `offInventoryQuantity` is 0 or every generic unit is already out. Non-blocking:
  if stock is short the overbook badge simply returns.
- `prepUnit`'s generic branch first flips existing not-packed generic units to
  `PACKED` (so a planning-time conversion is prepped by one tick) before
  inserting new ones.
- `lineItemWrites.patchNative`: a quantity patch below `offInventoryQuantity`
  throws `ConvexError`.
- Wrappers `warehouseWrites.convertUnitToOffInventory` /
  `convertUnitBackToInventory` get `agentOps` entries (`danger: "medium"`);
  regenerate `pnpm run api:registry && pnpm run api:docs && pnpm run api:mcp`.
  No privileged-arg names.

## Warehouse

- Pick/prep tab: a line whose model is overbooked (existing `OverbookedInfo`)
  and that still has a free slot shows **"Prep as custom item"** (calls the
  convert mutation with `prep: true`). A line with `offInventoryQuantity > 0`
  shows a `N custom` badge and a "Convert back" action while a custom unit is
  not yet deployed.
- Scan path: no change needed — the generic unit counts toward
  `assignedQuantity`, so `lookupAssetForScan` no longer offers the filled slot.
  A test pins this.
- Deploy/return of generic units uses the existing untagged-unit flow
  (`warehouseOps` generic picker); verified by a test.
- Rollups are unchanged: a generic unit is prepped/deployed/returned like any
  other, so `deriveOrderLineStatus` needs no edit.

## Equipment tab

The line's kebab menu gets "Convert 1 to custom item" (`prep: false`; the unit
is created `PENDING` and the warehouse ticks it) and "Convert 1 back to
inventory". The line shows `N custom` beside the tag. Overbook badge reflects
the new demand.

## Edge cases

- Whole line flagged (qty 3, all 3) → allowed; line shows 0 stock-backed.
- Quantity reduced below `offInventoryQuantity` → rejected (convert back first).
- Quantity increased → the new units are ordinary stock-backed units.
- Version copy / quote revisions / duplicate project: the counter is a line
  field and rides the row copy; verify in the version-clone path.
- Lifecycle/pricing locks: flagging changes no money, so it is not price-gated.

## Testing

`convex-test`: convert creates counter + generic unit; precondition rejections
(no free slot, kit child, sale, sub-hire, bulk model, cross-org line); convert
back (and rejection when the custom unit is deployed); `prepUnit` flips a
PENDING generic unit; demand parity — overbook clears across availability,
board, confirm-impact and readiness; quantity patch below the counter is
rejected; the scan spare-capacity test no longer offers the filled slot. Guard
test: no demand site sums raw `quantity`.
jsdom smoke tests that actually open the warehouse action and the Equipment-tab
menu. Registry/docs/MCP regeneration committed.

## Docs (same PR, R-5.2/5.3)

FEATUREDOCS/11, 12, 60, 65; short invariant note in CLAUDE.md ("offInventory is
a unit flag + one line counter; demand always goes through `stockBackedQty`").
