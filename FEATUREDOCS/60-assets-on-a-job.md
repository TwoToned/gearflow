# 60 — Assets on a Job (per-unit display + reassign)

The project **Equipment tab** shows which specific serialised assets are
prepped / deployed / returned on a job, down to the individual unit, and lets
you correct which line an auto-picked asset landed on. The record survives
check-in and close-out, so a finished job still answers "what physically went
out." Builds on the fulfillment model in
[docs/designs/line-item-fulfillment-model.md](../docs/designs/line-item-fulfillment-model.md)
and the equipment tree in [47](./47-cross-type-equipment-unification.md).

## Where a serial actually lives (three cases)

A physical asset is bound to a line, never "to the job". Reading it back depends
on the container — see also [48](./48-child-assets-accessories.md):

| Line kind | Serial stored on | Shown as |
|---|---|---|
| Loose / group member, qty 1 | `projectLineItem.assetId` (single) | inline tag next to the name |
| Loose / group member, qty ≥2 | one `projectLineItemUnit.assetId` per unit | expandable per-unit rows |
| **Physical kit member** | one `projectLineItemUnit` per member (seeded at kit-add, like loose gear) | tag + fulfillment badge + history via the same indicator as every line; verified *with* the kit, not scanned per line |
| Accessory child | `projectLineItemUnit` (`parentUnitAssetId` link) | tag on the child row |

> Physical kit members were migrated onto per-unit `projectLineItemUnit` rows (the
> kit per-unit fulfillment migration — `docs/designs/kit-per-unit-fulfillment.md`).
> They still keep `line.assetId` for now, but fulfillment (deploy/return status,
> history) is driven by the unit. A kit member binds to its slot, so instead of the
> loose "Move to another line" it offers **"Swap"** — pick a same-model available
> serial (before deployment). See `reassignKitMemberSerial` + the model-based kit
> composition parity guard.

A **group** (`projectGroups`) is a priced bundle only — it adds nothing to serial
storage; its members behave exactly like loose lines. Only a **kit** (`kits`, has
its own `assetTag`) binds members differently.

## Data flow

The tab reads everything from the one live `equipmentTab.bundle` subscription:

1. `convex/equipmentTab.ts` — `bundle` now also loads `projectLineItemUnits`
   (one indexed read per line, all statuses kept) and returns them as `units`.
2. `src/lib/equipment-tab-reconstruct.ts` — resolves each unit's `{ id, assetTag }`
   asset/bulk select and feeds a real `unitsByLineItem` map into `reconstructScope`
   (previously an empty map — the root cause of the tab showing no tags). `expand()`
   attaches units to every line and recurses into kit/accessory children.
3. `src/components/projects/equipment-rows.tsx` — renders them (below).

This mirrors the pull-sheet / `getProject` reconstruct
(`src/lib/project-equipment-reconstruct.ts` `reconstructProjectEquipmentTree`),
which already loaded units.

## Display rules (`equipment-rows.tsx` + `equipment-row-descriptors.ts`)

- **Single tagged unit** → tag rendered inline next to the line name.
- **≥2 tagged units** (`describeRow().hasExpandableUnits`) → an expand chevron;
  expanding lists one row per unit: `Unit N · TAG · [status badge]`.
- **Kit / accessory children** → their tag renders on the child row.
- **Status badge** (`unitFulfillmentBadge`): Reserved / Assigned / Prepped /
  **Deployed** (red) / **Returned** (green, or warn/red if damaged/missing) — same
  vocabulary as the warehouse Deploy/Return tabs ([12](./12-warehouse.md)).

The pure descriptor + badge logic lives in `equipment-row-descriptors.ts` (no
React) so it is unit-testable; `equipment-rows.tsx` re-exports it.

## Reassign (correct the auto-pick)

A bare scan auto-picks the first open same-model line by sort order — it can't
be steered ([12](./12-warehouse.md)). Reassign lets you move a serial afterwards
without re-scanning.

- **Mutation** `convex/warehouseOps.reassignSerialisedUnit`: moves a unit's
  `lineItemId` (new ordinal on the target), then `syncLineItemRollup` on both
  lines. The physical asset does **not** move (same project, same deployment).
  Guards (all `ConvexError`): serialised + not RETURNED/CANCELLED; target same
  org + project + model; not a kit child; no duplicate `(line, asset)`; target
  not already fully assigned.
- **Server action** `src/server/warehouse.reassignLineItemUnit`:
  `requirePermission("warehouse", "check_out")` + `logActivity`. No revalidate —
  the live subscription reflects the move.
- **UI**: each expanded per-unit row has a "Reassign" dropdown of the other
  same-model lines on the project, labelled by their category/group so two
  same-model lines are distinguishable. Wired via
  `src/components/projects/reassign-context.tsx` (Provider in `equipment-tab.tsx`,
  consumer in the unit row) to avoid threading props through every `LineItemRow`
  call site. Returned units offer no control (history).

## History retention

RETURNED unit rows persist through check-in **and** close-out and render inline
with a green "Returned" badge, so a closed job still shows what went out.
Reinforced by:

- `convex/checkRecordOps.ts` `deprepItemInner` excludes RETURNED/CANCELLED units
  from the deletable set — plain deprep can no longer destroy returned history.
- The append-only `assetScanLog` (CHECK_OUT/CHECK_IN with `assetId` + `projectId`)
  is the durable backstop, surviving return/deprep/close.
- **Movement history**: each per-unit row has a clock button (`unit-history-popover.tsx`)
  that, on open, fetches that serial's recent scan events via the existing
  `getScanLog` action and shows them most-recent-first (action · project · who ·
  when). Read-only, on-demand — doesn't weigh down the live subscription.

## Known gaps

- **Generic / quantity deploys record no serial** (`assetId: null`) — such lines
  show a count, not tags; unreconstructable by design. Surfacing "N deployed — no
  serials recorded" (vs faking a tag) is the honest treatment and pushes scan
  discipline.
- Hard-deleting a **project** removes unit rows (scan log survives); hard-deleting
  the **scanning user** removes their scan events. Both are rare admin actions.

## Key files

- `convex/equipmentTab.ts`, `convex/warehouseOps.ts` (`reassignSerialisedUnit`),
  `convex/checkRecordOps.ts` (deprep guard)
- `src/lib/equipment-tab-reconstruct.ts`, `src/lib/project-equipment-reconstruct.ts`
- `src/components/projects/equipment-rows.tsx`, `equipment-row-descriptors.ts`,
  `reassign-context.tsx`, `equipment-tab.tsx`
- `src/server/warehouse.ts` (`reassignLineItemUnit`)
