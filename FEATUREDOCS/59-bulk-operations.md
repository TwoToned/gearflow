# 59 — Bulk Operations (multi-select)

Multi-select + bulk actions on list/table surfaces. **Phase 1 covers the project
Equipment / line-items surface**; the shared pieces are built to scale to the
other project surfaces (services, crew, tasks) and beyond.

## What ships in Phase 1

On a project's **Equipment** tab you can now select multiple line items (row
checkboxes + a header select-all) and act on the whole selection at once:

- **Delete** — batched cascade removal with a typed-confirmation dialog.
- **Move to group / Move to category** — reassign the whole selection to one
  destination.
- **Bulk edit** — set shared fields across the selection: **pricing type,
  discount ($/%), notes, and the optional flag**. Per-item-only fields
  (quantity, unit price, description) are deliberately excluded; hire dates
  aren't line-item fields.

## Selection UX

- Selection state is the existing `useSelection()` hook
  (`src/components/projects/use-selection.ts`) — a `Set<string>` of prefixed
  sortable keys (`li-<id>`, `grp-<id>`, `cat-<id>`). Bulk ops act only on the
  `li-` keys. A `selectAll(ids)` method was added for the header checkbox.
- A checkbox renders at the **start of each selectable line-item's name cell**
  (only for top-level lines — `!isKitChild`). This avoids adding a table column,
  so the hierarchical category → group → line layout and every `colSpan` stay
  intact. It's visible on hover, or always while a selection exists.
- Row-click selection (plain / cmd / shift) still works alongside the
  checkboxes; the checkbox also supports shift-range.
- The **`BulkActionBar`** (`src/components/ui/bulk-action-bar.tsx`) appears once
  ≥1 item is selected — a shared "{n} selected + actions + Clear" bar extracted
  from the Assets pattern (`asset-table.tsx`). Escape clears the selection.

## Server actions (batched)

All three collapse the old N-client-round-trips loop into **one** server action.
Each loops the **legacy** Convex mutations server-side (so no per-item recalc),
then recalcs each affected project **once** and writes **one** bulk activity log
— the pattern proven by `moveLineItemToGroup` and `bulkUpdateServiceStatus`. No
Convex schema/mutation changes were needed.

| Action | File | Notes |
|---|---|---|
| `removeLineItemsBatch(ids)` | `src/server/line-items.ts` | Loops `projectLineItems.removeLineItemCascade`. Kit/accessory/sub-hire **children are skipped** (removed via their parent) and reported in `skipped`. |
| `updateLineItemsBatch(ids, patch)` | `src/server/line-items.ts` | `patch` = `BulkLineItemPatch` (pricingType / discount / notes / isOptional). A `%` discount resolves against each item's own base; `lineTotal` is recomputed per item when the discount changes. |
| `moveLineItemsToGroup({ lineItemIds, targetGroupId, targetCategoryId })` | `src/server/project-groups.ts` | Bulk variant of `moveLineItemToGroup`; refreshes `suggestedPrice` for every touched group (sources + destination). This fills the one gap the batching design doc flagged (#10). |

All three require `requirePermission("project", "manage_line_items")` and
`serialize()` their `{ removed|updated|moved, skipped }` result.

Validation: `moveLineItemsSchema` in `src/lib/validations/project-group.ts`.

## UI components

- `src/components/projects/bulk-edit-line-items-dialog.tsx` — the bulk-edit
  overlay. Each field has its own **enable toggle** so an untouched field is
  never overwritten; Apply is disabled until ≥1 field is enabled.
- Bulk **move** reuses the existing single-item pickers
  (`MoveItemToGroupDialog` / `MoveItemToCategoryDialog`) opened with a sentinel
  `lineItemId="__bulk__"`; the echoed id is ignored in favour of the current
  selection.
- Bulk **delete** reuses the shared `BulkDeleteDialog`
  (`src/components/ui/bulk-delete-dialog.tsx`).

Wiring lives in `src/components/projects/equipment-tab.tsx` (mutations, derived
selection state, header select-all, bar, dialogs) and
`equipment-rows.tsx` (`LineItemRow` checkbox + `selectable`/`onSelectChange`
props).

## Tests

- `use-selection.test.ts` — extended with `selectAll` coverage (replace-not-merge,
  and range-extend after select-all).
- `bulk-edit-line-items-dialog.smoke.test.tsx` — jsdom render + enable-toggle
  gating (per the CLAUDE.md rule that new overlay UI gets a render smoke test).

## Follow-ups

- **Integration tests** for the three batch server actions (mirroring
  `*-batch.int.test.ts`) — pending; they need the live-Convex int harness.
- **Phase 2+**: extend selection + a bulk bar to the **Services** (wire the
  existing `bulkUpdateServiceStatus` + a new bulk delete), **Crew** (new bulk
  delete / status), and **Tasks** (new bulk update/delete) surfaces.

Related: [bulk-operations batching design](../docs/designs/bulk-operations-batching.md),
[47 Cross-Type Equipment Unification](./47-cross-type-equipment-unification.md).
