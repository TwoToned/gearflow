# Convex Core Mega-Flip — Build Plan (Phase C, the keystone)

> **Supersedes the step-2/step-3 split in `convex-core-inversion-design.md` (#261).**
> Verified by a full writer/transaction audit (2026-06-19): the line-item and
> asset/kit clusters are **transactionally interlocked** and CANNOT flip in
> separate PRs. This doc is the concrete, actionable build plan for the one
> mega-flip PR. Read with `convex-core-inversion-design.md` (the consistency
> model) and `convex-domain-only-decommission.md` (the overall stage plan).

## 0. The correction (why #261's ordering was wrong)

#261 sequenced the core as: step 2 = `{line-item, unit, asset, bulkAsset}`, then
step 3 = `kit` separately. **That is impossible.** A Prisma `$transaction` cannot
span Prisma + Convex, and the audit found these tables share transactions:

- **`kits.ts` couples `asset`/`bulkAsset` + kit tables in 7 transactions**
  (`archiveKit`, `deleteKit`, `addSerializedItemToKit`, `addSerializedItemsToKit`,
  `removeSerializedItemFromKit`, `addBulkItemToKit`, `removeBulkItemFromKit` —
  each writes `asset.kitId`/`asset.status` or `bulkAsset.availableQuantity` in the
  SAME tx as `kitSerializedItem`/`kitBulkItem`/`kit`).
- **`warehouse.ts` checkout/checkin couples `asset.status` + `bulkAsset` + `kit` +
  `projectLineItem`/`projectLineItemUnit` in one tx** (10 functions — see §2).
- **`projects.ts deleteProject` couples `asset` + `kit` + `project` + line-items**
  in one tx.

Therefore the **atomic flip set is 8 tables**, flipped in ONE PR:

```
projectLineItem · projectLineItemUnit · lineItemMergeMap
asset · bulkAsset · assetBulkChild(*)
kit · kitSerializedItem · kitBulkItem
```

(*) `assetBulkChild` + `assetScanLog` are **already Convex-only** (writes via
`api.assetBulkChildren.*` / `api.assetScanLogs.*`); they just ride along (no
Prisma write to remove). `lineItemMergeMap` is written by exactly one place
(`split-sibling-collapse.ts`).

This is the single largest, highest-risk PR of the entire migration — the
data-integrity heart. It is a **multi-session porting effort**, validated per
invariant. Do **not** auto-grind it.

## 1. The flip rule (recap) + what this means here

The unit of inversion is a TABLE + ALL its writers. Once any of the 8 tables is
Convex-only, **every** writer of it must write Convex, or a Prisma writer and a
Convex writer split-brain the table. Each Prisma `$transaction` becomes ONE
purpose-built Convex mutation (fully ACID + serializable; OCC retries the loser).

**Mirrors deleted at the end of this PR:** `asset-mirror.ts`, `kit-mirror.ts`,
`line-item-mirror.ts`, `line-item-unit-mirror.ts`. (Mirrors currently dual-write
all four Prisma-first.)

## 2. The inseparable checkout/checkin set (asset-status + line-item-status)

These MUST become single atomic Convex mutations (asset/bulk/kit status flips +
unit + line-item status, one transaction):

| Function (warehouse.ts unless noted) | Couples |
|---|---|
| `checkOutItems` | asset.status + PLIU + PLI (+ accessory children) |
| `checkInItems` | asset.status(from condition) + PLIU + PLI |
| `checkOutKit` | asset + **bulkAsset.availableQuantity** + kit + PLI |
| `checkInKit` | asset + bulkAsset + kit + PLI |
| `forceReturnAsset` | asset→AVAILABLE + PLI→RETURNED |
| `forceReturnKit` | asset + bulkAsset + kit + PLI |
| `bulkForceReturnAssets` | asset + PLI |
| `syncContainerStatus` | asset + PLI (currently **sequential/non-atomic** — flip *fixes* a latent split-write) |
| `completeCheckAndStore` (check-records.ts) | asset + PLIU + PLI (return path) |
| `checkInBulkTotals` (bulk-checkin.ts) | asset + PLIU + PLI |

Shared coupling primitives in `line-item-fulfillment.ts`: **`returnLineUnits`**
and **`checkinAccessoryChildren`** (both write asset.status + PLIU) — port these
to Convex helper functions the checkin mutations call. Checkout couples inline in
`checkOutSerializedItem` / `checkoutAccessoryChildren`. Bulk coupling lives in
`adjustBulkAvailability` (`inventory-mutations.ts`) — port to a Convex helper that
guards `availableQuantity >= n` and throws `ConvexError` (drives the all-or-nothing
kit-checkout rollback for free via OCC).

## 3. Transaction → Convex-mutation map (the build list)

~22 in-scope `$transaction`s become purpose-built Convex mutations. Group them:

### A. Asset/BulkAsset CRUD (not kit-coupled — straightforward)
`assets.ts`: createAsset, createAssets (batch), updateAsset, bulkUpdateAssets,
deleteAsset, updateAssetNotes, archiveAsset. `bulk-assets.ts`: createBulkAsset,
updateBulkAsset, deleteBulkAsset, updateBulkAssetNotes, archiveBulkAsset.
`asset-accessories.ts`: addSerializedChildToAsset, removeSerializedChildFromAsset
(asset.parentAssetId), addBulkChildToAsset/removeBulkChildFromAsset (bulkAsset qty
via adjustBulkAvailability — assetBulkChild already Convex). `maintenance.ts`
hold/releaseAssets (asset.status only — own mutation). `test-tag-records.ts` FAIL→
IN_MAINTENANCE (asset.status). `models.ts archiveModel` (asset/bulkAsset deleteMany
cascade — Promise.all, not a tx). **Clear-to-null:** use the `patch{Table}(set,
clear)` pattern for nullable fields (locationId, parentAssetId, supplierId, kitId).

### B. Kit composition (asset-coupled — kits.ts, 7 mutations)
`addSerializedItemToKit`, `addSerializedItemsToKit`, `removeSerializedItemFromKit`
(kitSerializedItem +/- asset.kitId/status/location), `addBulkItemToKit`,
`removeBulkItemFromKit` (kitBulkItem + bulkAsset qty), `archiveKit`, `deleteKit`
(kit + members + asset release + bulk restore). Each = one Convex mutation doing
all tables. `kits.ts` also has plain kit CRUD (create/update) + `getKit` media
composite (stays — media is Convex already).

### C. Line-item CRUD (line-items.ts)
`addLineItem` (+ `expandAccessoryChildren`), `addKitLineItem`, `addCustomLineItem`,
`updateLineItem`, `removeLineItem` (cascade children), `reorderLineItems`. The
maxSort-then-insert TOCTOUs (addLineItem/addKitLineItem/addCustomLineItem/
quickAddAndCheckOut/ensureContainerOnProject) collapse to in-mutation
`max(sortOrder)+1` (proven race-free by the grouping `createAtEnd`).

### D. Unit fulfillment (line-item-fulfillment.ts — helpers, not txns)
Port the `tx`-taking helpers to Convex (`ctx.db`): `syncLineItemRollup`,
`ensureSerialisedUnit`/`ensureBulkUnit`/`ensureAccessoryUnit` (ordinal find-or-
create; the `[lineItemId,assetId]` unique backstop → in-mutation check),
`returnLineUnits` + `checkinAccessoryChildren` (the coupling primitives),
`createAccessoryChildIfAbsent` (the raw `SAVEPOINT` 23505-swallow → just a Convex
check-then-insert; OCC handles the race), `expandAccessoriesForAsset` (the
`SELECT … FOR UPDATE` row lock → free under Convex per-document serializability;
preserve the cross-line bulk-demand recompute logic), `prepUnit`.

### E. Warehouse checkout/checkin (warehouse.ts — the 10 in §2 + quickAdd/container)
Each `$transaction` → one mutation. `quickAddAndCheckOut` + `expandAccessoryChildren`
currently call Convex **inside** an open Prisma tx — these *simplify* (Convex
reads inside a mutation are native).

### F. Check-records prep/return (check-records.ts)
prepItemDirect, deprepItem, completeCheckAndDeprep, deprepKit, prepKitChildren,
completeCheckAndPack, completeCheckAndFlag, completeCheckAndStore (return path).
`checkRecord` is already Convex — the 3 `saveAdHocCheck`/`saveKitLevelChecks`/
`saveChildItemChecks` txns become trivial (no Prisma writes left).

### G. Bulk check-in + split-sibling + reassignment
`bulk-checkin.ts checkInBulkTotals` (distributeReturn + returnLineUnits).
`split-sibling-collapse.ts mergeGroup` (per-group tx: move PLIU + repoint
checkRecord/projectService FKs + write `lineItemMergeMap` audit + deactivate
sibling + bump canonical qty). ⚠ it still does a Prisma `checkRecord.updateMany`
— reconcile that to Convex here (checkRecord is Convex). `reservation-conflicts.ts
swapLineItemAssetCore` (the double-booking read-gate-write → one mutation that
reads conflicts + writes assetId atomically).

### H. deleteProject (projects.ts)
Rewrite the delete tx: the asset-release + kit-reset + line-item delete move into
Convex mutation(s); the Prisma `project.delete` stays only until the project
scalar flip (the residual project-child Prisma rows are inert per the
decommission-doc finding). This is the seam where the mega-flip meets the project
keystone — keep `deleteProject` orchestrating both stores during this PR.

## 4. Invariants → in-mutation handling (the must-not-break list)

| Invariant | In the Convex mutation |
|---|---|
| **Checkout double-allocation** | read asset.status, guard CHECKED_OUT/RETIRED/IN_MAINTENANCE/LOST, then set status — OCC retries the loser ⇒ never double-allocates |
| **maxSort-then-insert** (line-items, units ordinals) | `max(sortOrder)+1` / `nextOrdinal` computed from `ctx.db` in the same mutation |
| **Kit checkout all-or-nothing** | bulk guard throws `ConvexError` on insufficient qty → whole mutation rolls back |
| **Cascade delete** (line-item children, kit members, accessory units) | query children by index, delete, delete parent — atomic |
| **Return status mapping** | `assetStatusFromReturnCondition` (pure) inside the mutation |
| **Double-booking on reassignment** | conflict read + assetId write in one mutation |
| **Split-sibling merge** | move units + repoint FKs + audit row + deactivate + bump, one mutation |

## 5. Cross-store side-effects that STAY in the server action (around the mutation)

`assertNoBlockingComments`, `assertTestTagAllowsCheckout` (Convex HTTP preflight),
`logActivity` (Prisma — kept), `writeCollabActivityEvent`, S3, email, predictive-
maintenance Convex writes, `recalculateProjectTotals`. Permissions (`requirePermission`)
+ Zod stay in the action. The action shrinks to: authZ + validation + the ONE
Convex mutation call + audit + non-transactional side effects.

## 6. Build / wire / validate order (within the one PR)

Because the table can't be half-flipped, nothing is *shippable* until all writers
are converted — but build bottom-up so each layer is unit-testable before wiring:

1. **Convex helpers** (`inventory-mutations` qty-guard, fulfillment unit helpers,
   `returnLineUnits`/`checkinAccessoryChildren`, rollup, accessory expansion) as
   internal functions used by the mutations.
2. **Convex mutations** group by group (A→H), each with the clear-to-null pattern.
3. **Rewire server actions** to call the mutations; delete the Prisma writes.
4. **Delete the 4 mirrors** + their backfill/roundtrip registrations.
5. **Validate** (§7), then human Coolify preview.

## 7. Validation (mandatory — CRUD round-trips are NOT sufficient)

Per-invariant live dev-Convex exercises (the `_tmp-validate-*.ts` + `pnpm exec
convex dev --once` pattern; OCC already proven by the grouping PR):

- **Concurrent checkout of the same asset to two projects → exactly one succeeds.**
- Contiguous sortOrder/ordinal under concurrent insert.
- Kit checkout with one short bulk → whole kit rolls back (no partial).
- Full cascade: remove line-item → children+units gone; deleteKit → members
  released + bulk restored.
- Return condition → asset status mapping (DAMAGED→IN_MAINTENANCE, etc.).
- Reassignment double-booking rejected.
- **The full PDF-pipeline integration test** (5 `DocumentLineItem` consumers per
  CLAUDE.md) against a realistic fixture — the keystone tree shape must survive.

Plus tsc + lint + full vitest + `npm run build`.

## 8. Risks / notes

- **Postgres-specific concurrency** (`SELECT … FOR UPDATE` in
  `expandAccessoriesForAsset`, `SAVEPOINT` in `createAccessoryChildIfAbsent`) has
  no Convex port — both are subsumed by Convex per-document serializability, but
  the *logic* they protect (cross-line bulk-demand recompute; dup-accessory
  prevention) must be preserved in the mutation.
- **Convex-in-Prisma-tx today** (`quickAddAndCheckOut`, `expandAccessoryChildren`)
  → simplifies once the tx is a Convex mutation.
- **`checkRecord` dual-write straggler** in `mergeGroup` → reconcile to Convex.
- Consider splitting the PR's *review* by group even though it ships as one merge,
  and landing it behind the existing Coolify preview gate with the human running
  the concurrent-checkout scenario manually.

## 9. After the mega-flip

Remaining core: `subHire*` (regen), `projectService + crew-scheduling` (shared tx),
`project` scalars. Then Stage 3 (strip schema) → Stage 4 (DROP TABLE) → Stage 5
(infra cleanup). See `convex-domain-only-decommission.md`.
