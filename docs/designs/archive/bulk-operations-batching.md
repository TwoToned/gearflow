# Bulk-Operation Batching — N+1 round-trip audit & fix plan

**Status:** audit complete; **all Class 1 + Class 2 waves shipped** (prep, deprep,
project managers, crew time, kits, project duplicate/template, sub-hires, bulk
asset create, model rate/T&T + reorder, and the Class 2 mirror-loop cascades) plus
the read-side asset-picker availability fix. Created 2026-07-06.
**Owner intent:** the app "takes ages" on bulk actions (select many assets → prep,
submit item checks, etc.). Root cause is **one server-action round-trip per item**
in a client loop. Fix = batch each into a single call.

This is effectively an early, high-value slice of **native writes** — scoped to the
hottest bulk paths. Batch the round-trip first; go fully Convex-native only where
it's clean.

---

## The two classes (they are NOT the same problem)

### Class 1 — Client → server round-trips  ← **the felt slowness, fix first**
The browser fires one Next server-action (network round-trip) **per item** in a loop.
N items = N sequential round-trips. This is what the user experiences as "takes ages."
**Fix:** add a batch server action / mutation that takes `items[]` and does all the
work in one call (ideally one `prisma.$transaction` + one batched Convex mirror write).

### Class 2 — Server-side Convex mirror loops  ← follow-up, mechanical
Inside a server action: `for (const x of rows) await removeXFromConvex(x.id)`. These
are **not** browser round-trips — they run within a single request. But a cascade
(delete a project with 200 line items → 200 sequential Convex HTTP calls) still takes
many seconds. **Fix:** `Promise.all(...)` the mirror calls, or add a batched Convex
mutation. Lower priority; no per-click UX impact, but real cascade latency.

---

## The pattern to copy (already in the codebase)

Check-**in** is already batched — mirror its shape for everything else:
- Client: `checkInMutation.mutateAsync({ items: [...] })` (single call)
- Server: `checkInItems(projectId, items[])` in `src/server/warehouse.ts`

Contrast with prep, which loops `prepItemDirect` per item. Prep never got the batch
treatment; that's the template gap.

---

## Conventions every batch action must follow (from CLAUDE.md)
- `"use server"`, `serialize()` all return values.
- `requirePermission(resource, action)` for writes; `logActivity()` for audit
  (one summary entry, or per-item — match the existing single-item action's logging).
- Convex mirror writes use `createIfMissing` (never `create`) and any `convex/*.ts`
  you touch throws `ConvexError` (never plain `Error`).
- **Preserve behaviour exactly** — only collapse round-trips. Same fulfillment /
  prepStatus / accessory-child / container / quantity outcomes.
- **Honour ordering constraints.** Prep has: *"Sequential to avoid race conditions
  when items share the same lineItemId."* A batch action must group by `lineItemId`,
  apply each group in order server-side, and may parallelize across distinct lines.
- **Test rule:** for each batch action, add/extend an integration test proving the
  batch produces an **identical DB result** to the old per-item loop (incl. the
  same-`lineItemId` ordering case). Warehouse prep tests live in
  `src/server/warehouse-prep.int.test.ts`.

---

## Class 1 inventory (client round-trips) — fix first

Line numbers drift; the **grep anchor** is the reliable locator. All warehouse sites
are in `src/app/(app)/warehouse/[projectId]/page.tsx`.

| # | Location (grep anchor) | Looped single-item action | Trigger / count driver | Sev | Fix |
|---|---|---|---|---|---|
| 1 | ✅ warehouse page — `for (const i of checkQueueDirectItems)` → `prepItemDirect` | `prepItemDirect` | finish check queue, prep remaining | HIGH | ✅ `prepItemsBatch(projectId, items[])` |
| 2 | ✅ warehouse page — `for (const bi of bulkNoCheckItems)` nested `for (let i=0;i<bi.quantity` → `prepItemDirect` | `prepItemDirect` | "Prep Selected", bulk items × qty | **HIGH** (10×5=50 calls) | ✅ client-expanded qty into `prepItemsBatch` (merged with #3 into one call) |
| 3 | ✅ warehouse page — `for (const item of readyItems)`/`readyNoCheckItems` → `prepItemDirect` | `prepItemDirect` | "Prep Selected", serialized | HIGH | ✅ `prepItemsBatch` |
| 4 | ✅ warehouse page — asset-picker confirm IIFE `for (... of withoutChecks) await prepItemDirect` | `prepItemDirect` | asset-picker confirm | MED | ✅ `prepItemsBatch` |
| 5 | ✅ warehouse page — deprep handler loop → `deprepItem` / `deprepKit` | `deprepItem`,`deprepKit` | "Deprep" selected (unbounded) | HIGH | ✅ `deprepItemsBatch(projectId, ops[])` (item + kit ops) |
| 6 | warehouse page — `for (const kitItemId of kitLineItemIds)` → `checkOutKit` | `checkOutKit` | bulk-deploy kits | MED | new `checkOutKitsBatch` |
| 7 | warehouse page — kit return loop → `checkInKit` | `checkInKit` | bulk-return kits | MED | new `checkInKitsBatch` |
| 8 | `src/components/projects/project-wizard.tsx` — `Promise.all([...toAdd.map(addProjectManager), ...toRemove.map(removeProjectManager)])` | `addProjectManager`/`removeProjectManager` | manager selection delta on create | HIGH | new `setProjectManagers(projectId, userIds[])` (diff server-side) |
| 9 | `src/components/projects/project-form.tsx` — same manager add/remove fan-out | `addProjectManager`/`removeProjectManager` | manager selection delta on edit | HIGH | reuse `setProjectManagers` |
| 10 | `src/components/projects/equipment-tab.tsx` — multi-select move, `Promise.all(...map(moveLineItemToGroup))` | `moveLineItemToGroup` | drag N selected line items to a group | HIGH | new `moveLineItemsToGroup(moves[])` |
| 11 | `src/app/(app)/crew/timesheets/page.tsx` **and** `src/app/(app)/crew/page.tsx` — `for (const crewId of selectedCrewIds) await createTimeEntry(...)` | `createTimeEntry` | log time for N selected crew | HIGH | new `createTimeEntries(data, crewMemberIds[])` (`createMany`) |

Single-item actions live in: `src/server/check-records.ts` (`prepItemDirect` 334,
`pullItem` 220, `deprepItem` 394, `unpackItem` 625, `deprepKit`, `prepKitChildren`),
`src/server/warehouse.ts` (`checkOutKit`, `checkInKit`, `checkInItems` ← the batched
template), `src/server/project-managers.ts`, line-item move action, crew time-entry action.

---

## Class 2 inventory (server-side Convex mirror loops) — follow-up sweep

Mostly `for (const x) await removeXFromConvex(x.id)` in cascade delete/archive. Fix by
`Promise.all` or a batched Convex mutation. No per-click UX impact; improves cascades.

**Sweep started (2026-07-06):** the highest-cardinality cascades are done via
`Promise.all` — `models.ts` deleteModel (assets + bulk assets), `projects.ts`
deleteProject (line-item cascade + crew-assignment cascade + kit resets — the
200-line cascade was the worst), `kits.ts` deleteKit (check-items + media),
`supplier-orders.ts` (order items). Remaining (lower cardinality / need review):
`models.ts` bulkUpdateRates, `warehouse.ts` force-return, `project-categories.ts`,
`sub-hires.ts`, `line-items.ts`, `document-templates.ts`, `crew-assignments.ts`,
`crew-scheduling-mirror.ts`, `site-admin.ts`.

| File (grep anchor) | Looped mirror call | Cascade trigger |
|---|---|---|
| `src/server/models.ts` archiveModel | `removeAssetFromConvex`/`removeBulkAssetFromConvex` per asset | archive model w/ many assets |
| `src/server/models.ts` bulkUpdateRates | `patchModelInConvex` per model | rate-card bulk edit |
| `src/server/warehouse.ts` force-return (×3 sites) | `upsertProjectLineItemsToConvex` per project | bulk force-return assets |
| `src/server/projects.ts` deleteProject | `removeLineItemFromConvex` per line item | delete project |
| `src/server/project-categories.ts` | `removeProjectGroupFromConvex` per group | delete category |
| `src/server/kits.ts` archiveKit / deleteKit | `removeKit*FromConvex` per member | archive/delete kit |
| `src/server/sub-hires.ts` | `removeLineItem/SubHireItem/SubHireGroupFromConvex` | delete sub-hire |
| `src/server/supplier-orders.ts` | `removeSupplierOrderItemFromConvex` per item | delete supplier order |
| `src/server/line-items.ts` | `removeLineItemFromConvex` per child | delete line item w/ accessories |
| `src/server/document-templates.ts` | `patchDocumentTemplateInConvex` per prior default | set default template |
| `src/server/crew-assignments.ts` | `removeCrewShiftFromConvex` per shift | regenerate shifts on assignment update |
| `src/lib/crew-scheduling-mirror.ts` (cascades ~150/224–237) | `removeSafe`/`upsert` per shift/entry/cert/availability | delete crew assignment / member |
| `src/server/site-admin.ts` user-delete | multiple per-record removals | delete user |

---

## Already clean — do NOT touch
`bulkUpdateAssets` (`updateMany`), `bulkForceReturnAssets` Prisma side (`updateMany`),
CSV imports (preload refs once + per-row), media upload (legitimately per-file S3),
`TagInput` (local state, no bulk mutation).

---

## Priority waves
1. **Wave 1 — warehouse prep/deprep (#1–5).** Highest count, most-used flow. One
   `prepItemsBatch` covers #1–4. Then `deprepItemsBatch` (#5).
2. **Wave 2 — warehouse kits (#6–7)** + **project managers (#8–9)** + **line-item
   move (#10)** + **crew time entries (#11).**
3. **Wave 3 — Class 2 cascade sweep** (mechanical `Promise.all` / batched mirrors).

One branch + PR per cluster (per CLAUDE.md atomic-commit rule). Update the relevant
`FEATUREDOCS/` file per feature touched. Verify each with a real bulk action in-app:
latency should drop from N×round-trip to one.

---

## New-session build prompt

> **Batch the bulk-operation N+1 round-trips (warehouse prep/deprep/kit, project
> managers, line-item move, crew time entries).**
>
> Bulk actions are slow because the client fires one server-action round-trip per
> item in a loop. Fix by adding batch server actions and rewiring callers. Full
> inventory + conventions + the ordering constraint + the "copy check-in" pattern are
> in `docs/designs/bulk-operations-batching.md` — read it first, then verify every
> call site against the actual code (line numbers drift; use the grep anchors).
>
> Do **Wave 1** first (`prepItemsBatch` covering findings #1–4, then `deprepItemsBatch`
> #5), one branch/PR per cluster, atomic commits. For each batch action: preserve
> behaviour exactly, honour the same-`lineItemId` ordering constraint, follow the
> server-action conventions (`serialize`/`requirePermission`/`logActivity`,
> `createIfMissing`/`ConvexError` in Convex), and add an integration test proving the
> batch yields an identical DB result to the old per-item loop (extend
> `src/server/warehouse-prep.int.test.ts`). Then Wave 2, then the Class 2 sweep.
>
> Where a batch is clean to implement as a single native Convex mutation, prefer that
> (it advances Phase 5) — but batching the round-trip is the primary win; don't block
> on going fully native. Verify each fix by timing a real bulk action before/after.
