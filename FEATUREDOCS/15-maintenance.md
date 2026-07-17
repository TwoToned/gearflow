# Maintenance System

## Multi-Asset Records
One `MaintenanceRecord` links to multiple assets via `MaintenanceRecordAsset` join table. The form adds assets via a `ComboboxPicker` builder that appends each pick as a removable chip (see Maintenance Form below).

## Types & Statuses
- Types: `REPAIR, PREVENTATIVE, TEST_AND_TAG, INSPECTION, CLEANING, FIRMWARE_UPDATE`
- Statuses: `SCHEDULED, AWAITING_PARTS, IN_PROGRESS, QA, COMPLETED, CANCELLED`
- Results: `PASS, FAIL, CONDITIONAL`

`AWAITING_PARTS` and `QA` were added for the workshop kanban board, which has since been removed (`chore: remove Workshop kanban tab`) — the two statuses were kept dormant on the enum (no migration to drop them) and are still offered in the maintenance form. All three "in-the-shop" statuses (`AWAITING_PARTS`, `IN_PROGRESS`, `QA`) hold the asset in `IN_MAINTENANCE`.

## Maintenance Form (`MaintenanceForm`)
`src/components/maintenance/maintenance-form.tsx` — the create/edit form
(`/maintenance/new` + `/maintenance/[id]/edit`, edit pre-fills, both reuse the
component), on the shared `SmartFormLayout` shell (see
[08-assets § Shared shell](./08-assets.md)). Helper rail + live preview, single
clean page, "More details" accordion.

- **Sections:** Identity (multi-asset `ComboboxPicker` builder — picks append as
  removable chips, the `selectedAssetIds` state + add/remove kept intact; title;
  type / status registry `Select`s with explicit `SelectValue` children covering
  ALL types incl. `TEST_AND_TAG` and ALL statuses incl. `AWAITING_PARTS` / `QA`;
  reported-by `Select` over org members; description) → Schedule (scheduled /
  completed dates) → Outcome (cost, parts used; the **result `Select` + next-due
  date stay gated to `status === COMPLETED`**, original logic preserved) → "More
  details" accordion (relocated `PhotoGridInput`, tags).
- **Live preview** — work-order card (`Wrench` icon + title + a target line
  ("first asset + N more") + status pill via `StatusIndicator
  category="maintenance"` + a type chip).
- **Photo-upload guard preserved** — `photosUploading` disables submit and shows
  the "wait for the photos to finish uploading" hint; the submit label flips to
  "Uploading photos…".
- **Preserved:** same `maintenanceSchema`, `assetIds` merge-on-submit, all fields, and
  permission gates. The native multi-select chips and the COMPLETED-only outcome
  fields were relocated into shell sections, not rewritten. Submit is browser-direct
  via `useMaintenanceWrites()` (`src/hooks/use-maintenance-writes.ts`), calling
  `convex/maintenanceWrites.ts`'s `createNative` / `updateNative` / `deleteNative`
  mutations (the old `createMaintenanceRecord` / `updateMaintenanceRecord` /
  `deleteMaintenanceRecord` actions in `src/server/maintenance.ts` are gone — that
  file no longer exists).

## Photos
`MaintenanceRecord.photos` (`String[]`, default `[]`) holds before/after repair photos — URLs from `/api/uploads` (the `DamageEvent` model this used to share a shape with was removed along with the Damage Capture feature — `chore: remove Damage Capture feature`). The maintenance form uses the reusable `PhotoGridInput` component (`src/components/ui/photo-grid-input.tsx`), now inside the form's "More details" accordion.

## Notifications
Overdue maintenance generates notifications. Shows first asset name + count for multi-asset records.

## Deletion
Deleting a maintenance record releases any held assets and removes the record atomically (single transaction).

## Related
- Workshop Kanban (formerly `FEATUREDOCS/41-workshop-kanban.md`) and Damage Capture
  (formerly `FEATUREDOCS/40-damage-capture.md`) were both removed as features; their
  docs were deleted along with the code (`chore: remove Workshop kanban tab`,
  `chore: remove Damage Capture feature`). No replacement docs exist.
