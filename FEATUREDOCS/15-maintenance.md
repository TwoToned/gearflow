# Maintenance System

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

## The Maintenance list (UX Phase 14, 14a-3, `/maintenance`)
A `ListPage` (`src/components/maintenance/maintenance-list.tsx`, config `src/lib/list-views/maintenance.ts`) over
`maintenanceList.listPage` / `segmentCounts`. The four stat tiles and the overdue banner are replaced by the strip
`Open · Overdue · Scheduled · Done · All` with counts. Open and Overdue are THE definitions in
`convex/lib/maintenanceOpen.ts` (the same ones Home and the More sheet count by); held work (awaiting parts, QA) is
open but not overdue. Columns Asset, Status, Due, Assigned; opt-in Cost, Reported by, Completed, Tags. Filters Type,
Status, Result. Search matches title, description, tags and (within a read budget) linked asset tags and model names.
- **Cost is a job-cost field**: ABSENT from the payload for a caller who fails `canSeeJobCost` (`invoice:read` and not a
  `noFinancials` key), and ordering by it falls back to the default order ascending whatever direction was asked.
- Row menu: Open, Edit, `Reschedule…`, `Assign…`, `Delete…` (confirm, no Undo). Bulk `Reschedule n` and `Assign n`
  (`maintenanceBulkWrites`): open records only (finished or cancelled ones are skipped and named in the toast), one
  field-edit audit row per changed record, and ONE toast Undo (`undoBulkEditNative`, ids only, all or nothing,
  author, 10 minutes, once, refuses if a record changed since). Neither verb touches an asset hold: that follows
  STATUS. Complete/Reopen and the parts table are on the record (below); the row's `Mark done…` (open jobs, `CompleteRecordDialog`, same write and exact Undo as the record page) and `Check off cycle…` (open preventative jobs) are dialogs (14a-3b).
- The page menu holds `Check off cycle…` and `Service schedules…`: dialogs in the URL (`?dialog=checkoff[&record=]` / `?dialog=schedules`) hosted by the list. `/maintenance/due` is only a redirect to `/maintenance?dialog=checkoff` (14a-3b, D44).

## The Maintenance record (UX Phase 14, 14b-3, `/maintenance/[id]`)
`RecordShell` (`src/components/maintenance/record/maintenance-record.tsx`): a `DetailHeader` whose one word is DERIVED
(`src/lib/maintenance-record-facts.ts`: `Awaiting parts`, `18d overdue`, `Completed`; overdue is THE rule in
`convex/lib/maintenanceOpen.ts`, held work is not late), then Overview · Assets · Parts · History · Files. Overview is
`n of m checks clear` (gear linked, a date that is not past, parts in, someone assigned; a parts read that has not
arrived is `not checked`, never a pass) with each failing check's one muted action, then Dates · Job · Cost facts.
`Edit` is still the existing edit page until the sheet slice; `Complete…` (open jobs only) and `Reopen` (completed
only) sit in the ⋯ with `Delete…` red and last (`buildMaintenanceRecordActions`); an unavailable verb is absent.
- **Parts are rows** (`maintenanceParts`: name, supplier, quantity, unit price, ETA, arrived; D76). On order versus
  arrived is derived (`arrivedAt` absent = on order). `maintenancePartsWrites.{add,edit,remove,markArrived}Native`
  each write ONE audit row on the record and have an exact Undo, `undoNative` (ids only: author, 10-minute server
  window, once, only while the part is exactly as the write left it). `markArrivedNative` moves an `Awaiting parts`
  job to `In progress` when the LAST part arrives (both are holding statuses, so no asset changes); its Undo reverses
  both. A job holds at most 200 parts. The old free-text `partsUsed` stays readable under Parts as `Earlier note` and
  is never written by the new UI.
- **Cost is DERIVED, never stored** (`convex/lib/maintenanceCost.ts`): parts (Σ quantity × unit price over the PRICED
  rows; an unpriced part is counted, never $0) plus labour, where `maintenanceRecords.cost` is the LABOUR. `total` is
  `null` when there is neither labour nor a priced part. It is job cost: ABSENT (never zeroed) for a caller who fails
  `canSeeJobCost` on `maintenanceRecords.{list,getById,recordsPage,recordDetail}` and `maintenanceParts.listForRecord`
  (`unitPrice` too), a hidden cost is not a sort key, and a hidden caller can neither set nor clear a part's price, nor
  labour on `createNative` / `updateNative` / `completeNative`.
- **Complete and Reopen** (`maintenanceLifecycleWrites`): `completeNative` writes the outcome (result, date, labour,
  next due) and applies a per-asset disposition. The SERVER defaults each asset from the result (Fail keeps it out of
  service, anything else returns it; the existing still-held-elsewhere rule applies); the dialog sends only the
  overrides. `reopenNative` puts a completed job back In progress and re-holds the assets it released. Both leave one
  audit row with the record's before/after fields AND exactly the assets they moved; `undoNative` takes ids only and
  refuses unless it is the author, inside the window, the first Undo, and the record and every moved asset are exactly
  as the write left them. Retire is terminal, so a Complete that retired an asset reports `undoable: false` (no Undo).
- `convex/lib/maintenanceRecordAccess.ts` is the shared front door of these writes. Its permission check is PASSED IN
  from each handler because the API registry reads an operation's scope from that literal call in the handler's source.

## Multi-Asset Records
One `MaintenanceRecord` links to multiple assets via `MaintenanceRecordAsset` join table. The sheet adds assets via a `ComboboxPicker` builder that appends each pick as a removable row (see The Maintenance sheet below).

## Types & Statuses
- Types: `REPAIR, PREVENTATIVE, TEST_AND_TAG, INSPECTION, CLEANING, FIRMWARE_UPDATE`
- Statuses: `SCHEDULED, AWAITING_PARTS, IN_PROGRESS, QA, COMPLETED, CANCELLED`
- Results: `PASS, FAIL, CONDITIONAL`

`AWAITING_PARTS` and `QA` were added for the workshop kanban board, which has since been removed (`chore: remove Workshop kanban tab`) — the two statuses were kept dormant on the enum (no migration to drop them) and are no longer offered on the sheet (status is not a field); they move only through Reopen / the existing writes. All three "in-the-shop" statuses (`AWAITING_PARTS`, `IN_PROGRESS`, `QA`) hold the asset in `IN_MAINTENANCE`.

**Adding an asset to an already-holding record holds it too.** `maintenanceWrites.ts`'s
`updateNative` re-runs `holdAssets` whenever the record's (possibly unchanged) status is
holding — not only on the SCHEDULED→holding transition — so an asset newly linked to an
already `IN_PROGRESS`/`AWAITING_PARTS`/`QA` record is held (`AVAILABLE` → `IN_MAINTENANCE`)
the moment it's added, not only when the record itself first enters a holding status.
`holdAssets` only touches currently-`AVAILABLE` assets, so already-held assets on the
record are an idempotent no-op.

## Closing out a record — per-asset disposition

Completing a multi-asset record doesn't have to mean the same thing for every asset
on it. The **Complete…** dialog (the record page's verb; the old form's status field is gone) shows
an **Asset disposition** picker — one `RETURN_TO_SERVICE` / `KEEP_OUT_OF_SERVICE` /
`RETIRE` choice per linked asset, plus an "Apply to all" bulk control for records
with more than one asset. Each row defaults to whatever the overall `result` implies
(`FAIL` → `KEEP_OUT_OF_SERVICE`, otherwise → `RETURN_TO_SERVICE`) until the operator
overrides it — `result` is untouched by this and remains the record-level "did the
work succeed" field; disposition is what happens to the **physical asset**, decided
independently per asset.

`convex/maintenanceWrites.ts`'s `updateNative` takes an optional `assetDispositions:
{assetId, disposition}[]` arg, applied by `applyAssetDispositions` ONLY when the new
status is `COMPLETED` and the array is non-empty (filtered to assets actually linked
to this record — a disposition for a foreign assetId is silently ignored, not an
error). When supplied it fully replaces the legacy record-wide "release everyone
unless `result === FAIL`" path for this save; omit it (any other caller — API/MCP,
the "Raise repair" shortcut) and that legacy path runs unchanged. The Complete dialog
uses `maintenanceLifecycleWrites.completeNative`, which defaults each disposition from the result.

- `RETURN_TO_SERVICE` — the same guarded, still-held-elsewhere-aware release as the
  old blanket path (`releaseAssets` + `computeStillHeldIds`, excluding this record).
- `KEEP_OUT_OF_SERVICE` — a no-op; the asset simply stays `IN_MAINTENANCE`, same end
  state as the old COMPLETED-FAIL guard, just chosen per asset instead of forced by
  the record-level result.
- `RETIRE` — terminal. Shares `retireAssetCore` (`convex/lib/assetRetire.ts`) with
  `assetWrites.archiveNative` rather than re-implementing "what retiring an asset
  means" here (R-3.1: isActive:false + status:RETIRED + retire linked T&T rows +
  bump the active/checked-out counters). Skipped if the asset is already `RETIRED`.
  Each retirement writes its own `entityType: "asset"` audit row
  (id `${auditId}-retire-${assetId}`, the `${parent}-${child}` per-entity-audit
  idiom also used in `checkItemsWrites.ts`) so it surfaces on the asset's own
  activity log, not just the record's.

Dispositions are never persisted on the record or the link row — they're an
instruction applied once at the moment of completion, not retained state. Reopening
a completed record for edit re-derives each row's default from `result` again.

## The Maintenance sheet (UX Phase 14, 14b-3, `MaintenanceSheet`)
Logging a job and editing one are ONE sheet on `FormSheet`
(`src/components/maintenance/maintenance-sheet.tsx`), hosted from the URL by
`MaintenanceSheetHost`: `?new=1` on `/maintenance`, `?edit=1` on `/maintenance/[id]`. The
old `MaintenanceForm` is gone; `/maintenance/new` and `/maintenance/[id]/edit` only
redirect to those URLs, and `N`, the row menu and the record's Edit all build them. A
caller without `maintenance:create` / `update` never sees it open (the param is dropped
with a toast once permissions have arrived).

- **No status field.** A job's status moves only through Complete… / Reopen (the Complete
  dialog owns result, completed date, labour, next due and the per-asset dispositions), so
  the sheet cannot move a hold. Log always creates a Scheduled job.
- **Fields** are exactly what `maintenanceEditWrites.editNative` sets
  (`MAINTENANCE_EDIT_FIELDS`): assets, title, type, assigned to, reported by, description,
  scheduled date, next due, labour, photos, tags. `partsUsed` text, result and completed
  date are NOT its fields, so a save can never clear one. A blank box CLEARS its field
  (`buildMaintenanceEdit`, `src/lib/maintenance-sheet.ts`); a stored `0` labour is `0`.
- **Asset holds.** The asset list is editable only while the job is **Scheduled** (it
  holds nothing then). Once it is under way the list is read-only on the sheet and
  `editNative` refuses a membership change with `JOB_LIVE`; Complete / Reopen own the
  holds. An Undo of a membership change likewise refuses once the job went live.
- **Labour** (`cost`) is job cost: offered only when the record read carried it
  (`canSeeJobCost`), never sent otherwise, and the server drops it for a caller who fails
  the rule (a hidden caller can neither set nor clear it, and cannot Undo an edit that
  touched it). Log offers no labour box (it is entered on Complete or from Edit).
- **Exact Undo.** Edit is a plain `recordFieldEdit`; its toast Undo is `undoEditNative`,
  ids only (author, 10-minute server window, once, compare-and-set on the fields it
  changed, the same record). An edit that removed a photo whose bytes it deleted is
  `undoable: false` (an Undo never deletes or resurrects a stored file). A save that
  changed nothing says so and offers none. Log's Undo is `undoCreateNative`.
- **Photos** use the attach rule (`assertNewMaintenancePhotos`): only the actor's own
  fresh upload in `MAINTENANCE_PHOTO_FOLDER` is attachable; ids already on the record stay
  valid on a save.
- **The legacy `updateNative`** (full replace, API/MCP and the scan page's callers) treats
  an omitted `photos` / `tags` as unchanged; clear with an explicit `[]`.

## Photos
`MaintenanceRecord.photos` (`String[]`, default `[]`) holds before/after repair photos — URLs from `/api/uploads` (the `DamageEvent` model this used to share a shape with was removed along with the Damage Capture feature — `chore: remove Damage Capture feature`). The maintenance form uses the reusable `PhotoGridInput` component (`src/components/ui/photo-grid-input.tsx`), now inside the form's "More details" accordion.

**Photos pass the attach rule** (`convex/lib/maintenancePhotos.ts`; the uploader sends `folder=maintenance-photos`,
`convex/lib/maintenancePhotoFolder.ts`). A photo that is NEW on a `createNative` / `updateNative` must be the actor's own
upload from the last few minutes, this org's, in that folder and held by nothing (`assertAttachableUpload`); any other
URL is refused (`INVALID_PHOTO`). A photo already on the record is NEVER re-validated on a save. A photo a save drops,
and a deleted job's photos, have their bytes deleted only through `deleteStoredFileIfUnreferenced`, after the record row
changed, so a file anything else still holds survives; an Undo never deletes a stored file. A removed URL's upload row is
found by a bounded scan of the org's uploads (no URL index): when it cannot be found the bytes are left, never guessed.

## Notifications
Overdue maintenance generates notifications. Shows first asset name + count for multi-asset records. Schedule-generated PM cycles (below) flow into the same `overdue_maintenance` bell type automatically via their `scheduledDate` — no separate notification type was added in v1 (org digest deferred).

## Deletion
Deleting a maintenance record releases any held assets and removes the record atomically (single transaction).

## Undo a create (`undoCreateNative`, Phase 16)
`maintenanceWrites.undoCreateNative({ orgId, id, … })` (`maintenance:create`,
`danger: "high"`) is the exact reverse of one `createNative`. It is gated on
`maintenance:create`, not `maintenance:delete`, ON PURPOSE: it only ever reverses the
caller's own create, within 10 minutes, so it grants nothing a creator couldn't already
undo by not creating. Deleting anyone else's record still needs `maintenance:delete`.
It is used by the Scan page's "Create maintenance job" Undo (FEATUREDOCS/37). The create's
own audit row now carries a server-written snapshot (`kind: "maintenanceCreate"`,
`serverSavedAt`, the status created, the link row ids it inserted, each asset it moved to
IN_MAINTENANCE with its old `status` (absent recorded as absent) and `updatedAt`, and the
assets it released; `convex/lib/maintenanceUndo.ts`). Its link-row read is bounded (200;
over that it refuses). The Undo takes ids only and refuses as a
whole unless it is the creator, within 10 minutes on the server clock, the first undo, the
record is untouched (`updatedAt` and `createdAt` as created, status unchanged), its link rows
are exactly the ones the create inserted (no WS6 CHECKOFF row, no other link), and each held
asset is as the create left it. A create that RELEASED any asset (created `COMPLETED`
and not `FAIL`, moving an asset IN_MAINTENANCE → AVAILABLE) is refused outright: re-holding
an asset another job had in the workshop is not this create's to reverse, so edit the
record instead. It then deletes the record and its links, puts each held
asset back exactly (its old status — absent stays absent — and `updatedAt`; one another holding record still holds
stays IN_MAINTENANCE), and appends an `UNDO` row. The `maintenance.created` webhook, if one
went out, is not recalled. A record created before this change has no snapshot and can't
be undone.

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

**Worklist** — the `Check off cycle…` dialog (`checkoff-dialog.tsx`; it was the `/maintenance/due` page, which now redirects) and `Service schedules…` (`service-schedules-dialog.tsx`): stat tiles (overdue / due
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

**Dashboard:** Home's `maintenanceDue` line IS this page's Overdue tile: the same
rule over every record, schedule-generated cycles **included** (as the tile counts
them). Those cycles also feed the separate, model-level `modelsDueForService` line
(opens `/maintenance/due`), so the two Home lines can overlap — see
`FEATUREDOCS/17-notifications.md`'s chip note.

**Open / overdue — ONE definition** (`convex/lib/maintenanceOpen.ts`, UX Phase 11):
the holding statuses (AWAITING_PARTS, IN_PROGRESS, QA — the asset stays in
MAINTENANCE, read by `maintenanceWrites`), open = SCHEDULED + holding, overdue =
SCHEDULED / IN_PROGRESS with the scheduled DAY before today (`isOverdueMaintenance`,
cutoff `overdueCutoff(now)` = start of the UTC day, so work scheduled for today is due,
not overdue; the notification bell and the notification emails use it through
`overdueMaintenanceRecords` in `src/lib/maintenance-read.ts`; awaiting parts or in QA is
held, not late). A record with no status is neither (the server's
status-index reads can't see it). This page's tiles are `maintenanceTileCounts` and its
row `Overdue` badge is `isOverdueMaintenance`; Home's `maintenanceDue`
(`dashboardStats.bundle`), the phone More sheet's `Maintenance 20 open · 5 overdue`
(`navCounts.get`) and the predictive-maintenance dedupe all read the same module, and
`convex/dashboardStats.test.ts` / `convex/navCounts.test.ts` hold the server counts to
`maintenanceTileCounts`, so the numbers agree.

## Related
- **[FEATUREDOCS/64 — Incident Reporting](./64-incident-reporting.md)** — the
  in-app successor to the deleted Discord `/fault` command, reusing this model.
- Workshop Kanban (formerly `FEATUREDOCS/41-workshop-kanban.md`) and Damage Capture
  (formerly `FEATUREDOCS/40-damage-capture.md`) were both removed as features; their
  docs were deleted along with the code (`chore: remove Workshop kanban tab`,
  `chore: remove Damage Capture feature`). No replacement docs exist — Damage
  Capture's role is now covered by FEATUREDOCS/64's "Report Issue" flow.
