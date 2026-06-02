# 43. Stocktake / Inventory Verification

## Overview

`/warehouse/stocktake` runs scan-driven inventory counts. Pick a location, scan everything physically present, and the system flags every discrepancy — missing, unexpected, wrong location, quantity mismatch. Resolve each one and inventory updates on completion.

## Architecture

```
/warehouse/stocktake          → list of stocktake sessions
/warehouse/stocktake/new      → create (pick location + scope)
/warehouse/stocktake/[id]     → run / review a session
/warehouse/stocktake/[id]/edit
  → server actions in src/server/stocktake.ts
```

### Key Files

| File | Purpose |
|------|---------|
| `src/server/stocktake.ts` | All stocktake server actions, discrepancy resolution |
| `src/lib/validations/stocktake.ts` | Zod schemas |
| `src/app/(app)/warehouse/stocktake/` | List, new, detail, edit pages |
| `src/components/stocktake/stocktake-form.tsx` | Create-session form |
| `src/components/stocktake/stocktake-scanner.tsx` | Scan-driven counting UI |
| `src/components/stocktake/stocktake-review.tsx` | Discrepancy review + resolution |
| `src/components/stocktake/stocktake-draft.tsx` | Draft-state view |
| `src/components/stocktake/stocktake-completed.tsx` | Completed-session summary |
| `src/components/stocktake/stocktake-table.tsx` | Item table |

## Schema

### Stocktake

A counting session scoped to one `Location`.

- `scope` — `FULL`, `CATEGORY`, `SPOT_CHECK` (`categoryId` set when scope is CATEGORY)
- `status` — `DRAFT → IN_PROGRESS → REVIEWING → COMPLETED` (or `CANCELLED`)
- `startedBy` / `reviewedBy` — `User`, nullable
- Count rollups — `expectedCount`, `foundCount`, `missingCount`, `unexpectedCount`, `discrepancyCount`

### StocktakeItem

One row per expected or scanned asset.

- Links to `Asset` or `BulkAsset` (nullable, `SetNull` on delete)
- `expectedAtLocation`, `expectedQuantity` — what the system thought
- `found`, `foundQuantity`, `scannedAt`, `scannedById` — what the count found
- `result` — `MATCH`, `MISSING`, `UNEXPECTED`, `QUANTITY_MISMATCH`, `WRONG_LOCATION`
- `actionTaken` — resolution recorded during review

## Flow

1. **Create** — pick a location and scope. The session opens in `DRAFT` with an expected-item list snapshotted from current inventory.
2. **Count** — scan everything physically present. Each scan marks an item `found` / sets `foundQuantity`.
3. **Review** — `REVIEWING` status. Every discrepancy is classified; resolve each (mark lost, adjust quantity, update location).
4. **Complete** — `COMPLETED`. Resolutions apply to live inventory.

## Safety

Discrepancy resolution wraps each inventory mutation in a transaction and floors bulk quantities at zero — a counted shortfall can't drive stock negative.
