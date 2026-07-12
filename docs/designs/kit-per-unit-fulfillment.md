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

### Settled sub-decisions (eng review + codex outside voice, 2026-07-12)

These refine the phases below; the review-outcomes appendix records the reasoning.

1. **Units are created at child-line creation** (`createKitLineItemCore`,
   `projectLineItems.ts:472`), not opportunistically at checkout. A kit added to a
   project seeds its member units in `CONFIRMED` state immediately, mirroring how
   loose lines relate to units. Prep/checkout/checkin then **patch existing
   units**. This gives the per-unit **prep** lifecycle for free and shrinks the
   backfill to pre-change kits only. Cost: Phase 1 also rewrites the kit prep path
   and the kit-edit-after-add path (below).
2. **Display = one row per member, retagged from its unit.** Kit members stay
   one-row-per-child; Phase 3 changes only the **tag source** (`child.units[0]`
   instead of `line.asset`) and adds the status badge. **No per-unit expansion
   rows** — each member has exactly one unit, so expansion is redundant and would
   reintroduce the `calculateItemHeight` tail-drop bug. This supersedes the earlier
   "render kit-child per-unit rows" prescription.
3. **Both paths flip asset status in Phase 1, made idempotent by transition.**
   The new unit path flips asset status like `checkOutSerializedItem`; the legacy
   `kitSerializedItems` flip still runs as a belt. `bumpAssetCounters` is gated on
   an **actual status change**, so a second fixed-status write is a counter no-op.
   Per codex: the double-count was never the real hazard — the real transitional
   risk is the **two sources holding different asset sets** (see #4).
4. **Verification stays on the live `kitSerializedItems` definition + a parity
   guard.** Fulfillment reads the child-line snapshot/units; verification keeps
   reading the live kit definition, but a parity check **errors** if a project's
   child-line asset set diverges from the current kit definition (happens when an
   `AVAILABLE` kit is edited after being added to a project). Surfaces divergence
   as an operator-fixable error rather than silently validating one set and
   deploying another.

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

### Phase 1 — Create units at kit-add; flip them through the warehouse
Seed units when kit child lines are created, and make every kit warehouse
mutation patch those units — converging kit members onto the loose-gear helpers.

- **Seed at creation** — in `createKitLineItemCore` (`projectLineItems.ts:472`),
  after inserting each serialised child line call `ensureSerialisedUnit(line,
  assetId)`; after each bulk child line call `ensureBulkUnit(line, bulkAssetId,
  qty)`. Units start `CONFIRMED`. Recurse for nested-kit grandchildren.
- **Kit-edit-after-add — verified unnecessary (impl audit 2026-07-12).** Kit
  child lines are created ONLY by `createKitLineItemCore` (now seeds units) and
  deleted ONLY by `removeNative` (cascades unit deletes). No mutation swaps a
  member's `assetId` or adds a member to an existing project kit
  (`kitAllocations.ts` is per-model revenue % only), so the snapshot + its units
  can't drift post-add. No sync code required.
- **Prep / deprep (in scope — codex #3)** — `prepKitChildren` → `setKitTreePrep`
  and `deprepKit` (`checkRecordOps.ts:204`) today patch **lines only**. Rewrite
  them to patch `unit.prepStatus` (`PACKED` / `PENDING`) so the per-unit prep
  lifecycle actually exists. `deprep` must preserve CHECKED_OUT/RETURNED units
  (same guard as `deprepItemInner`).
- **Checkout** — for each serialised member: patch its (already-existing) unit
  `CHECKED_OUT`+`checkedOut*`, flip asset as `checkOutSerializedItem` does,
  `scanLog`; for each bulk member: patch the bulk unit + existing availability
  adjustment. **Also run `expandAccessoriesForAsset`** for each member so
  accessories-on-kit-members get their units (codex #6). Recurse nested kits.
- **Check-in** — flip each CHECKED_OUT member unit `RETURNED`+`returned*`+
  `returnCondition`; restore asset via `assetStatusFromReturnCondition`; cascade
  accessory child units. **Legacy fallback (codex #1):** if a member has no unit
  (a kit added before this change, pre-backfill), fall back to the legacy line/
  asset flip and do not throw. This tolerance is removed in Phase 3 once backfill
  guarantees units exist.
- **Reverse + force mutations** — `undeployKit`, `unreturnKit`, `forceReturnKit`,
  **and `forceReturnAsset` / `bulkForceReturnAssets`** (`warehouseOps.ts:318`,
  codex #10) must flip units too, or they go split-brain. `unreturnKit` must
  **clear** `returnedAt`/`returnedById`/`returnCondition`/`returnStatus`/
  `returnNotes` when flipping back to CHECKED_OUT, not just the status (codex #11).
- **Line status** — replace direct child-line status patches with
  `syncLineItemRollup(childLineId)`. Kit **parent** line + `kits` doc status stay
  patched directly (kit-level, not unit-derived).
- **Asset-status belt** — untouched this phase (belt-owns-assets decision): the
  legacy `kitSerializedItems`/child-`assetId` flip keeps owning asset status +
  counters. The unit path never touches assets in Phase 1, so there is no double
  flip. (`bumpAssetCounters` is already delta-based + re-reads the asset before
  each bump, so it stays idempotent regardless — verified, no code change.)
- **Parity guard → deferred to Phase 3 (impl audit 2026-07-12).** A hard divergence
  throw in `checkoutKit` would block legitimately-diverged kits (kit contents can
  change via warehouse/CSV import without touching a project's frozen child-line
  snapshot — `kitAllocations.ts:18`; the int-test even builds asset-free kits). It
  guards the `kitSerializedItems` belt, which Phase 3 strips — so the guard lands
  there, alongside the verification cutover, where a throw is correct rather than a
  new failure mode on untouched legacy code.
- **`ConvexError` only**; `ensure*` helpers are already `createIfMissing`-safe.
  Guarded single-row assertions per the parent design's concurrency rule.
- **Tests:** see the coverage diagram in the eng-review appendix — checkout /
  check-in / prep / reverse / force / nested / bulk / accessory / pre-change
  fallback (regression) / parity guard / kit-edit sync.

### Phase 2 — Backfill kits added before Phase 1
Only kits whose child lines predate Phase 1 lack units (going-forward kits are
seeded at creation).

- **Mechanism (codex #7):** a **registered, paginated Convex mutation** (e.g.
  `convex/backfillKitUnits.ts`) invoked from a workflow/CLI, **not** a `tsx`
  script calling `ensure*` helpers — those are internal server helpers, not
  script-callable. Follow the existing backfill-mutation pattern; refresh the
  Convex service token per batch per [[convex-backfill-token-refresh]].
- For every kit-child line with no existing unit, create one via the same helpers,
  stamping **full lifecycle** from the current line — not bare CONFIRMED (codex
  #8): CHECKED_OUT lines → CHECKED_OUT unit with `checkedOut*`; RETURNED lines →
  RETURNED unit with `returned*`/`returnCondition`; **prepped lines → carry
  `prepStatus: PACKED`**; bulk lines → carry `quantity` **and partial
  `returnedQuantity`**. Idempotent — safe to re-run.
- Recurse nested kits; skip accessory children (already unit-backed).
- Non-destructive: nothing new reads these until Phase 3 lifts the display path,
  so backfill is reversible.
- **No `ANALYZE`.** `projectLineItemUnits` is a **Convex** table; `ANALYZE` is
  PostgreSQL and has no meaning here (the CLAUDE.md ANALYZE rule is Prisma/Postgres
  only). Convex needs no post-bulk stats step.
- **Parity check:** every pre-backfill CHECKED_OUT/RETURNED kit member reachable
  via `unit → line → project` with matching `assetId`.

### Phase 3 — Surface + strip the old path
- **Equipment tab (retag, do NOT expand):** source each kit-child row's tag from
  `child.units[0]` instead of `line.asset`, and add the status badge. **Leave**
  the `isKitChild` exclusion in `equipment-row-descriptors.ts:63` as-is — a
  one-unit member has nothing to expand, so lifting it does nothing useful and
  only risks a redundant row (codex #4). **Hide the Reassign control for
  kit-child units** — `reassignSerialisedUnit` throws on kit children, so an
  exposed dropdown would offer an always-erroring action (kit-member reassign is
  Phase 4).
- **PDF (minimal):** `gearflow-table.ts` already reads `child.units` for tags and
  only expands when `quantity > 1` (`:805`); serialised kit members are qty-1, so
  **no new row and no `calculateItemHeight` change** are needed — just confirm the
  tag now resolves from the unit. Do **not** add per-unit rows for kit children.
  Still ship **one cross-pipeline integration test** (docket regression: kit row
  count unchanged, tag sourced from unit) per the PDF rule.
- **Strip** the `kitSerializedItems → kitSerializedAssetIds → setAssetsStatus`
  fulfillment flip and the Phase-1 legacy check-in fallback (units now guaranteed
  by backfill). `kitSerializedItems` remains the kit **definition** table (and the
  verification source per the parity-guard decision) — only its use *as a runtime
  fulfillment/asset-flip source* is retired.
- **Parity guard (codex #9, moved here from Phase 1):** now that the belt is gone
  and units are the fulfillment source, error at checkout verification if a
  project's child-line asset set diverges from the live `kitSerializedItems`
  definition — validate-set == deploy-set by construction. Safe here because the
  ambiguous dual-flip it used to guard no longer exists.
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

## Performance — Convex-native, one call per kit operation (hard invariant)

This whole path runs on the **Convex-native** surface and adds **zero new
round-trips**:

- **Reads** are reactive-native — the equipment tab reads one live
  `api.equipmentTab.bundle` subscription (`use-native-equipment-tab.ts`); kit-member
  units ride that same bundle. No Prisma, no polling.
- **Writes** are Convex mutations, and `projectLineItemUnits` has **no Prisma
  mirror** (only `member-mirror.ts` / `user-mirror.ts` exist), so unit writes are
  Convex-only — no dual-write cost.

**Single-call invariant (the thing to protect):** every kit operation does **all N
members in ONE Convex mutation**, never one round-trip per member. This is already
true today (`checkoutKit`/`checkinKit` loop all members internally in a single
transaction; `checkOutKitsBatch` is one client round-trip). The migration must keep
it true:

- **All** per-member unit work — `ensureSerialisedUnit`/`ensureBulkUnit` at seed,
  status patches at checkout/checkin/prep, `expandAccessoriesForAsset`,
  `syncLineItemRollup`, asset flips — runs **inside** `createKitLineItemCore` /
  `checkoutKit` / `checkinKit` / `setKitTreePrep` / `deprepKit`, looping members in
  the mutation body. **Never** loop `convex.mutation(...)` per member from the
  server action. The server action's only job stays: one `requirePermission`, one
  mutation call, one `logActivity`.
- The nested-kit recursion also stays in-mutation (grandchildren flip in the same
  transaction as the parent).
- **Ceiling to respect:** a single mutation has Convex read/write/time limits. A
  huge or deeply nested kit (dozens of members × accessories) does all that work in
  one transaction — bounded-size check required; if real kits can exceed it,
  paginate the *backfill*-style pattern rather than splitting the live checkout into
  per-member calls (which would reintroduce the round-trip cost we're avoiding).
- **Multi-kit batches** (`checkOutKitsBatch`/`checkInKitsBatch`) intentionally stay
  one-mutation-per-kit for per-kit error isolation — that's per *kit*, not per
  *member*, and is not a regression. (Collapsing multi-kit into a single mutation is
  a separate batching effort, out of scope — see [[bulk-op-batching]].)

## Risks

1. **Split-brain asset sets (codex #12, the real one)** — the legacy belt flips
   assets from `kitSerializedItems` while the unit path flips from child-line
   snapshots. If those sets differ (kit edited after add), unrelated assets flip.
   Mitigation: the parity guard errors on divergence; the kit-edit-after-add sync
   keeps them aligned going forward.
2. **Pre-change kit check-in with no units (codex #1)** — a kit deployed before
   Phase 1, checked in after, has no units to flip. Mitigation: the Phase-1 legacy
   check-in fallback (no throw); backfill then guarantees units; fallback removed
   in Phase 3. Regression test required.
3. **Counter double-count** — belt + unit flip both touch asset status.
   Mitigation: `bumpAssetCounters` gated on an actual status transition, so the
   second fixed-status write is a no-op. (Lower severity than #1 per codex.)
4. **Large / nested kit mutation size** — seeding units at kit-add and patching
   them at checkout happen in single Convex mutations; a 50-member or deeply
   nested kit could approach Convex mutation limits. Mitigation: bounded-size
   check; paginate if kits can be huge (reuse the backfill pattern).
5. **Prep-path miss** — if `setKitTreePrep`/`deprepKit` aren't rewritten, the
   per-unit prep lifecycle silently doesn't exist. Mitigation: they are explicitly
   in Phase 1 scope; prep integration test.

## Docs to update as phases land
- **FEATUREDOCS/60** (assets on a job) — the "Physical kit member" row moves
  from `line.assetId` to `projectLineItemUnit`; kit members become unit-expanded.
- **FEATUREDOCS/48** (child assets & accessories) — kit-member child kind now
  unit-backed.
- **line-item-fulfillment-model.md** — mark the line-89/line-163 contradiction
  resolved (link here); update the Phase 4 column-drop status.
- **ARCHITECTURE.md** table if a new FEATUREDOCS file is added.

---

## Implementation status

- **Phase 1 — COMPLETE (2026-07-12).** Seeding, prep tree, checkout/checkin,
  reverse (undeploy/unreturn), force (forceReturnKit/Asset/bulk), and
  accessories-on-members all wired unit-only alongside the untouched legacy belt.
  17 integration tests in `convex/kitPerUnit.test.ts`; full convex suite green
  (269). `bumpAssetCounters` left unchanged (already idempotent). Kit-edit sync
  found unnecessary; parity guard moved to Phase 3 (see Phase 1 notes above).
  Members are **not yet visible** on the equipment tab/PDF — that's Phase 3.
- **Phase 2 — NEXT.** Backfill kits added before Phase 1.

## Eng-review appendix (2026-07-12)

`/plan-eng-review` + codex outside voice. Cross-model agreement on display model
(codex #4/#5 ↔ Issue 2) and phase ordering (codex #1). Decisions above.

### What already exists (reused, not rebuilt)
- **Per-unit fulfillment machinery** — `ensureSerialisedUnit` / `ensureBulkUnit` /
  `ensureAccessoryUnit`, `syncLineItemRollup`, `returnLineUnits`,
  `checkOutSerializedItem` (`convex/lib/fulfillment.ts`, `warehouseOps.ts`). Kits
  converge onto these; no parallel path.
- **Accessory child-kind unit pattern** (`parentUnitAssetId`) — the precedent for
  minting units for a non-loose child kind.
- **`projectLineItemUnits` schema** — already has every field/index needed; no
  schema change.
- **Kit prep path** (`prepKitChildren`/`setKitTreePrep`/`deprepKit`) — exists but
  patches lines only; Phase 1 extends it to units rather than adding a new path.

### NOT in scope (deferred, with rationale)
- **Kit-member reassign** — Phase 4. Identity is tied to the kit slot; needs a
  same-kit-slot guard model. Visibility + lifecycle + history land first.
- **`line.assetId` column drop for kit children** — parent design's follow-up;
  unblocked by Phase 3 but shipped separately.
- **Collapsing kitSerializedItems into the snapshot / making project kits a live
  reference** — verification stays on the live definition + parity guard; a full
  snapshot-vs-live redesign is out of scope.
- **checkMode changes** — stays a scan-granularity-only control, untouched.
- **Paginating kit checkout for huge kits** — only if the bounded-size check shows
  real kits hit Convex limits.

### Failure modes (new codepaths)
| Codepath | Realistic failure | Test? | Error handling? | Silent? |
|---|---|---|---|---|
| checkinKit, pre-change kit | no unit to flip → throw / stuck asset | **required (regression)** | legacy fallback | would be silent → **must test** |
| forceReturnAsset / bulk | patches line, not unit → split-brain | required | flip units | silent → **critical gap until fixed** |
| checkout, edited kit | belt vs snapshot flip different assets | required | parity guard errors | guard makes it loud |
| seed at kit-add, huge kit | Convex mutation limit → 500 | perf test | bounded check | user sees warehouse 500 |
| prep path not rewritten | per-unit prepStatus never set | required | n/a | silent feature-absence |

Critical gaps flagged: **pre-change checkin fallback** and **forceReturn
split-brain** — both are regression-class, auto-added to the plan.

### Parallelization
Largely **sequential** — Phase 1 → 2 → 3 are hard-ordered (backfill must follow
the write path and precede the display cutover). Within Phase 1 there is one
parallel split:
- **Lane A:** `convex/warehouseOps.ts` write/reverse/force mutations + parity guard.
- **Lane B:** `createKitLineItemCore` seeding + `setKitTreePrep`/`deprepKit` prep
  rewrite (`projectLineItems.ts`, `checkRecordOps.ts`).

Lanes A and B touch disjoint files and can be built in parallel worktrees, but both
must land before Phase 2. Phase 3 (equipment-tab + PDF) is a separate lane gated on
Phase 2. Backfill mutation (`convex/backfillKitUnits.ts`) can be written anytime but
run only after Phase 1 deploys.
</content>
</invoke>
