# 41. Workshop Kanban

## Overview

`/workshop` shows the repair queue as a kanban board. Cards move through stages; a Completed lane archives finished work. The board is a view over `MaintenanceRecord` — no separate model.

## Architecture

```
/workshop page → maintenance records grouped by status
  → click a card forward / back a stage → updateMaintenanceStatus
  → QA cards get Pass / Fail → pass releases asset, fail keeps it held
```

### Key Files

| File | Purpose |
|------|---------|
| `src/app/(app)/workshop/page.tsx` | Kanban board UI |
| `src/server/maintenance.ts` | Status transition actions |
| `prisma/migrations/20260514210000_extend_maintenance_status_workshop_queue/` | Adds `AWAITING_PARTS` and `QA` enum values |

## Extended State Machine

`MaintenanceStatus` gains two values, positioned in workflow order:

```
SCHEDULED → AWAITING_PARTS → IN_PROGRESS → QA → COMPLETED
                                                 (CANCELLED at any point)
```

The Postgres migration uses `ALTER TYPE ... ADD VALUE IF NOT EXISTS ... BEFORE` so the enum renders in workflow order and the change is zero-downtime.

## Board Columns

- **Scheduled** — repair queued, not started
- **Awaiting Parts** — blocked on a part order
- **In Progress** — actively being worked
- **QA** — repair done, awaiting verification — cards get **Pass** / **Fail** buttons
- **Completed** — separate lane for finished work

## Hold / Release

All three "in-the-shop" statuses (`AWAITING_PARTS`, `IN_PROGRESS`, `QA`) hold the asset in `IN_MAINTENANCE`. The transition that releases the asset:

- **QA → Pass** → record `COMPLETED`, asset released back to `AVAILABLE`.
- **QA → Fail** → record stays in QA (or moves back), asset stays held.

## Integration Points

- **Damage capture** (see [40-damage-capture.md](./40-damage-capture.md)) — major/total damage auto-creates tickets that land in the Scheduled column.
- **Maintenance photos** (see [15-maintenance.md](./15-maintenance.md)) — workshop cards render up to 4 photo thumbnails from `MaintenanceRecord.photos`.
