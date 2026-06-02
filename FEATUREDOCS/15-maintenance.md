# Maintenance System

## Multi-Asset Records
One `MaintenanceRecord` links to multiple assets via `MaintenanceRecordAsset` join table. The form uses barcode scanning (continuous mode) to add assets.

## Types & Statuses
- Types: `REPAIR, PREVENTATIVE, TEST_AND_TAG, INSPECTION, CLEANING, FIRMWARE_UPDATE`
- Statuses: `SCHEDULED, AWAITING_PARTS, IN_PROGRESS, QA, COMPLETED, CANCELLED`
- Results: `PASS, FAIL, CONDITIONAL`

`AWAITING_PARTS` and `QA` were added for the workshop kanban (see [41-workshop-kanban.md](./41-workshop-kanban.md)). All three "in-the-shop" statuses (`AWAITING_PARTS`, `IN_PROGRESS`, `QA`) hold the asset in `IN_MAINTENANCE`.

## Photos
`MaintenanceRecord.photos` (`String[]`, default `[]`) holds before/after repair photos — URLs from `/api/uploads`, same shape as `DamageEvent.photos`. The maintenance form uses the reusable `PhotoGridInput` component (`src/components/ui/photo-grid-input.tsx`). Workshop kanban cards render up to 4 thumbnails.

## Notifications
Overdue maintenance generates notifications. Shows first asset name + count for multi-asset records.

## Deletion
Deleting a maintenance record releases any held assets and removes the record atomically (single transaction).

## Related
- [41. Workshop Kanban](./41-workshop-kanban.md) — kanban board view over the repair queue
- [40. Damage Capture](./40-damage-capture.md) — major/total damage auto-creates a REPAIR record
