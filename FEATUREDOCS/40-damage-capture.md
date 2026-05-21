# 40. Damage Capture

## Overview

Report damage on a returning item straight from the warehouse return flow. Camera-first capture: severity, notes, photos, and an optional charge-back to the client. Major and total damage auto-creates a linked workshop ticket and holds the asset.

Browse every damage event at `/damage`.

## Architecture

```
Warehouse return / damage page
  → DamageReportDialog (camera-first capture)
  → createDamageEvent (src/server/damage.ts, "use server")
  → createDamageEventCore (src/lib/damage-core.ts, pure)
  → DamageEvent + optional MaintenanceRecord (REPAIR) in one transaction
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/damage-core.ts` | Pure create/update logic, transaction with linked MaintenanceRecord |
| `src/server/damage.ts` | `"use server"` wrappers — resolve org + actor, delegate to core |
| `src/lib/validations/damage.ts` | Zod schemas for damage event create/update |
| `src/app/(app)/damage/page.tsx` | Damage event browse page |
| `src/components/damage/damage-report-dialog.tsx` | Camera-first capture dialog |

## Schema

`DamageEvent` (pre-existing model) links to `Asset` or `BulkAsset`, optionally to a `Project` and `ProjectLineItem`.

- `severity` — `MINOR`, `MAJOR`, `TOTAL`
- `status` — `OPEN`, `UNDER_REPAIR`, `RESOLVED`, `CHARGED_BACK`
- `photos` — `String[]`, URLs from `/api/uploads`
- `estimatedCost`, `actualCost` — Decimal, nullable
- `chargedBack` — Boolean, whether the client pays for the damage
- `maintenanceRecordId` — set when a repair ticket was auto-created

## Behaviour

- **Severity gate** — `MINOR` damage records the event only. `MAJOR` / `TOTAL` damage auto-creates a linked `MaintenanceRecord` (`type=REPAIR`, `status=SCHEDULED`) and links the asset via `MaintenanceRecordAsset`, which holds the asset (`IN_MAINTENANCE`).
- **Transactional** — the damage event and its repair ticket are created in a single `prisma.$transaction`, so a half-written state can't happen.
- **Charge-back awareness** — `chargedBack` flows into the operational P&L panel: charged-back damage is excluded from "our" damage cost (the client paid for it).
- **Camera-first** — `DamageReportDialog` shoots photos on the rear camera, same `photos` shape as maintenance.

## Integration Points

- **Asset utilization** ([34](./34-reporting-system.md) → see [42](./42-asset-utilization.md)) — `damageCost` subtracts from net contribution.
- **Project P&L** (see [10-projects.md](./10-projects.md)) — damage cost is a project cost line, with charge-back awareness.
- **Workshop kanban** (see [41-workshop-kanban.md](./41-workshop-kanban.md)) — auto-created repair tickets show on the board.
