# Overbookings & Gaps Board (WS3 #942)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-27 (review quarterly — POLICY.md R-5.5)_

## What this is

An org-wide, date-ranged risk board (`/overbookings`) that answers "what gear
and crew problems exist across every project right now, not just the one I'm
looking at?" — the per-project overbooking engine (FEATUREDOCS/11) only ever
answers that question for one project's own window; this board rolls it up
org-wide. Six sections, over a user-selected date range (default 30 days):

> **Three questions, three surfaces (#1061).** This board asks "what's broken
> ANYWHERE in the next 30 days". `overbookingBoard.confirmImpact` asks "what
> WOULD break if I confirmed this project" (it simulates the project as
> `CONFIRMED`). `projectReadiness.forProject` (FEATUREDOCS/69) asks "is THIS
> project, as it stands right now, ready?" — real status, not simulated, and
> rows rather than counts so each failing check can carry its own fix. All
> three read the same aggregation core in `convex/lib/overbookingBoard.ts`, and
> the confirm gate and the readiness checklist share one `ownGearModelIds`
> definition, so they can't disagree about which shortages belong to a project.
> A per-project gear shortage is surfaced on that project's Overview tab and
> links here, because a shortage is only ever RESOLVED org-wide (sub-hire, swap,
> or move the dates).

1. **Overbooked gear (hard)** — a model whose HARD demand (see the two-layer
   split, FEATUREDOCS/11) across every project overlapping the range exceeds
   its effective stock. A real, already-committed problem. Red.
2. **Pencilled collisions** — the ADDITIONAL shortage that would exist if
   every currently-pencilled booking for that model (an optional line, or any
   line on a not-yet-confirmed project) also went hard. A heads-up, not a
   violation of today's rule — "would collide if confirmed." Amber.
3. **Sale stock to procure** (WS11 #950) — models whose `Model.saleStockQuantity`
   (a single per-model sale-stock pool, independent of rental assets/bulk) has
   gone negative — sold below what was ever added as stock. Each row lists the
   contributing NEW_STOCK sale lines (project + qty) that drew the pool down.
   Supersedes the original pre-WS11 stub (a negative `bulkAssets.saleStockQuantity`
   on any bulk row), which nothing ever wrote — see FEATUREDOCS/67.
4. **Services missing crew** — a `projectService` in range whose FILLED crew
   count (excluding `DECLINED`/`CANCELLED` assignments) is below
   `crewCountRequired`. `crewCountRequired` of `null`/`0` is explicitly
   skipped, never flagged.
5. **Unconfirmed crew** — an assignment that isn't `CONFIRMED` (and isn't
   already settled-no via `DECLINED`/`CANCELLED`) on a project whose window
   STARTS within the range.
6. **Crew double-bookings** — an org-wide rollup of
   `crewAvailability.ts`'s existing per-member severity model: `hard` = an
   `UNAVAILABLE` availability block overlapping an assignment; `soft` = two
   overlapping assignments (different projects) for the same member.

## Architecture

```
convex/lib/overbookingBoard.ts        — pure aggregation (no ctx.db), unit-tested
convex/lib/overbookingConfirmImpact.ts — confirm-time-gate math, reuses the above
convex/lib/crewConflicts.ts           — shared hard/soft severity model
                                         (extracted from crewAvailability.ts)
convex/overbookingBoard.ts            — the query layer: bounded reads + calls
                                         into the pure lib above
src/hooks/use-native-overbooking-board.ts — reactive board subscription
src/hooks/use-confirm-status-gate.ts      — one-shot confirm-impact preview
src/app/(app)/overbookings/page.tsx       — the route
src/components/overbookings/sub-hire-shortfall-dialog.tsx
src/components/projects/confirm-status-impact-dialog.tsx
```

Everything Convex-side that touches `ctx.db` lives in `overbookingBoard.ts`
(the query); everything else is a pure function over plain JS objects, so the
whole aggregation is unit-testable without a Convex test harness (though
`overbookingBoard.test.ts` also has a full `convex-test` integration suite
against the real schema/indexes).

## Read shape — bounded, not org-wide-unbounded (R-9.8)

Mirrors `convex/overbooking.ts`'s scoped-scan idiom (FEATUREDOCS/11):

- **Candidate projects**: TWO range-scans unioned — `by_organizationId_rentalStartDate`
  (unbounded below, catches every `projectStartDate`-unset row since
  `undefined` sorts first) UNION `by_organizationId_projectStartDate`
  (`MIN_TS`-bounded, backfilled rows only) — refined by the pure
  `getProjectWindow` overlap check.
- **Line items / models / assets / bulk-assets**: referenced-only, bounded to
  candidate projects and the models they reference (not a whole-org scan).
- **Sale stock**: ONE org-scoped `bulkAssets` collect — `saleStockQuantity`
  has no index to range-scan on (registered as an R-8.3.3 exception in
  `docs/exceptions.md`, same class as the existing `bulkAssets.ts` entries —
  bounded by distinct-SKU count, not unit quantity).
- **Services / crew assignments**: bounded on BOTH ends by the two new
  indexes this workstream added — `projectServices.by_organizationId_date`
  and `crewAssignments.by_organizationId_startDate`. Neither existed before
  (only project/member-scoped equivalents did); an org-wide date-ranged scan
  of either table wasn't possible without them.

`overbookingBoard.counts` is a second, cheap query — same reads as `bundle`,
different (much smaller) return shape — backing the three dashboard chips so
they don't subscribe to the full board's row-level payload just to show three
numbers.

## Confirm-time gate (non-blocking)

Advancing a project's status to `CONFIRMED` (`updateStatusNative`, untouched)
previews impact FIRST via `overbookingBoard.confirmImpact` (a one-shot query,
not a subscription): "if this project's own demand became hard right now, how
many models would exceed capacity, and how many of its crew assignments
aren't confirmed yet?" `computeConfirmImpactModels` answers the first question
by reusing `computeGearShortageBoard` unchanged — the caller simulates the
project's own status as `CONFIRMED` in the input array (nothing is actually
written) and checks whether any model its own non-optional lines touch would
go hard-overbooked.

If the preview finds nothing, the status change proceeds immediately with no
UI change from before this workstream. If it finds a hard-overbooking or
unconfirmed-crew risk, `ConfirmStatusImpactDialog` shows a warn+confirm
prompt — "Confirm anyway" runs the IDENTICAL mutation the user already
requested. There is no code path where this dialog blocks a confirm, and the
preview fails OPEN (proceeds) if the query itself errors — it's advisory
only, never a gate on the real write.

## Known limitations / deferred

- **Whole-range sums, not day-sliced.** Gear shortages sum ALL demand across
  every project overlapping the selected range and compare against total
  stock — the same simplification the per-project engine already makes (it
  doesn't check whether two non-overlapping sub-windows within the range
  could reuse the same units). A shortage here means "somewhere in this
  range, demand exceeds stock," not a per-day guarantee.
- **Crew member names aren't resolved** in the "unconfirmed crew" / "crew
  double-bookings" board rows — they show `crewMemberId` and the project(s)
  involved, not a display name. A follow-up can join `crewMembers` for
  display; the aggregation itself doesn't need it.
- **Sale stock section is inert until WS11 lands** — `saleStockQuantity` has
  no writer yet anywhere in the app.

## Missing-crew predicate fix (bug found while building this)

`services-panel.tsx`'s crew avatar stack / "N needed — none assigned" /
"(x/y)" shortfall badge used to read raw `crewAssignments.length`, so a
`DECLINED` (or `CANCELLED`) assignment counted identically to a `CONFIRMED`
one. Fixed via `isFilledAssignmentStatus()` (`src/lib/crew-assignment-status.ts`),
which the board's "services missing crew" section also uses (as
`EXCLUDED_ASSIGNMENT_STATUSES` in `convex/lib/crewConflicts.ts` — same two
literals, Convex-local copy since it can't import `src/lib`).
