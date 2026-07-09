# Revenue Allocation & Gear ROI

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
- `EXCLUDED_NON_GEAR` — custom / labour / container lines, and kit parents. No `modelId`.
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

### One weight chain, picked once per sibling set

```
1. kit allocation percent      -- only if the saved split still covers the kit
2. line.lineTotal              -- ITEMIZED kits, manual price overrides
3. model rate × qty × duration -- "nominal value" (weeklyRate/dailyRate)
4. replacementCost × qty       -- proxy: dearer gear earns proportionally more
5. 1                           -- equal split; nothing is ever invisible
```

Rules 3 and 4 recurse into containers, so a kit inside a group is weighted by the value of
its contents. A node weighed against its **own** children uses its own value only — counting
its subtree there would let a parent walk off with its accessories' share.

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
fleetCost  = replacementCost × unitsOwned
payback    = revenue / fleetCost
```

Not `revenue / replacementCost` — that overstates ROI by exactly the unit count, worst for the
models bought in the largest numbers. A model with no replacement cost, or none left in the fleet,
reports `—`: not `0` (looks like a dud), not `∞` (looks like a triumph).

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
than sharing one, joined in `src/server/roi.ts`.

Both cap their scans and return `truncated`, which the UI surfaces as a banner. A capped scan that
silently under-reports looks exactly like a fleet that isn't earning. When the caps start biting,
the fix is a scheduled org-level aggregate, not a bigger cap.

`projectModelRevenues` is a **pure cache** — safe to delete and rebuild from the line items at any
time by re-running the backfill.

## Files

| Path | Role |
|---|---|
| `convex/lib/allocation.ts` | The engine. Pure core + the Convex binding. |
| `convex/lib/recalc.ts` | Calls it, at the tail of every project recompute. |
| `convex/revenueAllocation.ts` | Standalone recompute (legacy path + backfill) and paginated project ids. |
| `convex/kitAllocations.ts` | Kit split: composition view, replace-all, clear. |
| `convex/roi.ts` | `getModelRoi`, `fleetRevenue`, `fleetInventory`. |
| `src/lib/roi.ts` | `computeRoi`, status scopes, window, formatting. |
| `src/server/roi.ts` | Joins the two fleet queries. |
| `src/server/kit-allocations.ts` | RBAC + validation + audit for the kit split. |
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
- Adding a new line-item *kind* means deciding its `allocationBasis`. If it has a `modelId` and
  isn't ours, it must consume weight and be excluded — see the sub-hire case.
