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

1. **`effectiveStock` is the only enforcement baseline.** Both client and server availability checks compare `quantity` against `effectiveStock - booked`, never raw `totalStock`. In-maintenance / lost / retired assets must not be counted as bookable. The single source of truth is `computeStockBreakdown` in `src/lib/availability.ts` — `checkAvailability`, `computeOverbookedStatus`, `addLineItem`, and `updateLineItem` all go through it.

2. **Edit-dialog "available" formula.** The edit dialog in `equipment-tab.tsx` computes the pool the user can edit into as:
   ```
   editAvailableForEdit = availability.available + editingItem.quantity
   ```
   This adds back the item's own quantity (since `availability.available` already subtracts all overlapping bookings, including this one). It matches both the add dialog and the overbook badge semantics.

3. **Cache invalidation.** Any mutation that changes line item quantity or presence (add, update, remove, move) MUST invalidate `["availability"]` in addition to `["project-overbooked", projectId]`. The `invalidate()` helper in `equipment-tab.tsx` does this once for every tab mutation; the add dialog does it in its own `onSuccess`. Without this, subsequent add/edit dialogs read stale booked counts and over-permit or over-block wrongly.
