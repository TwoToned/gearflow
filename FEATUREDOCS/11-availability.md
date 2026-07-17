# Availability & Overbooking Engine

## How It Works (`src/lib/availability.ts`)
1. For each line item's model, query all other projects with overlapping rental dates
2. Exclude finished statuses: `CANCELLED, RETURNED, COMPLETED, INVOICED`
3. Exclude templates: `isTemplate: false`
4. Calculate `effectiveStock = totalStock - unavailableAssets` (IN_MAINTENANCE, LOST, RETIRED)
5. Calculate `totalBooked` across all overlapping projects
6. `isOverbooked = totalBooked > effectiveStock`
7. `isReducedStock = unavailableAssets > 0 && totalBooked > effectiveStock - unavailableAssets`

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
