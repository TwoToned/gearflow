# Bulk Check-In Totals

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

> **Rewritten 2026-07-26 (issue #944 WS5).** The previous version of this doc
> described Prisma-era server actions (`src/server/bulk-checkin.ts`,
> `src/components/warehouse/bulk-checkin-tab.tsx`, `src/server/bulk-checkin.int.test.ts`)
> that no longer exist — deleted by the Convex-native migration
> ([FEATUREDOCS/54](./54-convex-data-layer.md)). The engine is alive today as
> **Convex-native code with a live caller**: `convex/lib/bulkCheckin.ts` (pure
> grouping/distribution) → `warehouseOps.checkInBulkTotals` (project-scoped
> service mutation) → `returnsWrites.returnBulkNative` (browser-direct, the org-wide
> returns station's bulk-tag-scan path — [FEATUREDOCS/12](./12-warehouse.md#returns-station)).
> The only genuinely dormant piece left is a UI **tab** for reviewing a whole
> project's bulk totals at once (as opposed to scanning one bulk tag at a time on
> the returns station) — nothing currently renders `aggregateCheckInTotals`'s
> output in a table.

A project-wide check-in **engine**: instead of returning each parent's
accessories one parent at a time, callers can request **the total quantity of
each item due back** ("100 clamps", "50 TrueCons", "3 generators", "1 custom
stage") and check a counted quantity in with one action. Supports all deployed
line item types: owned serialised assets, owned bulk assets, sub-hire items,
custom items, AND accessories.

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
- Owned serialised/owned bulk/accessory items go through `returnLineUnits`
  (`convex/lib/fulfillment.ts` — the same primitive the per-parent check-in uses).
- Sub-hire and custom items carry **no `ProjectLineItemUnit` rows** — their
  line-item `status` and `returnedQuantity` are the source of truth and are
  updated directly. The line only flips to `RETURNED` once the cumulative
  returned quantity meets/exceeds `checkedOutQuantity`; a partial return stays
  `CHECKED_OUT` so the remaining quantity is still visible on the next range-read.
  Because these lines have no units, `syncLineItemRollup` is deliberately **not**
  called on this path — it would recompute every counter from an empty unit set
  and zero out the quantities just written.

## Pure helpers — `convex/lib/bulkCheckin.ts` (Convex copy of `src/lib/bulk-checkin.ts`)

No `ctx`/IO — pure functions, tested independently in both copies (Convex can't
import from `src/`, so the two files are hand-kept in sync — POLICY.md R-3.1 flags
this as a duplication footgun; a future cleanup could hoist both into a package
neither runtime needs a build step to reach).

- `itemGroupKey(item)` — grouping key per type (table above).
- `aggregateCheckInTotals(items)` → `BulkCheckInTotal[]` — sums `outstanding`
  per key, drops zero-outstanding items, returns a deterministically ordered
  list (kind → label → key). Each total carries an `itemType` field for
  UI badge rendering. **Ported to the Convex copy in issue #944** — it existed
  in `src/lib/bulk-checkin.ts` from the start but had no Convex-side twin until
  the returns station needed to reuse the read-half logic server-side too.
- `distributeReturn(children, quantity)` → `{ allocations, distributed, requested }`
  — walks a group's children in `(sortOrder, lineItemId)` order, filling each up
  to its `outstanding`. Never allocates beyond a child's outstanding or beyond
  `quantity`. `distributed < requested` is the over-return signal.
- `scopedGroupKey(projectId, item)` **(new, issue #944)** — `itemGroupKey`
  prefixed with the owning project's id (`"<projectId>::<key>"`). The
  project-scoped `checkInBulkTotals` never needed this (its `returns` request is
  already inherently scoped to one `projectId` argument), but the org-wide
  returns station's bulk-tag resolver (`returnsLookup.resolve`) reports
  outstanding quantity **per project** for a tag that's out on several jobs at
  once — grouping by the bare key alone would let a return on project A silently
  draw down project B's count in that cross-project view.

## Convex mutations

- **`warehouseOps.checkInBulkTotals`** (service-only, `requireService`) — the
  original project-scoped engine. Args: `{ organizationId, projectId, userId,
  returns: [{key, quantity, condition?}], now }`. Range-scans the project's
  CHECKED_OUT lines (`projectLineItems.by_projectId_status`), batch-loads
  referenced models once, groups into `CheckInItem[]` by `itemGroupKey`, then for
  each requested `{key, quantity}` calls `distributeReturn` and applies the
  allocations via `returnLineUnits`/direct line patches (sub-hire/custom).
  Over-return throws `ConvexError` and aborts the whole call (all-or-nothing per
  request array, not per-key — matches the deleted Prisma transaction's
  behaviour). One `assetScanLogs` row per touched asset + one summary row per
  requested key.
- **`returnsWrites.returnBulkNative`** (browser-direct, issue #944 WS5) — the
  **returns station's** bulk-tag-scan write. Unlike `checkInBulkTotals` (which
  takes a `projectId` + arbitrary `{key, quantity}` array), this takes exactly
  one `{ bulkAssetId, projectId, quantity, returnCondition }` — the shape a
  single scanned tag naturally produces once the operator has picked which
  project (or there was only one to begin with). Re-derives the project's
  candidate lines for that `bulkAssetId` itself (`by_projectId_status`, same
  index) rather than trusting a client-supplied line breakdown, then reuses
  `distributeReturn` + `checkinItemsCore` (not `checkInBulkTotals` itself — that
  mutation is service-only and its full multi-key request shape isn't needed
  for a single scanned tag). Standard write-security bar: `assertWritesEnabled` →
  `enforceBrowserWriteLimit` → `requireOrgPermission(warehouse, check_in)` →
  `resolveActor`, org-checked bulk asset + project.

## Tests

- `src/lib/bulk-checkin.test.ts` — pure aggregation + distribution (original copy).
- `convex/lib/bulkCheckin.test.ts` **(new, issue #944)** — parity suite for the
  Convex copy: `itemGroupKey`, `aggregateCheckInTotals`, `distributeReturn`, plus
  `scopedGroupKey`'s new cross-project isolation behaviour.
- `convex/returnsWrites.test.ts` — `returnBulkNative` (single project, cap/guard
  behaviour inherited from the shared write-security bar).
- `convex/returnsLookup.test.ts` — the bulk-tag resolver's single-project vs.
  multi-project (`bulk_multi`) split that feeds `returnBulkNative`'s `projectId`.
