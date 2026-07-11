# Project Line-Item Fulfillment Model

Replaces the one-asset-per-row line-item shape with an order/fulfillment split.
Motivated by the checkout duplication bug (roadmap Phase 0.1). The `/autoplan`
CEO review found the bug is a **data-model defect**, not a display defect, and
the user chose to build the model now — this pulls roadmap item 1.2 (the
line-item model pass) forward. The groups/categories UX rework stays Phase 1
and is out of scope.

Reviewed by the `/autoplan` dual-voice Eng pass (Claude + Codex); their nine
findings are folded into the design below. **This is a multi-week build, not a
quick fix.** It must ship in the phased order in the Rollout section.

## Problem

Scanning equipment to deploy on a project produces one `ProjectLineItem` row
per physical unit. A `10x Powerplay P2` order line becomes 10 rows — the
delivery docket for project 260102 prints "Powerplay P2" as 10 rows, "EW-DX SK"
as 4, "Medium Mic Pouch" as 6. The customer docket is messy; the project
equipment screen is fragmented.

## Root cause

`ProjectLineItem` (`prisma/schema.prisma:1352-1442`) has a single `assetId` and
single `bulkAssetId` FK — one asset per row. To represent "10 ordered units, 10
serials" the code splits a qty-10 row into 10 qty-1 rows via `splitLineItem`
(`src/server/check-records.ts:32-83`), called from 6 sites in checkout/prep
(`warehouse.ts:516`, `check-records.ts:287,312,727,749`). A `ProjectLineItem`
conflates **what was ordered** with **which units fulfil it**.

## The model change

Split the concept in two.

### `ProjectLineItem` — the order line (unchanged role)

`quantity`, `unitPrice`, `pricingType`, `discount`, `lineTotal`, `groupName`,
`groupId`, `categoryId`, `notes`. One row per ordered line. No more splitting.

Add **derived rollup counters**, kept in sync transactionally on every unit
write (Eng finding 2/5 — a single rolled-up status enum cannot represent a
qty-10 line that is part checked-out, part returned, part packed):

- `assignedQuantity`, `packedQuantity`, `checkedOutQuantity`,
  `returnedQuantity`, `damagedQuantity`, `lostQuantity`.
- Display status is **derived from these counts**, not stored as one enum.

### `ProjectLineItemUnit` — the fulfillment record (new)

One row per assigned **serialised** unit; for **bulk** lines, one row per bulk
asset carrying a `quantity` (bulk assets are stock pools, not identifiable
units — Eng finding 6, both voices).

```
ProjectLineItemUnit {
  id              String  @id @default(cuid())
  organizationId  String
  lineItemId      String                       // FK -> ProjectLineItem
  ordinal         Int                          // stable 1..N identity within the line
  assetId         String?                      // FK -> Asset  (serialised; null for bulk)
  bulkAssetId     String?                      // FK -> BulkAsset (bulk; null for serialised)
  quantity        Int      @default(1)         // always 1 for serialised; N for a bulk row
  returnedQuantity Int     @default(0)         // bulk partial returns
  status          LineItemStatus               // CONFIRMED / CHECKED_OUT / RETURNED / LOST
  prepStatus      PrepStatus?
  prepContainer   String?
  checkedOutAt    DateTime?  checkedOutById  String?
  returnedAt      DateTime?  returnedById    String?
  returnCondition ReturnCondition?  returnStatus ReturnStatus?  returnNotes String?

  @@unique([lineItemId, assetId])              // no double-assign of one serial (finding 5/7)
  @@unique([lineItemId, ordinal])
  @@index([organizationId, assetId, status])
  @@index([organizationId, bulkAssetId, status])
  @@index([lineItemId, status])
}
```

DB-enforced invariants (Eng finding 2 — do not leave these to app code):
exactly one of `assetId` / `bulkAssetId` is set; `organizationId` matches the
parent line item; the `@@unique([lineItemId, assetId])` blocks a serial being
assigned twice; a partial unique index enforces no two **active** (non-RETURNED,
non-cancelled) units share an `assetId` across the org.

Per-unit state (`status`, `prepStatus`, `prepContainer`, `checkedOut*`,
`returned*`, `returnCondition/Status/Notes`) moves off `ProjectLineItem` onto
the unit. The split mechanism is retired entirely.

Single-qty serialised lines and kit children get exactly one unit row — uniform
model. Kit children get unit rows too; the order-line `assetId`/`bulkAssetId`
FKs are dropped (Open Question 1, resolved — uniform beats a smaller diff).

### `CheckRecord` and `DamageEvent`

Both currently FK to `ProjectLineItem` (`schema.prisma:1423`, `:1182`). Add a
**new `lineItemUnitId` FK** to each (additive — keep `lineItemId` for order
context, do not repurpose it — Eng finding 2/4). Every `saveCheckRecords`
call-site must be traced to confirm a unit id is in scope.

## Scan lookup + check-in (highest-risk area)

`lookupAssetForScan` (`warehouse.ts:182,282`) today resolves a scanned tag to a
`lineItemId` via `ProjectLineItem.assetId`. It must return
`{ lineItemId, lineItemUnitId, assetId, bulkAssetId, modeReason }`. Every
checkout / check-in / prep / check-record function must operate on the **unit
row**, never the order line.

Failure mode if done wrong (Eng finding 3, both voices): a check-in that
targets the order line marks the whole order returned, disconnects the wrong
asset, writes return condition onto the wrong unit, or leaves an `Asset` stuck
`CHECKED_OUT` forever (poisoning availability + the T&T preflight).

Mitigations, mandatory:
- All unit state transitions use guarded writes —
  `updateMany({ where: { id: unitId, status: "CHECKED_OUT" }, ... })` and
  assert the affected count is exactly 1. This also closes the concurrent-scan
  race (Eng finding 5).
- `lookupAssetForScan`, `checkInItems`, `checkOutItems`, and the prep flows
  **ship in one PR** — see Rollout. This is a hard sequencing gate.

## Migration — hazardous, phased

Existing split siblings have **no FK linking them** and carry divergent
per-unit state. Naive collapse by `(projectId, modelId, groupName)` is unsafe —
it merges distinct commercial lines ("3x SM57 stage" + "2x SM57 FOH") and
ignores `groupId`, `categoryId`, `subHireId`, `sortOrder`, `description`,
`notes`, pricing, supplier fields (Eng finding 1, both voices).

1. **Phase 1 — Add, no behaviour change.** Add `ProjectLineItemUnit`, the
   rollup counters, and the `lineItemUnitId` FKs on `CheckRecord` /
   `DamageEvent`. During this phase also **stamp a `splitGroupId`** the first
   time a line is split going forward, so future data has explicit lineage.
2. **Phase 2 — Backfill.** Split into two halves by risk:
   - **2a — Populate units (safe, additive).** Create one `ProjectLineItemUnit`
     per line item that has an asset / bulk asset assigned, carrying that
     line's current per-unit state; recompute the rollup counters. Nothing
     reads the new rows yet, so this is non-destructive, idempotent, and
     reversible. Script: `scripts/backfill-line-item-units.ts`
     (`npm run backfill:line-item-units`, dry-run by default).
   - **2b — Collapse split siblings (hazardous).** Merge the qty-1 rows a
     `10x` line was split into back onto one order line, using a **strict
     full-equivalence key** — every order-level field identical (`groupId`,
     `categoryId`, `subHireId`, supplier fields, `pricingType`, `duration`,
     `unitPrice`, `discount`, `isOptional`, `isContainerLineItem`,
     `isCustomItem`, `description`, `notes`). Anything not identical is
     **flagged, not merged**. Inventory **every** FK / pseudo-FK first
     (`CheckRecord`, `DamageEvent`, activity-log entity ids); write a permanent
     `oldLineItemId → canonicalLineItemId + unitId` mapping table; repoint
     `CheckRecord` / `DamageEvent`; **do not delete** old rows until audited.
     **Run 2b adjacent to Phase 3**, not standalone — collapsing data while
     readers still expect the split shape opens a half-migrated window. Dry-run
     against a production data copy; diff docket 260102 before/after.
3. **Phase 3 — Cut over.** Rewrite checkout / check-in / prep / scan-lookup to
   the unit table in one atomic PR; retire `splitLineItem` and its 6 call
   sites; kit children get unit rows created in `checkOutKit`.
4. **Phase 4 — Drop** the old `assetId` / `bulkAssetId` on `ProjectLineItem`
   once all readers are migrated and verified.

   **Status (post-Phase-3 audit, v0.7.0.0):** The original "drop both
   columns" framing turned out to be too coarse. The Phase 4 audit
   surfaced two *legitimate* active uses that aren't legacy:

   - **Kit children** carry their asset directly on `line.assetId` (no
     unit row) — `checkOutKit` writes it; `checkInItems` has a no-unit
     fallback that reads it. Dropping the column would break the kit
     flow.
   - **Bulk-line order intent** lives on `line.bulkAssetId`. It's set
     at line creation (the operator picks which bulk to draw from)
     and consumed at prep/checkout to know which `BulkAsset` the unit
     should reference. Dropping the column erases the assignment.

   The audit also found one *correctness* gap that was a real Phase 4
   prerequisite — the checkout T&T preflight (`warehouse.ts:462-478`)
   only gathered `line.assetId` / `line.bulkAssetId`, so a prepped
   FAILED-T&T asset that lived on a unit slipped past the gate. Fixed
   in Phase 4a (v0.7.0.x) by unioning unit-table asset ids into the
   preflight set.

   Wholesale column drop is **deferred** until a follow-on design
   answers (a) where kit-children store their asset assignment, and
   (b) where bulk-line order intent lives. The columns are no longer
   blocking new development.

Single-tenant data (one company) makes a transactional cutover with a verified
dry-run feasible; the `oldLineItemId` mapping table is the rollback safety net,
so a long dual-write window is not required.

### Historic splits with no shared key — explicit merge

Phase 2b's strict-equivalence key handles siblings that a `splitLineItem` call
produced from one order line: they share every order-level field, so the key
clusters them automatically (`scripts/collapse-split-siblings.ts`). But the
older production data has a harder shape. On MUSE (project `260304`,
`cmnsi9uj100dthxbxqnh93ufe`) the priced line is a **free-text parent**
(`modelId = null`, qty 3, a unit price, status `QUOTED`) and the five physical
rows were created later by scanning (`modelId = Powerplay-P2`, qty 1, no price,
`CHECKED_OUT`). Parent and children share **no FK and no `modelId`** — only the
description string `"Powerplay P2"`. No safe heuristic can cluster them.

`scripts/collapse-historic-splits.ts` (`npm run collapse:historic-splits`)
covers this in two layers:

- **Heuristic + diagnostic.** Rows with `modelId = null` are keyed
  `__nullmodel:<rowId>` so each priced free-text parent is a guaranteed
  singleton — it can never be falsely clustered with an unrelated free-text
  line. When nothing clusters, the script dumps the singletons (id, qty,
  price, status, model/description) so the operator can read off the exact ids.
- **Explicit `--merge-into <canonicalId> --children <id1,id2,...>`.** The
  operator supplies the canonical (keep) id and the child ids from that dump.
  The script validates both ends — ids resolve, share `projectId` +
  `organizationId`, children aren't kit children, have an `assetId`, aren't
  already cancelled, and `canonical ∉ children` — then folds each child's
  asset onto a new unit on the canonical, repoints `CheckRecord` /
  `DamageEvent` / `ProjectService`, writes a `LineItemMergeMap` audit row, and
  cancels the child (qty 0, `assetId` null). `syncLineItemRollup` then promotes
  the canonical to `CHECKED_OUT` when the folded units are checked out.

This runs from the GitHub Actions **Run migration** workflow
(`.github/workflows/migrate.yml`) — `canonical_id` + `children_ids` inputs —
because the prod SSH session freezes on long-running scripts. Dry-run by
default; `apply` is a separate, human-gated checkbox.

### Merge tombstones are hidden, not deleted

A collapse leaves the folded child as a `CANCELLED`, qty-0, `assetId`-null row
so `LineItemMergeMap` history stays reachable. The project **detail** view must
hide these or a merge just turns N duplicate rows into N "Cancelled" ghost
rows. `getProject` filters `status != CANCELLED` on all three line-item
includes (grouped, ungrouped-category, top-level), and `equipment-tab.tsx`
re-applies the same predicate (`isHiddenFromList`) as defence against a stale
cache or optimistic update. Normal line-item removal hard-deletes, so a
`CANCELLED` line item is only ever inert merge residue. PDFs, warehouse, and
list views already excluded `CANCELLED`.

## Blast radius

| Area | File(s) | Change |
|---|---|---|
| Checkout | `warehouse.ts:398-618` | Write unit rows; guarded transitions |
| **Check-in / returns** | `warehouse.ts:624-773`, `check-records.ts:879-1046` | Highest risk — target unit rows; rewrite with scan-lookup |
| Scan lookup | `warehouse.ts:182-392` | Return `lineItemUnitId` |
| Prep | `check-records.ts` | Retire split; write unit rows |
| Availability | `availability.ts:65` | `computeOverbookedStatus` quantity-summed — safe; per-asset conflict (`line-items.ts:48`, `reservation-conflicts.ts:52`) queries unit table |
| Utilization / calendar | `utilization.ts:89`, `availability.ts:130` | Repoint `assetId` queries to unit table |
| PDFs | `build-document-data.ts`, `gearflow-table.ts`, `section-renderer.ts:214` | Render order line + unit tags; per-document quantity from matching units, not order-line status |
| Kits | `kits.ts`, `warehouse.ts:779,969` | Kit children get unit rows |
| Cancel project | `projects.ts:868` | Collect asset ids from unit rows |
| Damage | `DamageEvent` (`schema.prisma:1182`) | New `lineItemUnitId` FK |

## Test plan

- **Migration golden tests:** mergeable sibling sets collapse; deliberately
  non-mergeable sets (divergent price / duration / notes / `groupId`) are
  flagged not merged; kit children handled; `CheckRecord` + `DamageEvent`
  repoint — every pre-migration record reachable post-migration via
  `unit → lineItem → project` with matching `assetId` snapshot.
- **Checkout integration:** scan N units of a qty-N line → one order line, N
  unit rows, no extra `ProjectLineItem` rows.
- **Check-in integration:** deploy 10 / return 3 / damage 1 / return rest →
  correct per-unit state, order-line counters correct, `Asset` statuses
  restored.
- **Concurrency:** two simultaneous check-ins of the same unit → exactly one
  succeeds (guarded `updateMany` count assertion).
- **Edge cases:** duplicate scan; serialised asset checked out on another
  project; asset retired/lost mid-project (terminal unit status, no orphan);
  kit child + nested kit check-in; bulk partial check-in.
- **Documents:** regenerate docket / pick slip / return sheet for 260102 —
  "Powerplay P2" is one `10x` row with 10 tags; partial-deployment docket shows
  only checked-out units.

## Risks

1. **Migration data loss** — divergent siblings collapsed wrongly. Mitigation:
   strict equivalence key, flag-don't-merge, `oldLineItemId` map, dry-run +
   docket diff, old rows retained until audited.
2. **Stuck assets** — a missed check-in path. Mitigation: atomic
   scan-lookup + check-in + checkout PR; full deploy→return integration test.
3. **Partial rollout** — a reader still reads `ProjectLineItem.assetId`.
   Mitigation: phased cutover, old FKs dropped last (Phase 4).

## Resolved questions

- Kit children get unit rows; order-line asset FKs dropped (uniform model).
- Bulk fulfillment uses a `quantity` on the unit row, not N rows.
- Transactional cutover + dry-run, not a dual-write window (single-tenant).
- Rollup is explicit count columns; display status derived from counts.

## Update (2026-07-11) — surfacing units on the Equipment tab + reassign

The fulfillment model was in place but the **project Equipment tab never
displayed the units**: `equipment-tab-reconstruct` passed an empty
`unitsByLineItem` map, so single-qty lines showed no tag, multi-qty serialised
lines showed nothing, and kit-member serials were dropped. The pull-sheet /
`getProject` reconstruct already loaded units — this brought the tab in line.

Shipped (see [FEATUREDOCS/60](../../FEATUREDOCS/60-assets-on-a-job.md)):

- `equipmentTab.bundle` loads `projectLineItemUnits`; reconstruct feeds a real
  units map; the tab renders inline tags (single), expandable per-unit rows with
  a Deployed/Returned status badge (multi-qty), and kit-member tags.
- **Reassign**: `warehouseOps.reassignSerialisedUnit` + a per-unit picker let a
  serial move to another same-model line — correcting the scan auto-pick
  (first-open-line-by-sort-order) without re-scanning. Same-model / same-project /
  capacity / not-a-kit-child / not-returned guards.
- **History**: RETURNED units are retained through check-in + close-out and shown
  inline, so a finished job still answers "what went out." `deprepItemInner` now
  excludes RETURNED/CANCELLED from deletion; `assetScanLog` is the durable
  backstop. A per-unit **movement-history popover** surfaces that ledger on demand
  (a serial's out/in events, project + who + when).

Open follow-ups: generic/quantity deploys still record no serial (show "N
deployed — no serials recorded" rather than a fake tag).
