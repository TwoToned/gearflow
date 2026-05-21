# 42. Asset Utilization

## Overview

`/utilization` answers "is this gear paying for itself?" Per asset it shows booking rate, revenue, maintenance cost, damage cost, and net contribution. A period selector and an idle/lossy filter surface dead stock.

## Architecture

```
/utilization page
  → getAssetUtilization (src/server/utilization.ts, "use server")
  → computeAssetUtilization (src/lib/utilization.ts, pure)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/utilization.ts` | Pure computation — revenue, booking-days, costs, net contribution |
| `src/server/utilization.ts` | `"use server"` wrapper, resolves org via session |
| `src/app/(app)/utilization/page.tsx` | Dashboard UI, period selector, idle/lossy filter |

## Computation Model

**Revenue (pragmatic v1):** only counts line items where `assetId` is set (a specific asset was assigned). Model-only line items pre-checkout don't attribute revenue — they will once an asset is assigned at checkout. This avoids fabricating allocations the operator can't verify.

**Booking-days:** sum of `(rentalEnd − rentalStart + 1)` for every non-CANCELLED line item with `assetId = X`, clamped to the requested period bounds.

**Costs:**
- `maintenanceCost` — sum of `MaintenanceRecord.cost` via `MaintenanceRecordAsset`, scoped to the period.
- `damageCost` — sum of `actualCost ?? estimatedCost` per `DamageEvent` for the asset, minus charged-back damage (the client paid for that).

**Net contribution** = `revenue − maintenanceCost − ourDamageCost`.

## Period

Defaults to "since the asset was created". The UI offers 30 / 90 / 365 days / all time. `periodDays` is the denominator for the utilization-rate percentage (booking-days ÷ period-days).

## Filters

- **Idle** — assets with low or zero booking rate (dead stock).
- **Lossy** — assets with negative net contribution (costing more than they earn).
