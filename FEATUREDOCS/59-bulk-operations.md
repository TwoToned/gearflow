# 59 — Bulk Operations (multi-select)

Multi-select + bulk actions on list/table surfaces. Shipped across **all four
project surfaces** — Equipment (Phase 1), then Services, Crew, and Tasks
(Phases 2–4). The shared pieces (`useSelection`, `BulkActionBar`,
`BulkDeleteDialog`) are built to scale to other surfaces beyond projects.

## Other project surfaces (Phases 2–4)

Each surface reuses `useSelection` (plain row ids), renders per-row/-card
selection checkboxes (hover-reveal + a select-all), and a `BulkActionBar`.

| Surface | Bulk actions | Server actions |
|---|---|---|
| **Services** (`services-panel.tsx`) | Set status · Delete | `bulkUpdateServiceStatus` (existed), `bulkDeleteProjectServices` (new — unlink+cascade line item, remove service, cascade crew assignments) |
| **Crew** (`crew-panel.tsx`) | Set status · Remove | `bulkUpdateAssignmentStatus`, `bulkDeleteAssignments` (new, `crew` update/delete gated; leading checkbox column threaded through `PhaseGroup`) |
| **Tasks** (`tasks-panel.tsx`) | Move to status · Priority · Delete | `bulkUpdateProjectTasks`, `bulkDeleteProjectTasks` (new) |

All new batch actions follow the same shape: one bulk Convex mutation that loops
inside a single transaction, then one recalc per affected project (where totals
apply) + one bulk audit; missing/foreign ids are skipped and reported.

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

> **⚠️ Superseded (Phase 3 browser-direct).** The server-action layer this
> section describes (`src/server/line-items.ts`, `src/server/project-groups.ts`)
> is gone — line-item bulk ops are now browser-direct via
> `convex/lineItemWrites.ts` (`removeManyNative`/`patchManyNative`/
> `reorderNative`, called through `src/hooks/use-line-item-writes.ts`), which
> fold the same single-transaction batching + org-scoping this section
> documents, plus a 500-item size cap and in-mutation `lineTotal` recompute
> (never trusts a client-supplied value). The `projectLineItems.listByIdsForOrg`
> / `patchMany` / `removeManyCascade` and `projectServices.removeManyCascade` /
> `patchManyStatus` mutations named below were deleted as dead code once their
> only callers (these server actions) were removed — kept here as a historical
> record of the pre-migration design, not a description of current behavior.

## Server actions (batched)

Each bulk action is **one server-action call → one bulk Convex mutation**. The
per-item loop runs backend-local **inside a single Convex transaction** (see the
`*Many*` mutations in `convex/projectLineItems.ts`, `projectServices.ts`,
`crewAssignments.ts`, `projectTasks.ts`), not one server→Convex round-trip per
item. Where per-row maths is needed (bulk edit discount, move source groups) the
action first does **one** `listByIdsForOrg` read, computes the per-row patches,
then issues the single `patchMany`. After the bulk mutation returns the affected
`projectIds`, the action does **one** recalc per project + **one** bulk audit.
Wall-clock is independent of the selection size. Rows are org-scoped **per row**
inside every bulk mutation (`by_cuid` is a global index — CLAUDE.md); foreign /
child rows are skipped and counted.

| Action | File | Notes |
|---|---|---|
| `removeLineItemsBatch(ids)` | `src/server/line-items.ts` | One `projectLineItems.removeManyCascade`. Kit/accessory/sub-hire **children are skipped** (removed via their parent) and reported in `skipped`. |
| `updateLineItemsBatch(ids, patch)` | `src/server/line-items.ts` | `patch` = `BulkLineItemPatch` (pricingType / discount / notes / isOptional). One `listByIdsForOrg` read → per-row patches (`%` discount resolves against each item's own base, `lineTotal` recomputed when discount changes) → one `patchMany`. |
| `moveLineItemsToGroup({ lineItemIds, targetGroupId, targetCategoryId })` | `src/server/project-groups.ts` | One `listByIdsForOrg` → one `patchMany`; refreshes `suggestedPrice` for every touched group (sources + destination, bounded by group count). Fills the gap the batching design doc flagged (#10). |

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

## Warehouse batch ops — audit + check-record round-trip collapse

Bulk warehouse actions (check-out / return / prep / deprep / kit batch) had already
collapsed their *state* mutations into single atomic Convex calls, but two sequential
per-item loops remained on the hot paths and made them feel one-item-at-a-time:

1. **Per-item `logActivity`** — every batch action looped `await logActivity(...)`
   (one Postgres insert + one Convex mirror mutation *per item*) after the batched
   state write. Now `logActivityMany(inputs)` (`src/lib/activity-log.ts`) writes all
   N audit rows in ONE `prisma.createMany` + ONE `api.activityLogWrites.recordMany`
   mutation. One audit row per item is preserved (per-item granularity intact) — only
   the transport is batched. Applied in `warehouse.ts` (`checkOutItems`,
   `checkInItems`, `undeployItems`, `unreturnItems`, `checkOutKitsBatch`,
   `checkInKitsBatch`) and `check-records.ts` (`prepItemsBatch`, `deprepItemsBatch`).
2. **Per-record check-write** — `writeCheckRecordsToConvex` fired one
   `checkRecords.createIfMissing` per record; a check submission is (N line items × M
   check items) records. Now one `api.checkRecords.createManyIfMissing` batched
   mutation (still idempotent per cuid, one doc per record).
3. **Kit batch loops** — `checkOutKitsBatch` / `checkInKitsBatch` ran one serial
   Convex round-trip per kit. Now `Promise.allSettled` fires them concurrently; each
   kit keeps its own atomic mutation/transaction so **per-kit error isolation is
   preserved** (a failing kit doesn't abort the rest), and the audit is written via
   `logActivityMany`. Caveat: concurrent kit ops on the SAME project touch shared line
   rollups → Convex may OCC-retry (auto-retried, stays correct; minor contention on
   very large same-project batches).

New Convex mutations: `activityLogWrites.recordMany`, `checkRecords.createManyIfMissing`
— both loop `insert`/`createIfMissing` internally in one transaction.

## Follow-ups

- **Integration tests** for the batch server actions (mirroring
  `*-batch.int.test.ts`) — pending; they need the live-Convex int harness.
- Extend the pattern to non-project surfaces as needed (the primitives are
  surface-agnostic).

Related: [bulk-operations batching design](../docs/designs/bulk-operations-batching.md),
[47 Cross-Type Equipment Unification](./47-cross-type-equipment-unification.md).
