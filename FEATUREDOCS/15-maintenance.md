# Maintenance System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

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
Overdue maintenance generates notifications. Shows first asset name + count for multi-asset records. Schedule-generated PM cycles (below) flow into the same `overdue_maintenance` bell type automatically via their `scheduledDate` — no separate notification type was added in v1 (org digest deferred).

## Deletion
Deleting a maintenance record releases any held assets and removes the record atomically (single transaction).

## Incident-report records

Records created via the "Report Issue" flow or an immediate check-item FAIL
(FEATUREDOCS/64) are ordinary `MaintenanceRecord`s (`type: REPAIR`) with
`incidentType`/`incidentSeverity` additionally set — not a parallel model. The
Maintenance tab on the asset detail page shows a "Reported issue" badge for these.

## Recurring Preventative Maintenance (WS6 #945)
Fixed-calendar recurring PM: a model-wide `serviceSchedules` row (interval in
months + an anchor date) drives cycle generation — **the whole pool comes due
together on a fixed schedule; late completion does NOT shift the next due
date** (`convex/lib/serviceScheduleCore.ts` computes each cycle's due date as
`anchor + k*intervalMonths` from the ORIGINAL anchor every time, so a Jan-31
anchor doesn't drift to Feb-28 → Mar-28 instead of Mar-31). A model can carry
multiple schedules (e.g. a 90-day clean + an annual service).

**Non-blocking is a hard invariant** — PM due-ness never subtracts from
availability. A generated cycle is a normal `maintenanceRecords` row at
`type: PREVENTATIVE`, `status: SCHEDULED` — the ONE status the existing
hold/release state machine (`maintenanceWrites.ts`'s `HOLDING_STATUSES`)
already treats as non-holding, so nothing new had to be taught not to touch
`asset.status`. A user who manually opens a generated record through the
ordinary maintenance form and advances it to `IN_PROGRESS`/`AWAITING_PARTS`/`QA`
**is allowed to hold assets** — that's a real workshop event, not a violation
(the check-off mutations below never do this themselves).

**Data model additions** (`convex/schema.ts`):
- `serviceSchedules` — `modelId`, `name`, `intervalMonths`, `anchorDate`, `instructions`, `isActive`.
- `maintenanceRecords.serviceScheduleId` / `.poolQuantitySnapshot` — link a
  generated cycle to its schedule and freeze the pool denominator (unit count
  for SERIALIZED, summed active `totalQuantity` for BULK) **at generation
  time**, so "18 of 120" stays stable even if the fleet is resized mid-cycle.
- `maintenanceRecordAssets` is now **polymorphic** (checkRecords-style): a
  `kind` discriminator (`"LINK"` default/absent, or `"CHECKOFF"`) separates the
  pre-existing hold/release asset-link rows from the new recurring-PM
  check-off progress rows sharing the same table. `convex/lib/
  maintenanceRecordAssetKind.ts`'s `isLinkRow`/`isCheckoffRow`/
  `computeCheckoffProgress` are the one place both meanings are interpreted —
  every existing reader of this table (`maintenanceWrites.ts`,
  `maintenanceRecords.ts`) was updated to filter to `LINK` rows so a CHECKOFF
  row never masquerades as a hold/release link (or gets deleted by the
  ordinary asset-link diff).
- `models.maintenanceIntervalDays` is **DEPRECATED** (see its schema.ts
  comment) — the one-time migrate backfill (`backfillMaintenanceSchedules.ts`
  + its script driver) seeds one schedule per model that had it (days -> nearest
  month). Removed from `modelSchema`/the model form; deliberately still wired
  in `convex/models.ts`/`modelWrites.ts` because CSV bulk import/export
  (`src/server/csv.ts`) still reads/writes the column directly — migrating
  that surface is a separate follow-up.

**Generation** (`convex/maintenanceScheduleGeneration.ts`, `internal.
maintenanceScheduleGeneration.generateDueCycles`): a dedicated **daily cron ->
native Convex `internalMutation`**, registered in `convex/crons.ts` at 22:00
UTC. Unlike the two crons in `FEATUREDOCS/14-test-and-tag.md`'s pattern (which
POST an executor route because they need Postgres/Better-Auth recipients),
this one is deliberately NOT the HTTP-hop pattern — it only ever touches
Convex tables (`serviceSchedules`/`models`/`assets`/`bulkAssets`/
`maintenanceRecords`), so there's no Postgres dependency to route through the
Next.js route for. Still **dormant until `ENABLE_CONVEX_CRONS=true`** on the
Convex deployment, matching the rest of this file's off-by-default discipline.

**Per-org fairness (#1077, A7):** the platform-wide `serviceSchedules` scan is
bounded by `collectCapped` (R-9.8) then post-filtered by
`applyPerOrgFairnessCap` (`convex/lib/cronFairness.ts`) so one high-volume org
can't consume the whole scan budget and starve every other org's schedules out
of every run — see FEATUREDOCS/04's "Tenancy hygiene" section.

**Single open cycle per schedule (merge semantics, no stacking):** each run,
per active schedule, resolves the current due date and either (a) no-ops if
the schedule's one open (non-terminal) cycle already has that due date
(idempotent double-run), (b) **merges forward** — patches that SAME open
cycle's `scheduledDate` to the new due date, leaving `poolQuantitySnapshot`
and any already-recorded progress untouched — if the org fell behind and the
due date advanced while the previous cycle was still incomplete, or (c)
creates a fresh cycle (with a freshly computed pool snapshot) once the
previous cycle is `COMPLETED`.

**Check-off** (`convex/maintenanceCheckoffWrites.ts`, gated on
`maintenance:update`): `checkOffUnit` for serialised units (one asset at a
time, idempotent); `checkOffBulkSession` for bulk pools (a quantity per
session, plus a server-computed "check all remaining" against the frozen
snapshot so a stale client-side remaining count can never over-check). Both
auto-flip the cycle to `COMPLETED`/`PASS` once the full pool is checked off —
and **only ever patch the `maintenanceRecords` row itself**, never
`asset.status`/`bulkAsset.availableQuantity`. A fault found during check-off
is **not** handled here — the operator raises a separate `REPAIR` record via
the ordinary maintenance form (real, correct blocking machinery).

**Worklist** — `/maintenance/due` (`src/app/(app)/maintenance/due/page.tsx`,
T&T-dashboard shape per `test-and-tag/page.tsx`): stat tiles (overdue / due
soon / in progress) computed from `convex/maintenanceScheduleWorklist.ts`'s
`dueWorklist` query, then one section per schedule's current open cycle — a
per-unit checkbox grid for serialised models, or a progress bar + quantity
input + "check all remaining" for bulk. Enriches only the org's open cycles,
never the whole fleet. A "Schedules" table below manages
create/edit/deactivate (`ServiceScheduleDialog`, `src/hooks/
use-service-schedules.ts`) — deactivating is a soft-delete (`isActive: false`,
stops future generation) that never touches already-generated records.

**Permissions:** check-off gates on `maintenance:update`; the `warehouse` role
was granted `update` on `maintenance` (`convex/lib/permissionsCore.ts`) so
floor staff can tick off services without also gaining create/delete on
maintenance records.

**Dashboard:** schedule-generated cycles are **excluded** from the existing
`maintenanceDue` stat/chip (`serviceScheduleId` set = excluded) to prevent
double-counting — see `FEATUREDOCS/17-notifications.md`'s chip note.

## Related
- **[FEATUREDOCS/64 — Incident Reporting](./64-incident-reporting.md)** — the
  in-app successor to the deleted Discord `/fault` command, reusing this model.
- Workshop Kanban (formerly `FEATUREDOCS/41-workshop-kanban.md`) and Damage Capture
  (formerly `FEATUREDOCS/40-damage-capture.md`) were both removed as features; their
  docs were deleted along with the code (`chore: remove Workshop kanban tab`,
  `chore: remove Damage Capture feature`). No replacement docs exist — Damage
  Capture's role is now covered by FEATUREDOCS/64's "Report Issue" flow.
