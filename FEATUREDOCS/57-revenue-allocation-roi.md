# Revenue Allocation & Gear ROI

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Splits what a client paid across the gear that earned it, so per-**model** ROI is
answerable — including for gear that only ever ships inside a kit or a priced bundle.

Design rationale (and the eight corrections made to the original spec):
[docs/revenue-allocation-design.md](../docs/revenue-allocation-design.md).

## Why it was needed

Three of the most common ways gear enters a project produce line items that could
never be attributed revenue:

- `recalcProjectTotals` bills grouped equipment as `SUM(group.price × group.quantity)`.
  **A grouped line item's own `lineTotal` never reaches project revenue.**
- Kit children under `pricingMode: "KIT_PRICE"` are inserted with no `unitPrice` and
  no `lineTotal`.
- Accessory children (`childKind: "ACCESSORY"`) are never given a price at all.

## The stored fields

On `projectLineItems`:

| Field | Meaning |
|---|---|
| `allocatedRevenue` | This line's share of the revenue it helped generate, in dollars. |
| `allocationBasis` | How that share was decided. Audit trail **and** a correctness primitive. |

`allocationBasis` gates ROI. A row counts iff `modelId != null` and the basis is one of
`DIRECT`, `KIT_PERCENT`, `WEIGHTED`, `EQUAL_SPLIT`. The excluded bases:

- `EXCLUDED_SUBHIRE` — sub-hired gear. It **consumes pool weight** (so the owned gear
  beside it isn't over-credited) and the number is stored for audit, but it was never
  our capital, so it earns no ROI.
- `EXCLUDED_NON_GEAR` — custom / labour / container lines, and kit parents. No `modelId`, so
  never counted toward ROI. A **priced** custom item inside a group is a special case: it is part
  of the group's flat price, so it **consumes its own `lineTotal` off the pool** (owned gear splits
  the rest) and is NOT billed on top. An unpriced group's customs still bill on their own line.
- `NO_REVENUE` — the pool was $0, or the line is cancelled / optional.

## How it runs

Allocation hangs off **`recalcProjectTotals`** (`convex/lib/recalc.ts`) — the function
every line-item, group, service and sub-hire write already funnels through. There is no
separate trigger list, and no way to add a write path that forgets to allocate.

- Native path (`NATIVE_RECALC`): allocates inline off reads it already did.
- Legacy path: `src/server/line-items.ts` calls `api.revenueAllocation.recomputeForProject`
  afterwards.

Flipping the flag changes latency, never the numbers.

Allocation is **never computed at read time**, and never reads a live model price during a
report. That is what makes it a snapshot: re-pricing a model tomorrow does not restate what
a project earned last year, because nothing recomputes that project. Line patches are
diffed, so a 200-line project costs ~0 writes when an edit moves no allocation.

## The algorithm

One recursive walk of the line-item tree — **not** a group layer followed by a kit layer,
which breaks the moment a third level exists (group → kit → child → accessory).

```
group        → pool = price × quantity     (rounded on the PRODUCT, as recalc bills it)
ungrouped    → pool = lineTotal
distribute(pool) into node:
    participants = non-cancelled children + node itself, if node.modelId != null
    leaf         → takes the pool
    otherwise    → split by weight, in integer cents, recurse
```

A parent gear line with accessories is **both** a leaf and a container: it keeps its own
share and gives its accessories theirs. Kit parents have no `modelId`, so they take none.

### Per-item weight, one unit throughout

A saved kit split wins if it still covers the kit; otherwise each item is weighted by its **own**
best signal, in rental dollars:

```
weightOf(item):
  set price (lineTotal > 0)                -- ITEMIZED kits, manual overrides, priced group members
  else hire rate × qty × duration          -- weeklyRate/dailyRate per the rental period
  else replacementCost × rateFactor × qty  -- cost as a rate-equivalent, SAME unit as a rate
  else 0                                    -- equal split when nothing has a signal
```

An **explicit $0** line is a freebie: excluded from the split and from ROI. An unpriced "—" line is
not — it still earns via its rate or cost.

`rateFactor` is the fleet's median rate ÷ cost (across models with both), or ~1.5%/day of value as a
fallback. It converts a cost-only item into a rate-equivalent so it doesn't dwarf a rated item, and
**cancels out** in an all-cost set — so it only matters where a group mixes rated and cost-only gear.
This is IFRS 15 / ASC 606 relative-standalone-price allocation with a principled proxy for the rate.

The weight recurses into containers, so a kit inside a group is weighted by the value of its
contents. A node weighed against its **own** children (accessory parent) counts only itself, by
rate/cost — counting its subtree there would let it walk off with its accessories' share.

### Rounding

Integer cents, largest remainder, ties broken by `sortOrder` then `id`. `SUM(children) == pool`
exactly. Per-item rounding leaks cents, and a leak here silently skews every ROI number in a
direction nobody spots by eye. Determinism matters for a second reason: a shuffled cent would
dirty the diff on every no-op recompute.

## Kit allocation (`kitRevenueAllocations`)

One row per **model** in a kit, not per member asset. Kit contents are `kitSerializedItems`
(per asset) and `kitBulkItems` (per bulk asset); a per-row percentage would make the same model
appear N times as N percentages to keep in sync, and would break every time an asset is swapped.

- Suggested from `replacementCost × qtyInKit`, rounded in hundredths of a percent with largest
  remainder so the suggestion always totals exactly 100.00.
- A model's percent is split across the lines carrying it, in proportion to quantity.
- **Percentages are advisory.** Kit contents change from the warehouse and CSV import without
  ever touching the allocation form, so the engine applies a saved split only if it *exactly
  covers* the kit's current models. Otherwise it falls through the weight chain and the kit is
  flagged "allocation out of date". Validation is a UI affordance; the weight chain is the
  correctness guarantee. **Allocation never blocks a booking.**

Saving an allocation does not restate past projects — only future recomputes use it.

## Reporting

A quote is not revenue. Aggregation filters on project status:

- Counted by default: `COMPLETED`, `INVOICED`.
- Opt-in ("including booked work"): `CONFIRMED`, `PREPPING`, `CHECKED_OUT`, `ON_SITE`, `RETURNED`.
- Never: `ENQUIRY`, `QUOTING`, `QUOTED`, `CANCELLED`.

ROI is measured against the capital actually deployed:

```
unitsOwned = active assets + SUM(active bulkAssets.totalQuantity)

# Serialised: SUM per asset — not a uniform multiply. Each unit's own purchase
# price wins if it has one; models bought at different times/prices are not
# forced onto one number (gearflow#798).
serialisedCost = SUM over each owned asset of:
  asset.purchasePrice
  else model.defaultPurchasePrice
  else model.replacementCost
  else 0                              -- no signal for this unit

# Bulk: unchanged — one rate for the whole stock line, out of scope for #798
# (bulkAssets.purchasePricePerUnit is a separate, already-per-unit field a
# future issue can wire up).
bulkCost  = replacementCost × SUM(active bulkAssets.totalQuantity)

fleetCost = (serialisedCost + bulkCost), or NULL if unitsOwned == 0 or the sum is $0
payback   = revenue / fleetCost
```

Not `revenue / replacementCost × unitsOwned` — that overstates ROI by exactly the unit count
(worst for the models bought in the largest numbers) AND assumes every unit cost the same, which
is untrue the moment a model's assets were bought at different prices over time. A model with no
cost signal anywhere — no asset purchase price, no model-level purchase price or replacement
cost — or none left in the fleet, reports `—`: not `0` (looks like a dud), not `∞` (looks like a
triumph). A raw per-asset/bulk sum of exactly `$0` is treated identically to "no signal" — it's
indistinguishable from "nothing priced it" and the alternative (reporting $0 fleet cost) reads as
infinite ROI on a progress bar.

The fallback chain is per-ASSET, not per-model: two units of the same model can legitimately
resolve through different rungs of the chain (one has its own `purchasePrice`, the sibling falls
back to `model.replacementCost`) and both contribute to the same model's `fleetCost` total.

### Surfaces

| Where | What |
|---|---|
| Kit detail → *Revenue allocation* | Per-model split, cost-weighted suggestion, auto-balance, stale banner. |
| Model detail → *ROI* tab | Revenue, fleet cost, payback bar, revenue per unit, and the projects that produced it. |
| `/assets/roi` → *Fleet ROI* | Every model ranked by payback. Sortable, filterable by scope + window. |

Fleet ROI reads off **inventory**, not off revenue, so models with $0 revenue and real capital
still appear — dead capital never shows up in a revenue-driven query, because it produced no rows.
It gets its own stat tile ("idle capital"), which is the number that motivates a sell/keep call.

### Read budget

Summing `allocatedRevenue` across every line item of every project does not fit in a Convex
query. `projectModelRevenues` (one row per model per project, rebuilt inside the same allocation
pass) reduces the fleet query to distinct-models-per-project. Fleet reporting is then split across
**two** queries — `fleetRevenue` and `fleetInventory` — so each gets its own read budget rather
than sharing one, joined client-side in `src/hooks/use-roi.ts` (browser-direct `useConvex().query()`
calls — no server action in between; `src/server/roi.ts` doesn't exist).

Both cap their scans and return `truncated`, which the UI surfaces as a banner. A capped scan that
silently under-reports looks exactly like a fleet that isn't earning. When the caps start biting,
the fix is a scheduled org-level aggregate, not a bigger cap. In practice this doesn't bite a small
org — `PROJECT_SCAN_CAP` (1500) and `ROLLUP_READ_BUDGET` (10,000 rollup rows) are both far above
what a few hundred projects ever produce, so if a fleet report looks short on a small org, the
`truncated` banner is not why — see "Why revenue looks low" below.

`projectModelRevenues` is a **pure cache** — safe to delete and rebuild from the line items at any
time by re-running the backfill.

### Why revenue looks low

The #1 cause: **an unpriced group carrying real gear.** `recalcProjectTotals` bills grouped
equipment as `group.price × group.quantity` — a grouped line item's own `lineTotal` never reaches
revenue (see "Why it was needed" above). If a group's `price` is `0`/unset, the gear inside it
reports $0 in **both** the project's own total **and** ROI — restructuring a project into groups
(e.g. a historical-data backfill done through the app) fixes the *shape* of the data but not the
*price*, and it's easy to move gear into a group without noticing the group itself was never given
a flat price.

`api.roi.zeroPricedGroups` (`convex/roi.ts`) finds these: every group in a counted-status project
with `price ?? 0 === 0` that still contains a non-cancelled, non-optional, non-custom line with a
`modelId`. It returns the group's `suggestedPrice` (the same cost-weighted hint the group-price UI
shows) as a hint of what it's probably worth — never treated as the answer, since it's a cost
proxy, not what the client was actually charged. Surfaced as a collapsible banner on `/assets/roi`
(`useZeroPricedGroups`, `src/hooks/use-roi.ts`) linking straight to the offending project — that's
the fix, not a bigger cap or a recompute; the number is faithfully reporting $0 because the group
really has no price on file.

The #2 cause: **scope/window, not data.** The default view is `earned` (COMPLETED + INVOICED
only) over the trailing 12 months — a fleet mostly sitting in `CONFIRMED`/`CHECKED_OUT` or with a
lot of history outside the last year will look emptier than "all the money we've made". Switch to
"Including booked work" + "All time" before assuming the allocation itself is wrong.

Related gotcha: `defaultRoiWindow(scope)` leaves `to` **open** for `booked` scope specifically —
capping it at `now` (as `earned` does) would hide the future-dated `CONFIRMED`/`PREPPING` bookings
that scope exists to show, forcing a second switch to "All time" just to see next week's job.

### Fleet cost fallback chain (gearflow#798)

Serialised-asset fleet cost is a per-asset chain, not a single model-wide scalar:
`asset.purchasePrice ?? model.defaultPurchasePrice ?? model.replacementCost`. The middle rung was
a deliberate choice, not a guess (POLICY.md R-3.1 — recorded here so it isn't re-litigated):
`defaultPurchasePrice` is the semantically correct fallback ("what we generally pay for this
model" vs. `replacementCost`'s "what it'd cost to replace it today"), but falling through further
to `replacementCost` when `defaultPurchasePrice` is also unset matters — `replacementCost` is the
field every other ROI/allocation surface already populates (kit-allocation weighting, the
allocation engine's `rateFactor` derivation), so skipping it would silently regress models that
report a real fleet cost today back to `—` purely because `defaultPurchasePrice` was never
backfilled.

Every rung is treated as "no signal" when it's `≤ 0`, not just when it's unset — the long-standing
"a zero replacement cost is unknown, not free capital" rule (`src/lib/roi.test.ts`), now applied
uniformly across the whole chain (`positiveCost` in `convex/roi.ts`).

`bulkAssets` are explicitly out of scope: their fleet cost stays `replacementCost × totalQuantity`
(`bulkAssets.purchasePricePerUnit` is a separate, already-per-unit field a future issue could wire
up the same way).

## Files

| Path | Role |
|---|---|
| `convex/lib/allocation.ts` | The engine. Pure core + the Convex binding. |
| `convex/lib/recalc.ts` | Calls it, at the tail of every project recompute. |
| `convex/revenueAllocation.ts` | Standalone recompute (legacy path + backfill) and paginated project ids. |
| `convex/kitAllocations.ts` | Kit split: composition view, replace-all, clear. |
| `convex/roi.ts` | `getModelRoi`, `fleetRevenue`, `fleetInventory`, `zeroPricedGroups`, `fleetCapitalFor` (the per-asset fleet-cost chain). |
| `src/lib/roi.ts` | `computeRoi`, status scopes, window, formatting. |
| `src/hooks/use-roi.ts` | Browser-direct: joins the two fleet queries client-side (one-shot, not reactive — a ROI report has no liveness need). |
| `convex/kitAllocationsWrites.ts` | Browser-direct RBAC + validation + audit for the kit split. |
| `src/lib/validations/kit-allocation.ts` | Zod schema + the `KitAllocationView` type. |
| `src/components/kits/kit-allocation-panel.tsx` | Kit detail panel. |
| `src/components/assets/model-roi-tab.tsx` | Model detail ROI tab. |
| `src/components/roi/fleet-roi.tsx`, `payback-bar.tsx` | Fleet ROI page. |
| `scripts/convex-backfill-revenue-allocation.ts` | One-time historical backfill. |

## Tests

- `convex/allocation.test.ts` — the money gate. The invariant every test really checks is that the
  parts sum to the pool, exactly, in cents. Includes the design doc's worked examples (RF Kit at
  $900, Vocal RF Package discounted to $400), stale allocations, sub-hire dilution, and parent cycles.
- `convex/allocationPipeline.test.ts` — proves allocation actually **lands** through
  `recalcProjectTotals`. A pure-unit suite passes happily while the pass is never invoked.
- `src/lib/roi.test.ts` — the fleet-cost denominator, and that a quote never counts.

## Backfill

Allocation is maintained automatically from here on. Projects last edited **before** this shipped
will never recalculate on their own and would report $0 for every model forever:

```bash
pnpm convex:backfill:revenue-allocation
```

Idempotent — it recomputes from the line items and diffs the writes, so re-running converges any
drift and costs nothing where nothing changed. It exits non-zero on partial failure: a backfill that
half-worked must not be mistaken for one that worked.

## Gotchas

- **`convex/schema.ts` is NOT safe to regenerate.** It carries hand-added search/composite indexes
  and (Phase C) tables whose Prisma models are already stripped. Generate into a scratch dir, diff,
  hand-merge the stanza.
- **`bulkAssets.totalQuantity`, not `quantity`** (that's `kitBulkItems`) and not `availableQuantity`
  — ROI is about the capital we bought, not what's on the shelf today.
- **`by_cuid` and `by_modelId` are global indexes.** `requireOrgRead` validates the *caller's* org,
  not the *row's*. Any doc fetched by cuid or by modelId must be checked against `organizationId`,
  or a tenant can read another tenant's model costs by guessing an id.
- **Status gating lives in the Convex query itself, not in a server-action wrapper** (there isn't
  one — see Files above). A browser holds a
  user token and can call an org-scoped query directly.
- **Pools are scaled by `1 − discountPercent/100`.** Group and line prices are pre-discount;
  `recalcProjectTotals` discounts the subtotal. Allocating raw prices credits revenue that was
  never billed.
- **A cap on projects is not a cap on reads.** Rollup rows per project are unbounded — budget the
  rows. And scan projects **newest-first**: `.take(n)` is an index prefix, and every report opens on
  a trailing window.
- **Allocation is recomputed per project, not frozen.** Any edit to an old project restages its
  whole split using today's model rates and kit percentages. Only lines with no `lineTotal` of their
  own (KIT_PRICE kit children, accessories) can actually move.
- Adding a new line-item *kind* means deciding its `allocationBasis`. If it has a `modelId` and
  isn't ours, it must consume weight and be excluded — see the sub-hire case.
