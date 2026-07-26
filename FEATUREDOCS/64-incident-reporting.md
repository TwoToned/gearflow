# 62 — Incident Reporting ("Report Issue")

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-26 (review quarterly — POLICY.md R-5.5)_

## Overview

The in-app, first-class successor to the deleted Discord `/fault` command and
`DamageEvent` model (removed in `feature-removal-2026-06.md` Cluster 8). Lets any
authenticated org user report a broken/damaged, lost/missing, or needs-service item
from wherever gear is touched — a project line, the warehouse deploy/return tabs, or
the asset detail page — and immediately opens a maintenance record for it, instead of
the old chat-only side channel with no in-app equivalent.

Closes GitHub #898. Scope of this pass: logged-in users only (project/warehouse
staff, managers). Crew (non-login) mobile reporting and the guided "Find
Replacement" swap flow are deliberately deferred to follow-up issues — the
`reportedById` field only accepts a Better-Auth org member, and there is no
unauthenticated reporting surface yet.

## Data model — reused `MaintenanceRecord`, not a new model

Per the issue's own "open questions for planning": this reuses `maintenanceRecords`
directly rather than reintroducing a `DamageEvent`-style record. An incident report
**is** a `MaintenanceRecord` (`type: "REPAIR"`, `status: "SCHEDULED"`) with three
additive fields set:

| Field | Type | Purpose |
|-------|------|---------|
| `incidentType` | `BROKEN_DAMAGED \| LOST_MISSING \| NEEDS_SERVICE` | What kind of issue. Absent on ordinary manually-created maintenance records — this is the "is this an incident report" marker. |
| `incidentSeverity` | `MINOR \| MAJOR` | Free-text severity, mirroring the deleted `/fault` command's `severity:MINOR\|MAJOR`. |
| `lineItemId` | `string?` | The specific `ProjectLineItem` the issue was reported against, when there was one (warehouse/project entry points; absent from the asset-detail entry point when the asset isn't currently deployed). |

`projectId` (already on `maintenanceRecords`) and the `maintenanceRecordAssets` join
(already required) cover "which project it happened on" and "which asset". The
reporter is `reportedById` (already on the model) — always the verified session
user, never a client-supplied id.

## Asset status — flips immediately, no triage delay

Product decision (2026-07): reporting an issue flips the asset's status **right
away**, not after warehouse-staff triage. Mapping:

- `BROKEN_DAMAGED` / `NEEDS_SERVICE` → `asset.status = IN_MAINTENANCE`
- `LOST_MISSING` → `asset.status = LOST`

`convex/incidentWrites.ts::reportIssueNative` does this directly — it is **not**
built on `maintenanceWrites.createNative`, because that mutation's `holdAssets`
helper only transitions `AVAILABLE → IN_MAINTENANCE` and would silently no-op on the
`CHECKED_OUT` assets this flow targets. `reportIssueNative` instead unconditionally
patches the resolved asset's status (guarded only by "not already RETIRED"),
mirroring `warehouseWrites.forceReturnAsset`'s single-guard-then-patch shape —
independent of the maintenance hold/release state machine entirely.

## Entry points

1. **Project line item** (`equipment-rows.tsx` — `LineItemRow`) — "Report issue" in
   the row's kebab menu, gated to `item.status === "CHECKED_OUT"` only (a line still
   in Pick/Prep or already Returned goes through the ordinary check-queue flow
   instead). Both the desktop table row and the mobile card render their own copy of
   the menu, so the gate + `ReportIssueDialog` are wired in both.
2. **Asset detail page** (`assets/registry/[id]/page.tsx`) — a "Report issue" button
   in the action row, gated on `maintenance:create` (not asset status — any asset can
   be reported from its own page). Pre-fills the project/line item from
   `asset.lineItems` when the asset is currently `CHECKED_OUT` on a job.
3. **Warehouse deploy/return tabs** — mid-job reporting on `CHECKED_OUT` gear, since
   checks only fire at PREP/DE-PREP (`warehouse-check-policy.ts`) and return-scan
   fires no check at all.

All three share one component: `src/components/warehouse/report-issue-dialog.tsx`
(`ReportIssueDialog`) — type/severity `Select`s, a description `Textarea`, and a
required `PhotoGridInput` (submit disabled until ≥1 photo finishes uploading).
Backed by `src/hooks/use-incident-writes.ts` (`useIncidentWrites().reportIssue`) →
`convex/incidentWrites.ts::reportIssueNative`.

## Checks that actually do something

A check-item FAIL now does two things (previously only the first):

1. Sets the line's `prepStatus = FLAGGED_FAULTY` / `FLAGGED_TT_OVERDUE` (unchanged).
2. **Immediately** opens a linked `REPAIR` maintenance record — `title`/`description`
   from the check item + notes, `photos` from the check row, `incidentType:
   "NEEDS_SERVICE"`. Implemented in `convex/lib/checkIncidentReportCore.ts`
   (`runFailIncidentReport`), wired into `completeCheckAndPack` /
   `completeCheckAndFlag` / `completeCheckAndStore` / `saveAdHocCheck` /
   `saveChildItemChecks` in `convex/checkRecordWrites.ts` — same in-transaction,
   client-minted-id, atomic pattern as the existing predictive trigger, not a
   post-commit fire-and-forget.

The existing **2-of-3-fails → `PREVENTATIVE`** predictive trigger
(`checkPredictiveMaintenanceCore.ts`) is unchanged and runs alongside this as an
*additional* trend signal — the two triggers use distinct client-minted id plans
(`maintenancePlan` vs `incidentPlan`) so a single FAIL that also happens to be the
2nd-of-3 for its check item creates **two** separate records: the immediate REPAIR
report and the `[Auto]`-prefixed PREVENTATIVE trend record.

Unlike the immediate "Report Issue" flow above, a check-triggered incident record
does **not** touch `asset.status` — mirrors the predictive core's own reasoning: a
PREP/DE-PREP check happens at the warehouse counter (already gates prep/deploy), not
mid-deploy, so there's no "pull it from availability right now" urgency.

### Inline FAIL capture

`item-check-form.tsx`'s `ItemCheckForm` requires a reason + at least one photo on
any row marked FAIL before the check can submit (`allComplete` gate) — a plain
`+ Add notes` toggle wasn't enough once a FAIL opens a maintenance record. Photo
upload state is tracked per check-item id so submit stays disabled mid-upload,
matching the existing `photosUploading` pattern in `maintenance-form.tsx`.

## Visibility

- **Asset detail page** — the existing "Maintenance" tab (both desktop table and
  mobile card list) now shows a "Reported issue" badge next to the title for any
  record with `incidentType` set, alongside the existing check-record timeline
  (`asset-checks-tab.tsx`). No new tab — the Maintenance tab already IS the incident
  history, since incident reports are `MaintenanceRecord`s.
- **Project detail page** — `<OpenIssuesBadge>` (`src/components/projects/open-issues-badge.tsx`)
  next to the project title: counts open (`status` not `COMPLETED`/`CANCELLED`)
  incident-flagged maintenance records for the project, links to the warehouse page.
  Hidden entirely at zero.

## Notifications

New type `incident_report` (distinct from `flagged_asset`, which is keyed off
`ProjectLineItem.prepStatus` — this one is keyed off `MaintenanceRecord.incidentType`,
a different underlying entity). Severity maps `incidentSeverity: MAJOR → error`,
`MINOR → warning`. Wired through all four layers the notification system requires:
`src/server/notifications.ts` (bell derivation), `src/server/notification-email-sender.ts`
+ `src/lib/notification-emails.ts::incidentReportEmail` (email fan-out), and
`incidentReport` added to `NotificationPreferenceValues` (default ON — a high-signal
event, same tier as `flaggedAsset`) across both the Zod schema
(`src/lib/validations/notification-preferences.ts`) and its Convex-side byte-for-byte
mirrors (`convex/lib/notificationPreferences.ts`,
`src/lib/user-notification-preferences-read.ts`, `convex/userNotificationPreferences.ts`
`prefFields`). See FEATUREDOCS/17.

## Permissions

The warehouse deploy/return tabs are the primary surface for mid-job reporting, so
the built-in `warehouse` role's permission map now grants `maintenance: ["read",
"create"]` (previously read-only) — `convex/lib/permissionsCore.ts`. `owner` /
`admin` / `manager` already had `maintenance:create`. `reportIssueNative` gates on
`requireOrgPermission(orgId, "maintenance", "create")`.

## Deferred to follow-up issues

- **Guided "Find Replacement"** — swap a flagged line's assignment to another
  available unit/model on the same project, flowing through the normal
  pick/prep/deploy pipeline.
- **Warehouse TV dashboard** — surfacing open incidents on the dispatch/returns/prep
  display (FEATUREDOCS/12 § Warehouse Dashboard Display).
- **Crew (non-login) mobile reporting** — depends on the broader crew-portal auth
  story; out of scope until that lands.
