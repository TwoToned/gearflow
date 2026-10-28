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
| `offInventoryQuantity?: number` | `projectLineItems` | count of flagged units; absent = 0. **The sole input to stock demand.** |
| `offInventory?: true` | `projectLineItemUnits` | which unit is flagged; **the sole input to warehouse behaviour.** |

No backfill (absent = off). `quantity`, `unitPrice`, `lineTotal`, discount and
tax are never touched, so finance/PDF/ROI/allocation need no change.

**Invariant (R-3.1):** per line, `offInventoryQuantity === count(units with
offInventory)`. Written only by the two mutations below (plus the assign-serial
un-flag), all in one transaction; pinned by a test. The line counter exists
because demand is summed across every line of a model on hot queries — reading
unit rows there would be an N+1.

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

- `convertUnitToOffInventoryNative({ organizationId, lineItemId, unitId })`
  - RBAC `project/manage_line_items` **or** `warehouse/check_out` (warehouse
    staff do this at the bench); org-checked via the loader, not at the call
    site; `ConvexError` only.
  - Preconditions: serialised model line, `type EQUIPMENT`, not kit child /
    accessory / sale / sub-hire / container; unit belongs to the line, has no
    `assetId`, status not checked-out/returned/cancelled.
  - Effects: unit `offInventory = true`; line `offInventoryQuantity += 1`;
    optionally (`markPrepped: true`, the warehouse path) unit `prepStatus` →
    prepped and line rollup re-synced via the existing `syncLineItemRollup`.
  - Audit log entry; best-effort webhook like other line writes.
- `convertUnitBackToInventoryNative(...)` — inverse; clears flag, decrements
  counter, un-preps the unit. Non-blocking: if stock is short the overbook
  badge simply returns.
- Assigning a real serial to a flagged unit (existing warehouse/equipment
  assign paths) clears the flag via one shared helper.
- Both get `agentOps` entries (`danger: "medium"`); regenerate
  `pnpm run api:registry && pnpm run api:docs && pnpm run api:mcp`.
  Not a privileged-arg name.

## Warehouse

- Pick/prep tab: an unassigned unit of a line whose model is overbooked
  (existing `OverbookedInfo`) shows **"Prep as custom item"**. Flagged units
  show a `Custom` badge and a manual prep/deploy/return tick (reusing the
  custom-line affordances); a "Convert back" action is available until
  deployed.
- Scan auto-pick (and the checkout/return scan paths) **skip flagged units** —
  scanning a serial must never land on one.
- Fulfilment rollups treat a flagged unit as a normal unit for status
  derivation (it is prepped/deployed/returned like any other), so the line's
  `deriveOrderLineStatus` is unchanged.

## Equipment tab

Expanded per-unit rows get the same action and "Convert back". The collapsed
line shows `1 custom` beside the tag. Overbook badge reflects the new demand.

## Edge cases

- Whole line flagged (qty 3, all 3) → allowed; line shows 0 stock-backed.
- Quantity reduced below flagged count → `patchNative` trims unassigned
  **unflagged** units first, then flagged; counter kept in lockstep.
- Quantity increased → new units are unflagged.
- Version copy / quote revisions / duplicate project: counter and unit flag are
  copied with the rows (same as other unit fields); verify in the version
  clone path.
- Lifecycle/pricing locks: flagging changes no money, so it is not price-gated.

## Testing

`convex-test`: convert + counter/flag lockstep; precondition rejections
(assigned unit, kit child, sale, sub-hire, cross-org line/unit); convert back;
assign-serial un-flag; demand parity — overbook clears across availability,
board, confirm-impact and readiness; quantity patch keeps the invariant; scan
auto-pick skips flagged units. Guard test: no demand site sums raw `quantity`.
jsdom smoke tests that actually open the warehouse action and the Equipment-tab
menu. Registry/docs/MCP regeneration committed.

## Docs (same PR, R-5.2/5.3)

FEATUREDOCS/11, 12, 60, 65; short invariant note in CLAUDE.md ("offInventory is
a unit flag + one line counter; demand always goes through `stockBackedQty`").
