# Revenue Allocation for Gear ROI

> Status: **built** (branch `feat/revenue-allocation-roi`). This document is the *rationale* —
> why each rule exists, and the eight corrections made to the original sketch. For what the code
> actually does and where it lives, read [FEATUREDOCS/57](../FEATUREDOCS/57-revenue-allocation-roi.md).
>
> Two further bugs were found by an independent review of the engine after it was written, and are
> covered by tests: group pools must round the *product* of price × quantity (rounding the price
> first allocates money the project never charged), and a `parentLineItemId` cycle has no root, so
> its pool silently vanished until stranded components were promoted to roots.

## Problem

Gear is often booked inside kits (static pre-built bundles) or groups (ad-hoc bundles assembled
per-project). When a kit or group is priced as a unit, the individual models inside it show $0
revenue — making per-model ROI impossible.

Example: an RF Kit rents for $900/day. It contains 4× receivers, 4× beltpacks, 4× headsets,
antenna distros, switches, mic belts, and batteries. Currently all $900 sits on the kit line item
and the child models report zero income.

This is not a niche case. In this codebase it is the **default** case:

- `recalcProjectTotals` computes equipment revenue as `SUM(group.price × group.quantity)` for
  grouped items plus `SUM(lineTotal)` for ungrouped ones. **A grouped line item's own `lineTotal`
  never reaches project revenue.** Every line inside a priced group is already a $0-revenue row as
  far as the books are concerned.
- Kit children created under `pricingMode: "KIT_PRICE"` are inserted with `unitPrice: undefined`
  and `lineTotal: undefined`.
- Accessory children (`childKind: "ACCESSORY"`) are *never* given a price at all.

So today, three of the most common ways gear enters a project all produce line items that can never
be attributed revenue.

## Goal

Track **model-level ROI** — not individual asset/serial-level ROI. We don't care whether asset
TTP00001 out-earned TTP00002. We care whether the *model line* (e.g. "EW-DX EM 2 Dante", "IMX6A
Headset") is earning its keep across all units and all bookings combined.

Every line item — whether standalone, inside a kit, inside a group, or an accessory hanging off
another line — should carry an `allocatedRevenue` value that represents its fair share of the
revenue it helped generate. Revenue is then aggregated **by modelId**, never by serial number.

---

## Correction 1 — the ROI denominator is fleet cost, not unit cost

The original formulation was:

```
modelROI = SUM(allocatedRevenue) / model.replacementCost      ❌ WRONG
```

This is wrong whenever you own more than one unit of a model. If you own 8 receivers at $2,000
each, you have $16,000 of capital deployed, not $2,000. Dividing total fleet revenue by the cost
of a *single* unit overstates ROI by exactly the unit count — and it overstates it *most* for the
models you bought the most of, which are precisely the ones the report exists to scrutinise.

```
unitsOwned    = COUNT(assets WHERE modelId = M AND isActive)
              + SUM(bulkAssets.totalQuantity WHERE modelId = M AND isActive)

fleetCost     = model.replacementCost × unitsOwned

modelROI      = SUM(allocatedRevenue) / fleetCost
```

`unitsOwned` is derived from the `assets.by_modelId` and `bulkAssets.by_modelId` indexes. It uses
`totalQuantity`, not `availableQuantity` — ROI measures the capital we bought, not how much of it
happens to be on the shelf today. A model with `unitsOwned = 0` or `replacementCost = null` has
**no ROI** — report it as "—", not as zero and not as infinity.

Derived metrics worth showing alongside the raw ratio:

| Metric | Formula | Reads as |
|---|---|---|
| Payback | `revenue / fleetCost` | "1.4× — it has paid for itself 1.4 times" |
| Revenue per unit | `revenue / unitsOwned` | comparable across fleet sizes |
| Cost recovered | `min(1, revenue / fleetCost)` | progress bar toward break-even |
| Still to recover | `max(0, fleetCost - revenue)` | the number that motivates a sell/keep call |

## Correction 2 — allocated revenue is money, not a daily rate

The original examples allocate `$900/day → $315/day`. ROI is a lifetime capital question, so the
stored number must be **actual dollars booked**, i.e. the parent's `lineTotal`
(`unitPrice × quantity × duration − discount`) or the group's `price × quantity` — periods already
multiplied in. `allocatedRevenue` is denominated in the same currency as `lineTotal`, and the
invariant is:

```
SUM(children.allocatedRevenue) == parent's allocation pool     (to the cent)
```

### …and "booked" means after the project discount

Group and line prices are pre-discount. `recalcProjectTotals` applies `project.discountPercent` to
the *subtotal*, so it never touches the numbers the allocation pass reads. Allocating them raw
would credit gear with revenue the project never charged — a job discounted 100% would report full
ROI on every piece of gear that went out on it.

Every pool is therefore scaled by `1 − discountPercent/100` before it is split. The factor is
clamped to `[0, 1]`: a discount outside that range is bad data, and neither negative revenue nor
revenue above the listed price is something to invent.

## Correction 3 — sub-hire lines dilute the pool but earn no ROI

The original spec said sub-hire items are "excluded from allocation" and in the very next sentence
that they "keep their own `lineTotal` as their `allocatedRevenue`". Both can't be true, and neither
is right on its own:

- If sub-hired gear is given `allocatedRevenue`, and it carries a `modelId` (it can — you sub-hire
  a model you also own), that revenue is credited to **your** model's ROI. You'd be taking credit
  for capital you never spent.
- If sub-hired gear is skipped entirely and takes **no share of the pool**, then the owned gear in
  that group absorbs 100% of the group price — inflating the ROI of the gear that happened to be
  bundled next to a sub-hire.

Correct handling: sub-hire lines **consume their proportional weight** (so owned gear isn't
over-credited), the resulting number is **stored** for audit, and the row is **tagged
`EXCLUDED_SUBHIRE`** so ROI aggregation skips it. This is why `allocationBasis` exists.

---

## The stored fields

On every line item (`projectLineItems`):

```
allocatedRevenue : number | null            -- this line's share, in dollars
allocationBasis  : AllocationBasis | null   -- HOW that share was decided
```

`allocationBasis` is the auditable trail the original doc asked for, and it is also load-bearing
for correctness (it's what tells the ROI query to skip sub-hires and custom items):

| Basis | Meaning |
|---|---|
| `DIRECT` | Leaf line, priced on its own. `allocatedRevenue == lineTotal`. |
| `KIT_PERCENT` | Split by the kit's configured `allocationPercent`. |
| `WEIGHTED` | Split proportionally by the weight chain below. |
| `EQUAL_SPLIT` | Nothing to weight on — split evenly. |
| `EXCLUDED_SUBHIRE` | Number stored; **not** counted toward model ROI (not our capital). |
| `EXCLUDED_NON_GEAR` | Custom / labour / container line. No `modelId`; nothing to attribute. |
| `NO_REVENUE` | Pool was $0 (unpriced group, $0 kit, cancelled, optional). Stored as `0`. |

ROI aggregation counts a row iff `modelId != null AND allocationBasis IN (DIRECT, KIT_PERCENT,
WEIGHTED, EQUAL_SPLIT)`.

---

## Correction 4 — one weight chain, not two

The original describes two unrelated algorithms: manual percentages for kits, hire-price ratios for
groups. In practice they are the same operation — *distribute a pool across participants by weight*
— differing only in where the weight comes from. Collapsing them into one chain means one
implementation, one test suite, and one place for the rounding to be right.

**Distribute a pool `P` across participants:**

```
weightOf(line):
  1. kit allocation percent      -- only when the parent is a kit with a valid saved allocation
  2. line.lineTotal              -- if EVERY sibling is priced. ITEMIZED kits, manual overrides
  3. model rate × quantity       -- ONLY if EVERY sibling has a rate (weeklyRate/dailyRate)
  4. model.replacementCost × qty -- "purchase value" — the default whenever rates aren't complete
  5. 1                           -- equal-split token; nothing is ever invisible
```

Each rule is tried across **all** participants before falling through; the chain is chosen once per
sibling set, never mixed within one. That is what makes the result stable and explainable ("this kit
was split on replacement cost because not every model has a day rate").

**Rules 2 and 3 are all-or-nothing on purpose.** A rate (or price) is used to weight the split only
when *every* sibling has one. If even a single item lacks a rate, weighting on rates would hand that
item **$0** while the rated items took the whole pool — so the set falls straight through to
replacement cost (purchase value), keeping the split in one consistent signal and leaving nothing at
zero. In practice, a fleet whose gear mostly has no hire rates set will split every group and kit by
purchase value, which is both the intended fallback and the same figure ROI divides by.

Rule 2 is why groups behave exactly as the original doc intended without a bespoke code path: a
group's members are top-level lines that already carry `lineTotal = rate × qty × duration`. When a
group is priced at its `suggestedPrice`, every member's allocation lands on its own `lineTotal`.
Discount the group and everyone takes a proportional haircut — the relative weighting stays fair.

### Rounding — largest remainder

Splitting $400 six ways by percentage will not sum to $400 in cents. Naive per-item rounding leaks
money and breaks the `SUM(children) == pool` invariant, which then quietly corrupts every ROI number
downstream. Allocation is done in **integer cents** using the largest-remainder method: floor every
share, then hand the leftover cents out one at a time to the participants with the largest
fractional remainders (ties broken by `sortOrder`, then `id`, so the result is deterministic).

---

## Correction 5 — kits have no per-model rows to hang a percentage on

The original assumes a "kit template member" keyed by model. There is no such row. A kit's contents
are `kitSerializedItems` (one row **per asset**) and `kitBulkItems` (one row per bulk asset, with a
quantity). Storing `allocationPercent` on those rows would mean:

- the same model appearing 4× as 4 separate percentages a user has to keep in sync, and
- the allocation **breaking every time an asset is swapped** in or out of the kit.

Instead, allocation is stored per **model** in a new table, which is also the grain ROI reports on:

```
KitRevenueAllocation { id, organizationId, kitId, modelId, allocationPercent }
  @@unique([kitId, modelId])
```

At expansion time, a model's percentage is split across the child lines carrying that model, in
proportion to each child's quantity. Swap receiver TTP00003 for TTP00009 and the allocation is
untouched.

### Default suggestion

Don't make users type percentages from scratch. Auto-suggest on `replacementCost`:

```
suggestedPercent(model) = (replacementCost × qtyInKit) / SUM(replacementCost × qtyInKit) × 100
```

A $2,000 receiver naturally gets a bigger slice than a $15 mic belt. Users override any row; the UI
shows a running total and an **Auto-balance** action that distributes the remainder across the rows
the user hasn't pinned.

### Validation, and what happens when validation isn't enough

- Sum of `allocationPercent` for a kit must equal 100% (±0.01) to save. The UI blocks otherwise.
- **But saving is not the only way kit contents change.** Assets are added to and removed from kits
  from the kit detail page, from the warehouse, and by CSV import — none of which route through the
  allocation form. A kit can therefore always drift into a state where its allocation doesn't cover
  its contents.

So the runtime **never** trusts the stored percentages blindly and **never** blocks a booking:

> An allocation is applied only if the saved model set **exactly covers** the kit's current model
> set. Otherwise the kit silently falls through to rule 2/3/4 of the weight chain, and the kit is
> flagged **"allocation out of date"** in the UI.

Validation is a UI affordance. The weight chain is the correctness guarantee.

---

## Correction 6 — accessories currently earn nothing, forever

`expandAccessoryChildLines` creates `childKind: "ACCESSORY"` children with no `unitPrice` and no
`lineTotal`. They carry a `modelId`. Under the original spec they'd never be allocated anything, so
every accessory model reports $0 revenue and 0% ROI in perpetuity — the exact failure this feature
exists to fix, just moved somewhere less visible.

Accessory children participate in the split. A handheld line with a battery-kit accessory
distributes its `lineTotal` across `[the handheld itself, the battery kit]` by weight. The handheld
gives up the battery kit's proportional share, which is the honest attribution: the client paid one
price for both.

This means a **parent gear line is itself a participant** in its own distribution whenever it has a
`modelId`. Kit parents have `kitId` and no `modelId`, so they are pure containers and take no share.

---

## Correction 7 — it's recomputed, not written once

The original says allocation is "computed once … not recalculated on every read", and lists
triggers. Both halves of that are right, but "snapshot at booking time, frozen" is the wrong mental
model for a project that stays editable for weeks.

What actually holds:

- Allocation is **recomputed for the whole project on every mutation**, by hanging off
  `recalcProjectTotals` — the function every line-item, group, service, and sub-hire write already
  funnels through. There is no separate trigger list to keep in sync, and no way to add a code path
  that forgets to allocate.
- Allocation is **never computed at read time**, and never reads live model prices during a report.
  Re-pricing a model does not, by itself, move any past project's numbers.
- Writes are diffed — a line is patched only if its allocation actually changed — so a 200-line
  project doesn't take 200 writes per edit.

**The snapshot is per-project, not per-line, and it is not frozen.** Editing *anything* on an old
project — a service, a sub-hire, the tax rate — reruns the whole allocation using today's model
rates and today's kit percentages. Most lines are unaffected, because rule 2 weights on the line's
own stored `lineTotal`. The lines that can move are the ones with no price of their own: kit
children under `KIT_PRICE`, and accessories. If you need a booked project's internal split to be
immutable, freeze it on a terminal status; today it is not.

`CANCELLED` and `isOptional` lines get `allocatedRevenue = 0 / NO_REVENUE`; they neither earn nor
dilute.

---

## Correction 8 — a quote is not revenue

Nothing in the original stops a `QUOTING` project — or a `CANCELLED` one — from contributing to ROI.
Every speculative quote the sales team ever typed would inflate the fleet's earnings.

`allocatedRevenue` is stored on **all** projects (it is just arithmetic on the numbers present). The
*aggregation* filters by project status. Counted by default:

```
COMPLETED, INVOICED
```

Available as a toggle for pipeline views: `CONFIRMED, PREPPING, CHECKED_OUT, ON_SITE, RETURNED`
("booked"). Never counted: `ENQUIRY, QUOTING, QUOTED, CANCELLED`.

That policy is enforced **inside the Convex query**, not only in the server action that usually
calls it. A browser holds a user token and can call an org-scoped Convex query directly, so a caller
asking for `QUOTED` revenue has to get nothing back rather than a pipeline number dressed up as
earnings.

Reports are additionally scoped to a date window on `rentalStartDate` (default: trailing 12 months).
A windowed fleet report is a **range scan** over `(organizationId, rentalStartDate)`, so a project
with no rental date sits outside the range and is omitted; the all-time view still sees it, falling
back to `createdAt` for ordering.

### Tenant isolation

`models.by_cuid`, `assets.by_modelId` and `bulkAssets.by_modelId` are **global** indexes, and
`requireOrgRead` validates the *caller's* org, not the *row's*. Every row they return must be
checked against `organizationId` — otherwise a user authorised for their own org can pass another
org's `modelId` and read back its name, replacement cost and unit count.

---

## How it composes

Allocation is a **recursive walk of the line-item tree**, not a two-layer special case. Groups can
contain kits; kits contain children; children can carry accessories. Handling that as "group layer
then kit layer" breaks the moment a third level exists.

```
for each group:
    pool = group.price × group.quantity
    distribute(pool) across the group's top-level gear lines

for each ungrouped top-level line:
    pool = line.lineTotal
    distribute(pool)

distribute(pool) into node:
    participants = node's non-cancelled children
                 + node itself, if node.modelId != null
    if no children:      node.allocatedRevenue = pool          (DIRECT)
    else:                split pool by weightOf() in cents     (largest remainder)
                         recurse into each child with its slice
```

A **priced** group's flat price is the whole total for everything inside it, custom items included.
So a priced custom item takes its own `lineTotal` straight **off the pool** (owned gear splits the
remainder) and is tagged `EXCLUDED_NON_GEAR` — the number is stored for audit but never counts
toward model ROI, exactly like a sub-hire. It is **not** added on top of the project total. A
$1,800 custom item in a $2,000 group leaves $200 for the gear. When a group has custom items but no
gear, the customs absorb the whole pool, so `SUM(children) == pool` still holds.

An **unpriced** group (used purely as an organiser) has no flat price to be part of, so its custom
items bill on their own — otherwise they'd vanish from the invoice — and `recalcProjectTotals` adds
their `lineTotal` on top for that case only.

---

## What gets excluded

| Line kind | Detected by | Pool weight | `allocatedRevenue` | Counted in ROI |
|---|---|---|---|---|
| Custom in a **priced** group | `isCustomItem` | **its own `lineTotal`** | stored | no |
| Custom elsewhere / labour | `isCustomItem` | none | `null` | no |
| Container | `isContainerLineItem` | none | `null` | no |
| Sub-hire | `subHireId != null` | **yes** | stored | **no** |
| Cancelled / optional | `status`, `isOptional` | none | `0` | no |
| Owned gear | `modelId != null` | yes | stored | **yes** |

---

## Edge cases

| Case | Handling |
|---|---|
| Group/kit has no price ($0 or null) | Pool is 0. All descendants get `0 / NO_REVENUE`. Can't split nothing. |
| No participant has a rate, cost, or total | Rule 5: equal split. Nothing is ever invisible. |
| Kit allocation doesn't cover current contents | Ignore it, fall through the weight chain, flag the kit "allocation out of date". Never block the booking. |
| Kit allocation sums to 99.99% | Normalised over its own sum before distribution; the pool is still fully allocated. |
| Model's rental price changes after a booking | Old projects keep their numbers — nothing recomputes them. |
| Qty / contents change | Whole-project recompute on the next mutation. Automatic. |
| `replacementCost` unset on a model | Model appears in revenue reports; ROI column shows "—". |
| Model owned in 0 units (all sold) | Revenue retained and shown; ROI "—" (no capital deployed). |
| Rounding | Integer cents, largest remainder. `SUM(children) == pool` exactly. |

---

## Reporting surface

The old Reports and Utilisation tabs were deleted (commits `5f55ea28`, `5c135c10`), so this builds
on a clean slate rather than into a report builder.

1. **Kit detail → Revenue allocation panel.** Per-model rows, quantity, suggested %, editable %,
   running total, auto-balance, "reset to cost-weighted". Out-of-date banner.
2. **Model detail → ROI tab.** Total allocated revenue, fleet cost, payback bar, revenue per unit,
   and a table of the projects that produced it.
3. **`/assets/roi` → Fleet ROI.** The payoff surface: every model ranked by payback, filterable by
   status set and date window, sortable by revenue / ROI / revenue-per-unit. Answers "what should we
   buy more of, and what should we sell?"

### Query cost, stated honestly

Summing `allocatedRevenue` across every line item of every project does not fit in a Convex query's
read budget for a large org. A per-project rollup (`ProjectModelRevenue`, one row per model per
project, rebuilt inside the same recompute pass) reduces the fleet query from *all line items* to
*distinct models per project* — roughly a 10× reduction.

That is enough for the current scale and not enough forever. The fleet query reads counted projects
in the window, then their rollup rows, and **surfaces a visible truncation warning** if it hits its
cap rather than silently reporting a low number. The next step, when it is needed, is a scheduled
org-level aggregate — not a bigger cap.

Two things a cap has to get right, and both are easy to get wrong:

- **Scan newest-first.** `.take(n)` returns an index *prefix*. Scanning an org's projects in
  insertion order hands a large org only its oldest ones, so the default trailing-12-months view
  reports nearly nothing — and narrowing the window, which the truncation banner tells you to do,
  cannot help, because the recent projects were never read.
- **Budget the rows, not the parents.** Capping the *project* count doesn't cap documents read: a
  project carries an unbounded number of models. Cap the rollup rows themselves, or the query blows
  Convex's ~16k read limit and *throws* — and a report that throws is strictly worse than one that
  admits it is partial.

---

## Summary

| Aspect | Kits | Groups |
|---|---|---|
| Template | Persistent, per-model allocation table | Ephemeral, per-project |
| Allocation | Manual % (auto-suggested from cost) | Auto: weight chain |
| Stored on | `KitRevenueAllocation.allocationPercent` | nothing — derived at recompute |
| User effort | One-time setup per kit | Zero |
| Fallback | Weight chain, if allocation is stale | — |
| Snapshot | Recomputed per project mutation; never at read time | Same |

Both write `allocatedRevenue` + `allocationBasis` on leaf line items. ROI reporting is then:

```
SUM(allocatedRevenue) GROUP BY modelId
  WHERE allocationBasis IN (DIRECT, KIT_PERCENT, WEIGHTED, EQUAL_SPLIT)
    AND project.status IN (COMPLETED, INVOICED)
  ÷ (model.replacementCost × unitsOwned)
```
