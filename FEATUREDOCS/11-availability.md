# Availability & Overbooking Engine

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-27 (review quarterly — POLICY.md R-5.5)_

## The Two-Window Date Model (WS2 #941)

Locked decision: a project carries exactly two windows, both optional and both
nullable-per-side:

- **Rental** (`rentalStartDate`/`rentalEndDate`) — the chargeable window.
  **Pricing reads this directly** and is untouched by WS2 (a separate
  workstream, #943).
- **Project** (`projectStartDate`/`projectStartTime`/`projectEndDate`/
  `projectEndTime`) — the gear-committed window (when equipment actually
  leaves/returns the warehouse — the old load-in/load-out role). **Blank by
  default** on most projects; when unset it falls back to the rental window.

**`getProjectWindow(p) → {start, end}`** (`src/lib/project-window.ts` +
byte-for-byte duplicate `convex/lib/projectWindow.ts`, pinned by a cross-import
parity test) is the ONE authoritative resolver: `projectStartDate ??
rentalStartDate`, `projectEndDate ?? rentalEndDate` — each side independently.
**Availability and conflict detection read this window, never the rental
window directly.** The old `loadInDate`/`loadOutDate`/`eventStartDate`/
`eventEndDate` fields are **deprecated** (kept, unwritten, for one rollout
cycle — narrowing is a follow-up once every consumer + the backfill are
confirmed complete). A one-time paginated backfill
(`convex/backfillProjectWindow.ts`, driver
`scripts/convex-backfill-project-window.ts`) copies `projectStartDate ⇐
loadInDate` / `projectEndDate ⇐ loadOutDate` (times carried) for existing
projects; `eventStartDate`/`eventEndDate` are dropped, not migrated — there is
no field for them in the two-window model, so a project whose only date was an
event date resolves via the rental fallback like any other undated project.

### The six parity-pinned overlap sites (all flipped together, #941)
The "does project A's window overlap project B's window" comparison is
duplicated in exactly six places (Convex can't import `src/lib/*`, so pure
math is byte-copied into `convex/lib/`) — all six now call `getProjectWindow`
on the CANDIDATE/other-project side instead of reading `rentalStartDate`/
`rentalEndDate` directly:

1. `src/lib/overbooking-core.ts` `projectMatchesWindow` (org-wide overbooking)
2. `convex/lib/availabilityBookings.ts` `projectMatchesWindow` (model/kit/asset
   booking reads) — its sibling `projectMatchesCalendarWindow` is **UNCHANGED
   by design**: the calendar keeps drawing rental (pricing) bars, see below.
3. `convex/lib/availabilityCore.ts` — `computeModelAvailability`'s candidate
   filter + `findAssetConflict` + `findKitConflict`
4. `convex/lib/reservationConflicts.ts` `overlappingProjectIds`
5. `convex/projectLineItems.ts` `swapLineItemAsset`'s double-booking guard
6. `src/server/line-items.ts` `checkAvailability`

The QUERY window each site is fed (i.e. what represents "this project's own
dates" for the comparison) is left as `rentalStartDate`/`rentalEndDate` at
every call site for this PR — most projects have no divergent project window,
so the common case is unaffected; retargeting the callers' own window source
to `getProjectWindow` too is a scoped follow-up.

`convex/overbooking.ts`'s scoped `bundle` candidate range-scan (see below) is
a SEPARATE, perf-only concern from the six sites above — it decides which
projects' line items even get FETCHED into the bundle before the six sites'
math runs on them, and had to be re-keyed too (see the dedicated subsection).

## How It Works (`src/lib/availability.ts`)
1. For each line item's model, query all other projects with an overlapping PROJECT window (`getProjectWindow`)
2. Exclude finished statuses: `CANCELLED, RETURNED, COMPLETED, INVOICED`
3. Exclude templates: `isTemplate: false`
4. Calculate `effectiveStock = totalStock - unavailableAssets` (IN_MAINTENANCE, LOST, RETIRED,
   and — WS11 #950 — SOLD: a unit disposed of via a `FROM_RENTAL_STOCK` sale is terminal
   stock, same treatment as RETIRED/LOST, in `computeStockBreakdown`)
5. Calculate `totalBooked` across all overlapping projects
6. `isOverbooked = totalBooked > effectiveStock`
7. `isReducedStock = unavailableAssets > 0 && totalBooked > effectiveStock - unavailableAssets`

### `overbooking.bundle` read scoping (perf, 2026-07)
`convex/overbooking.ts` `bundle` reads the org's line items/assets/bulk-assets/projects/models
for a set of model ids in one backend-local round trip. It takes optional `thisProjectId` /
`rentalStartDate` / `rentalEndDate`: when supplied, the line-item read is scoped to projects
whose window overlaps that range instead of an unbounded all-time `by_modelId` scan across
every project that has ever booked the model. All three callers
(`src/lib/availability.ts`, `use-native-project-equipment.ts`, `use-native-equipment-tab.ts`)
pass these args. The args are optional so a caller on a stale app build still gets a correct
(just unscoped) result — don't remove that fallback without confirming the rollout is complete.
See docs/designs/perf-convex-efficiency-2026-06.md Finding #0 for the measured impact
(this query was 77% of the org's monthly Convex Database I/O before scoping) and
`convex/overbooking.test.ts` for the scoped/unscoped parity test.

**WS2 (#941) re-key:** the candidate scan is now TWO range-scans, unioned:
1. `projects.by_organizationId_rentalStartDate` (unchanged from the perf fix
   above) — its unbounded-below range also sweeps in every row whose
   `projectStartDate` is undefined (undefined sorts before all numbers in a
   Convex index — the `dashboardStats.ts` `MIN_TS` idiom), which covers every
   project whose window falls back to rental.
2. `projects.by_organizationId_projectStartDate` (new index), `MIN_TS`-bounded
   below so it only visits **backfilled** rows — without that bound it would
   sweep in the same undefined-`projectStartDate` majority as scan 1 and
   degrade back into an org-wide read, defeating the whole scoping fix. This
   is the "rental-index fallback while `projectStartDate` is unbackfilled" the
   design calls for: it exists specifically to catch a project whose PROJECT
   window overlaps the query range even though its RENTAL window doesn't
   (e.g. an early load-in scheduled well before the confirmed rental dates) —
   scan 1 alone would silently miss it, so its line items would never even
   reach `bundle.lineItems` for the six sites' math to filter correctly.

Both scans' candidates run through the SAME `getProjectWindow`-based JS overlap
check before being added to the fetch set.

## Two-Layer Hard/Pencilled Availability (WS3 #942)

Locked decision: every booking is classified into exactly one of two layers —
**pencilled** = an `isOptional` line, OR any line on a not-yet-confirmed
project (`ENQUIRY`/`QUOTING`/`QUOTED`); **hard** = everything else (a
non-optional line on `CONFIRMED..ON_SITE`). Pencilled always **warns, never
blocks** — it never disables a write, it only surfaces as a heads-up.

- `PENCILLED_PROJECT_STATUSES` / `HARD_PROJECT_STATUSES` / `isConfirmedOrLater()`
  — `src/lib/overbooking-core.ts`, duplicated byte-for-byte in
  `convex/lib/availabilityCore.ts` (Convex can't import `src/lib`), pinned by
  a cross-import equality test in `convex/availabilityCore.test.ts` — same
  pattern as `getProjectWindow`.
- `OverbookLineItem` gained `isOptional?: boolean` (defaults `false` — no
  behaviour change for a caller that doesn't pass it). `OverbookedInfo` gained
  `hardOverBy` (== `overBy`, an explicit alias — existing badges/PDFs/pull-sheets
  are UNCHANGED for the common case) and `pencilledOverBy` (the additional
  overage if every currently-pencilled booking for that model also went hard).
  `reconstructOverbookedStatus`'s hard-overbooked gate runs on hard-only sums —
  an optional line, or a still-quoted project's own demand, drops out of the
  hard sum entirely (existing per-project badges only lose a flag when the
  overage was purely pencilled — "that's the rule working," not a regression).
- **The Overbookings & Gaps board** (`convex/overbookingBoard.ts` +
  `convex/lib/overbookingBoard.ts`) is the org-wide, date-ranged rollup of this
  same two-layer split — a SEPARATE aggregation from the per-project engine
  above (different math shape: whole-range sums across every candidate
  project, not one project's own window), reusing the same
  `isConfirmedOrLater`/`isOptional` vocabulary. Full architecture, the six
  board sections, and the confirm-time gate: see
  [FEATUREDOCS/65](./65-overbookings-gaps-board.md).

## Dateless Stock Checks
When a project has **no rental dates**, availability is still calculated:
- `computeOverbookedStatus` compares this project's line item quantities against total stock (no cross-project overlap)
- `checkAvailability` returns stock info with `dateless: true` flag — UI shows "in stock" instead of "available"
- `addLineItem` validates quantity against stock even without dates
- This catches cases like "2× SM58 on a job but only 1 exists" regardless of dates

## `computeOverbookedStatus(organizationId, lineItems, startDate, endDate, projectId)`
- Batches all queries for efficiency (single pass over all line items)
- Returns `Map<lineItemId, { overBy, totalStock, effectiveStock, totalBooked, reducedOnly, inherited }>`
- Kit parents inherit overbooking from children (`hasOverbookedChildren`, `hasReducedChildren`)
## UI Indicators
- **Red badge**: "OVERBOOKED" — shown on project list (AlertTriangle), project detail, all 5 PDFs
- **Purple badge**: "REDUCED STOCK" — shown when overbooking is caused only by unavailable assets
- Overbooking allowed with explicit checkbox confirmation in add/edit dialogs

## Invariants (don't break these)

1. **`effectiveStock` is the only enforcement baseline.** Both client and server availability checks compare `quantity` against `effectiveStock - booked`, never raw `totalStock`. In-maintenance / lost / retired assets must not be counted as bookable. The pure math (`resolveModelAssetType`, `computeStockBreakdown`) actually lives in `src/lib/overbooking-core.ts` and is re-exported from `src/lib/availability.ts` for back-compat — `checkAvailability` (`src/server/line-items.ts`) and `computeOverbookedStatus` (`src/lib/availability.ts`) import it from there. The browser-direct line-item mutations (`addNative`/`patchNative` in `convex/lineItemWrites.ts`, replacing the old `addLineItem`/`updateLineItem` server actions) can't resolve the `@/` alias, so `convex/lib/availabilityCore.ts` carries a byte-for-byte copy of the same two functions, pinned against the originals by a cross-import equality test in `convex/availabilityCore.test.ts` — treat the two as one source of truth, but know they're physically two files.

2. **Edit-dialog "available" formula.** The edit dialog in `equipment-tab.tsx` computes the pool the user can edit into as:
   ```
   editAvailableForEdit = availability.available + editingItem.quantity
   ```
   This adds back the item's own quantity (since `availability.available` already subtracts all overlapping bookings, including this one). It matches both the add dialog and the overbook badge semantics.

3. **Cache invalidation is now a no-op.** Line items, availability and overbooking are all native Convex queries — the `projectDetail` subscription pushes every change live over the WebSocket, so there's no query-key cache to invalidate. The `invalidate()` helper in `equipment-tab.tsx` still exists (called after every tab mutation) but now just calls `refreshProjectDetail(projectId)` (`src/hooks/use-project-detail.ts`), which is documented as a deliberate no-op kept only so call sites didn't need touching. The old React Query `["availability"]` / `["project-overbooked", projectId]` invalidation this section used to describe no longer exists.
