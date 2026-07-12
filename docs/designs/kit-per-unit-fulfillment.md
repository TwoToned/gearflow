# Kit Per-Unit Fulfillment

Unify **physical kit members** into the per-unit fulfillment model so their
serials are tracked per-job like loose gear — visible on the Equipment tab,
carrying per-unit prep/deploy/return/history, and eventually reassignable.

Kits are the **un-migrated island** of the fulfillment migration
([line-item-fulfillment-model.md](./line-item-fulfillment-model.md)). Loose and
group gear moved to `projectLineItemUnit` rows; kits never did. This doc
finishes that migration for kits.

## The contradiction this resolves

`line-item-fulfillment-model.md` contradicts itself and never settled it:

- **line 89–91:** "Single-qty serialised lines **and kit children get exactly
  one unit row — uniform model.** … the order-line `assetId`/`bulkAssetId` FKs
  are dropped." (Open Question 1, "resolved — uniform beats a smaller diff.")
- **line 163–170 (Phase 4 audit):** "**Kit children carry their asset directly
  on `line.assetId` (no unit row)** — `checkOutKit` writes it; `checkInItems`
  has a no-unit fallback that reads it. Dropping the column would break the kit
  flow." Column drop **deferred** until "a follow-on design answers where
  kit-children store their asset assignment."

**This is that follow-on design.** Resolution: **the line-89 answer wins.** Kit
members get real `projectLineItemUnit` rows. The line-163 blocker (`checkOutKit`
never created units) is exactly what Phase 1 below fixes.

## Decision (settled 2026-07-12)

**All kits go per-unit, regardless of `checkMode`.** Every serialised kit member
gets a `projectLineItemUnit`; every bulk kit member gets a bulk unit — created
at kit checkout (and prep, where kit lines flow through it), flipped RETURNED at
check-in.

`checkMode` (`KIT_LEVEL` | `PER_ITEM`) stays **exactly as it is today**: it gates
only the pre-write **inspection questionnaire** granularity
(`warehouse/[projectId]/page.tsx:594-651`) — one kit-level check vs. per-member
checks. It has **zero effect on the write path today** and gains none here. Unit
creation (visibility / tracking / reassign) and scan granularity (checkMode) are
**orthogonal**, and we keep them that way.

Why all-kits and not PER_ITEM-only:
- The goal — members visible + trackable per job — applies to *every* kit;
  `KIT_LEVEL` members are exactly as invisible today as `PER_ITEM` ones
  (`equipment-row-descriptors.ts:63` hard-excludes **all** `isKitChild` from unit
  expansion).
- PER_ITEM-only leaves **two permanent write paths**, defeating Phase 3 ("strip
  the old path") and blocking the deferred `line.assetId` column drop forever.

## Current state (verified, do not re-derive)

### Kit write path — no units, dual-sourced asset flip
`checkoutKit` / `checkinKit` (`convex/warehouseOps.ts:361-458`) flip **asset
status** and **line status** directly and **never create unit rows**:
- `kitSerializedAssetIds(kitId)` (`:336-338`) reads the kit *definition* table
  `kitSerializedItems` and returns member `assetId`s → `setAssetsStatus`
  (`:343-359`) patches each `asset.status`.
- Assets are flipped from **two** sources that overlap for a normal kit: the
  kit-child line's `assetId` (`:394`) **and** `kitSerializedItems` (`:402`).
- Line rollup fields are patched directly on parent + child lines (`:383-385`),
  **not** derived from units via `syncLineItemRollup`.
- `checkMode` is **not read** anywhere in `warehouseOps.ts`.

### Kit line shape (`convex/projectLineItems.ts:472-526`)
- **Kit parent line:** `kitId` set, no `isKitChild`, no `parentLineItemId`.
  Found by `kitParentLine` (`by_kitId` + `!isKitChild`).
- **Serialised member child line:** one per `kitSerializedItems` row, `quantity:1`,
  `assetId: si.assetId` (`:507`), `isKitChild:true`, `parentLineItemId:parent`.
  → each serial already has its own qty-1 child line.
- **Bulk member child line:** one per `kitBulkItems` row, `bulkAssetId`,
  `quantity: N`, `isKitChild:true`. No `assetId`.
- **Nested-kit child line:** a child line that itself has `kitId` set; its own
  `childLineItems` are the grandchildren. Detected everywhere as
  `children.filter(c => c.kitId)`.
- `childKind: "KIT"` is **never written** in production — kit members are keyed by
  `isKitChild`/`kitId`. `childKind: "ACCESSORY"` *is* written, for accessories.

### Loose-gear unit path (the pattern to copy)
- `ensureSerialisedUnit(ctx, {organizationId, lineItemId, assetId})`
  (`convex/lib/fulfillment.ts:63-90`) — idempotent find-or-create on
  `by_lineItemId_assetId`; inserts `{ordinal, assetId, quantity:1,
  returnedQuantity:0, status:"CONFIRMED"}`. Caller then patches lifecycle.
- `ensureBulkUnit` (`:93-116`) — one row per `(line, bulkAssetId)`, carrying
  `quantity`.
- `ensureAccessoryUnit` (`:119-155`) — one unit per parent physical unit, linked
  by `parentUnitAssetId`. **This is the precedent for minting units for a
  non-loose child kind.**
- Checkout: `checkOutSerializedItem` (`warehouseOps.ts:51-77`) = `ensureSerialisedUnit`
  → patch unit `CHECKED_OUT` + `checkedOut*` → patch asset `CHECKED_OUT` →
  `bumpAssetCounters` → `scanLog`. `finalizeCheckoutItem` cascades accessories +
  `syncLineItemRollup`.
- Return: `returnLineUnits` (`fulfillment.ts:186-307`) flips unit `RETURNED` +
  `returned*` + `returnCondition`; restores asset via `assetStatusFromReturnCondition`.
- `syncLineItemRollup` (`fulfillment.ts:43-61`) recomputes the parent line's
  counters/`status`/`prepStatus` **from its unit rows** after every write.
- Deprep deletes only still-prepped units, **never** CHECKED_OUT/RETURNED/CANCELLED
  (`checkRecordOps.ts:110-116`). RETURNED units are immutable job history.

### No schema change required
`projectLineItemUnits` (`convex/schema.ts:887-919`) already has `lineItemId`,
`assetId`, `bulkAssetId`, `parentUnitAssetId`, `quantity`, `status`, `prepStatus`,
lifecycle stamps, and the `by_lineItemId_assetId` / `by_lineItemId_status` indexes.
A kit member's unit links to its **kit-child line** via `lineItemId`; that line
already carries `isKitChild` + `parentLineItemId` + (for nested) `kitId`. **No
`kitId` column on the unit is needed** — kit context is one hop away through the
line. This migration is a **write-path + backfill** change, not a schema change.

## Downstream consumers (cross-cutting audit — all must be covered)

| Consumer | Reads today | Kit members today | Required change |
|---|---|---|---|
| `equipmentTab.ts` bundle | units + `line.asset` | flat child row, tag from `line.asset`; **hard-excluded** from unit expansion (`equipment-row-descriptors.ts:63`) | stop excluding `isKitChild`; members now have units → per-unit rows + status badge |
| `getAssetTag` (`gearflow-table.ts:153`) | units → `line.asset` fallback | falls to `line.asset` | no change (fallback still fires until backfill; then units win) |
| gearflow-table rendering | units (top-level+accessory); `line.asset` (kit children) | one tag, no per-unit sub-rows | render kit-child per-unit rows from `child.units` |
| **`section-renderer.ts` `calculateItemHeight`** | reserves per-unit only if `quantity>1` (`:278,295`) | 1 `CHILD_ROW_PT` each | **reserve per-unit height for kit children with units — miss this → silent tail-drop (v0.8.1.1-class bug)** |
| `section-renderer.ts` `getFilteredParentItems` | line `status` | excluded (surfaced via parent) | verify: status now unit-derived via rollup |
| `gearflow-table.ts` top-level filter | line `status` | excluded | mirror of above |
| `buildDeliveryDocketGroups` (+ twin) | line `status` | promoted under kit name, tag from `line.asset` | tag from units; docket quantity from checked-out units |
| `checkoutKit`/`checkinKit` | `kitSerializedItems` + child `line.assetId` | no units | **create/flip units (Phase 1)** |
| Kit verification (`SCAN_VERIFY`) | `kitSerializedItems` / scan | tag-scan verify, no units | keep as-is (checkMode-gated); may cross-check against units later |
| Accessories on kit members | `projectLineItemUnit` + `parentUnitAssetId` | already per-unit | ensure kit-member units become valid accessory *parents* |

**PDF rule (CLAUDE.md):** any `DocumentLineItem` shape change must be verified
against all 5 consumers **with an integration test** through
`structureLineItems → calculateItemHeight → filter → plugin render`. Kit members
gaining units *is* such a change (kit-child `units[]` goes from always-empty to
populated). The height-calc reservation for kit-child units is the highest-risk
silent bug.

## Phased rollout (multi-PR — do NOT one-shot)

### Phase 1 — Write path: create + flip kit-member units
Rewrite `checkoutKit` / `checkinKit` (and reverse mutations `undeployKit`,
`unreturnKit`, `forceReturnKit`) to mint and flip units, converging kit members
onto the loose-gear helpers.

- **Checkout** — for each **serialised** direct child line (`c.assetId`, not a
  nested kit): `ensureSerialisedUnit(line, assetId)` → patch unit
  `CHECKED_OUT`+`checkedOut*` → flip asset (as `checkOutSerializedItem` does) →
  `scanLog`. For each **bulk** child line: `ensureBulkUnit(line, bulkAssetId, qty)`
  + the existing bulk-availability adjustment. Recurse into nested kits.
- **Check-in** — flip each CHECKED_OUT member unit `RETURNED`+`returned*`+
  `returnCondition`; restore asset via `assetStatusFromReturnCondition`. Cascade
  accessory child units (existing `checkinAccessoryChildren`).
- **Line status** — replace the direct child-line status patches with
  `syncLineItemRollup(childLineId)` so kit-child line status derives from its
  units, matching loose gear. Kit **parent** line + `kits` doc status stay
  patched directly (kit-level, not unit-derived).
- **Keep** `kitSerializedItems`-driven asset flip **as a transitional belt** this
  phase (idempotent with the unit flip) — Phase 3 removes it once units are the
  source of truth. Do **not** remove it before backfill (Phase 2) lands, or
  in-flight kits lose their asset flip.
- **`ConvexError` only**; mirror writes via `createIfMissing` semantics
  (`ensure*` helpers already are). Guarded `updateMany`-style single-row
  assertions per the parent design's concurrency rule.
- **Prep/deprep:** confirm whether kit-child lines flow through `prepItem`/
  `deprepItemInner` today (loose gear preps per line; kits historically travel as
  a case). If they do, `prepUnit` already handles them once units exist; if not,
  units are created at checkout only — document which, no behaviour regression.
- **Tests:** integration — checkout a kit → N member units CHECKED_OUT, asset
  statuses flipped, rollup correct; check-in → units RETURNED, assets restored;
  nested kit; kit with bulk member; accessory on a kit member; reverse
  mutations. Equipment-tab reconstruct shows member units.

### Phase 2 — Backfill already-deployed kits
`scripts/backfill-kit-member-units.ts` (dry-run default; run from the
`migrate.yml` GitHub Actions workflow — prod SSH freezes on long scripts; refresh
the Convex service token per mutation per
[[convex-backfill-token-refresh]]).

- For every kit-child line (serialised: has `assetId`; bulk: has `bulkAssetId`)
  **with no existing unit**, create one via the same `ensure*` helpers, stamping
  status/lifecycle from the **current line** state (CHECKED_OUT lines →
  CHECKED_OUT unit with `checkedOut*`; RETURNED lines → RETURNED unit with
  `returned*`/`returnCondition`; else CONFIRMED). Idempotent — safe to re-run.
- Recurse nested kits; skip accessory children (already unit-backed).
- Nothing new reads these until Phase 1 is deployed *and* the equipment-tab
  exclusion is lifted, so backfill is non-destructive and reversible.
- **End the migration with `ANALYZE "projectLineItemUnit";`** (bulk-insert stats
  hygiene — CLAUDE.md). Parity-check: every pre-backfill CHECKED_OUT/RETURNED kit
  member reachable via `unit → line → project` with matching `assetId`.

### Phase 3 — Surface + strip the old path
- **Equipment tab:** lift the `isKitChild` exclusion in
  `equipment-row-descriptors.ts:63` so kit members expand per-unit with a status
  badge; verify `equipment-tab-reconstruct` attaches member units.
- **PDF:** render kit-child per-unit rows in `gearflow-table.ts`; **add matching
  height reservation** in `section-renderer.ts` `calculateItemHeight`; update
  `buildDeliveryDocketGroups` to source tags/quantities from units. **One
  cross-pipeline integration test** per the PDF rule.
- **Strip** the `kitSerializedItems → kitSerializedAssetIds → setAssetsStatus`
  fulfillment flip from checkout/check-in (units are now the source of truth).
  `kitSerializedItems` remains the kit **definition** table — only its use *as a
  runtime fulfillment source* is retired.
- Unblocks the parent design's deferred **`line.assetId` column drop** for kit
  children (now stored on the unit). Coordinate with that design; likely its own
  follow-up PR.

### Phase 4 (follow-up, scoped separately) — reassign for kit members
Today `reassignSerialisedUnit` blocks kit children
(`warehouseOps.ts:1046`). A kit member's identity is tied to its kit slot, so
"reassign" means **swap which serial fills a same-model slot within the same
kit**, not move it to a loose line. Decide the guard model (same-kit +
same-model slot) before enabling. **Out of scope for Phases 1–3**; visibility +
per-unit lifecycle + history land first.

## Risks

1. **Silent PDF tail-drop** — kit-child units rendered without matching
   `calculateItemHeight` reservation. Mitigation: the PDF integration test;
   ship render + height in the same PR.
2. **Double asset flip** — Phase 1 keeps both the unit flip and the legacy
   `kitSerializedItems` flip. They're idempotent per asset (`setAssetsStatus`
   patches to a fixed status), but verify no counter double-count in
   `bumpAssetCounters`. Remove the legacy flip in Phase 3.
3. **Backfill drift** — stale planner stats after bulk insert → pool stalls.
   Mitigation: `ANALYZE` terminates the migration.
4. **Half-migrated window** — equipment tab / PDF start reading member units
   before backfill completes → some kits show units, others don't. Mitigation:
   Phase 3 surfacing ships **after** Phase 2 backfill is deployed + verified;
   `getAssetTag`'s `line.asset` fallback keeps un-backfilled members showing a
   tag meanwhile.

## Docs to update as phases land
- **FEATUREDOCS/60** (assets on a job) — the "Physical kit member" row moves
  from `line.assetId` to `projectLineItemUnit`; kit members become unit-expanded.
- **FEATUREDOCS/48** (child assets & accessories) — kit-member child kind now
  unit-backed.
- **line-item-fulfillment-model.md** — mark the line-89/line-163 contradiction
  resolved (link here); update the Phase 4 column-drop status.
- **ARCHITECTURE.md** table if a new FEATUREDOCS file is added.
</content>
</invoke>
