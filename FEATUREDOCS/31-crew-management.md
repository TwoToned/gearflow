# Crew Management

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

## Overview
Crew management tracks people (employees, freelancers, contractors, volunteers) for project staffing. Includes core entity CRUD (Phase 1), project crew assignments with scheduling and call sheets (Phase 2), availability management with conflict detection and crew planner (Phase 3), iCal calendar integration (Phase 4), communication and offer flow (Phase 5), and time tracking with timesheets (Phase 6).

## Data Models

### CrewMember
- `id, organizationId, firstName, lastName, email?, phone?, image?`
- `userId?` — optional link to platform User
- `type` — EMPLOYEE, FREELANCER, CONTRACTOR, VOLUNTEER
- `status` — ACTIVE, INACTIVE, ON_LEAVE, ARCHIVED
- `department?` — freeform (e.g. "Audio", "Lighting")
- `crewRoleId?` — FK to CrewRole
- `defaultDayRate?, defaultHourlyRate?, overtimeMultiplier?, currency?`
- `address?, addressLatitude?, addressLongitude?`
- `emergencyContactName?, emergencyContactPhone?`
- `dateOfBirth?, abnOrGst?`
- `notes?, tags[]`
- `skills[]` — many-to-many with CrewSkill
- `certifications[]` — one-to-many CrewCertification
- Unique: `[organizationId, email]`

### CrewRole
- `id, organizationId, name, description?, department?, color?`
- `defaultRate?, rateType?` (HOURLY | DAILY | FLAT) — the internal COST rate
- `chargeRate?` (WS10 #949) — the client-facing CHARGE rate, same `rateType` unit as
  `defaultRate` (one rateType per role governs both cascades)
- `sortOrder, isActive`
- Unique: `[organizationId, name]`

### CrewSkill
- `id, organizationId, name, category?`
- Many-to-many with CrewMember
- Unique: `[organizationId, name]`

### CrewCertification
- `id, crewMemberId, name, issuedBy?, certificateNumber?`
- `issuedDate?, expiryDate?`
- `status` — CURRENT, EXPIRING_SOON, EXPIRED, NOT_VERIFIED

### CrewAssignment
- `id, organizationId, projectId, crewMemberId`
- `crewRoleId?` — role for this assignment
- `status` — PENDING, OFFERED, ACCEPTED, DECLINED, CONFIRMED, CANCELLED, COMPLETED
- `phase?` — BUMP_IN, EVENT, BUMP_OUT, DELIVERY, PICKUP, HANDOVER, RETURN, SETUP, REHEARSAL, FULL_DURATION (HANDOVER / RETURN staff a client pick up / drop off)
- `isProjectManager` — boolean, PMs shown first
- `startDate?, startTime?, endDate?, endTime?`
- `rateOverride?, rateType?, estimatedHours?, estimatedCost?`
- `notes?, internalNotes?`
- `confirmedAt?, confirmedById?`
- Unique: `[projectId, crewMemberId, phase]`

### CrewShift
- `id, assignmentId, date, callTime?, endTime?`
- `breakMinutes?, location?, notes?`
- `status` — SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED, NO_SHOW

### CrewAvailability
- `id, crewMemberId, startDate, endDate`
- `type` — UNAVAILABLE, TENTATIVE, PREFERRED
- `reason?` — freeform text
- `isAllDay` — boolean (default true)
- `startTime?, endTime?` — for partial-day blocks
- Indexes: `[crewMemberId]`, `[crewMemberId, startDate, endDate]`

## Server Actions

Crew domain data lives in Convex now (this was a Prisma→Convex migration; see
[54-convex-data-layer](./54-convex-data-layer.md)). The tables below list the
original server-action names/permissions for reference; the current Convex
files are noted per phase. Reads are `query`s (typically `list`/`getById`-style
exports), writes are `mutation`s — names don't map 1:1 to the old function
names below.

### `src/server/crew.ts` (Phase 1) → `convex/crew.ts` + `convex/crewWrites.ts` (also `convex/crewMembers.ts`, `convex/crewRoles.ts`, `convex/crewSkills.ts`)
| Function | Permission | Description |
|----------|-----------|-------------|
| `getCrewMembers(params)` | crew.read | Paginated list with search, filters, sorting |
| `getCrewMemberById(id)` | crew.read | Full detail with role, skills, certifications |
| `createCrewMember(data)` | crew.create | Create with skill connections |
| `updateCrewMember(id, data)` | crew.update | Update with skill set replacement |
| `deleteCrewMember(id)` | crew.delete | Delete crew member |
| `getCrewRoles()` | crew.read | All active roles |
| `createCrewRole(data)` | crew.create | Create role — native: `crewRolesWrites.createNative` (WS10 #949, `/crew/settings`) |
| `updateCrewRole(id, data)` | crew.update | Update role — native: `crewRolesWrites.updateNative` |
| `deleteCrewRole(id)` | crew.delete | No hard delete (a role is referenced by 3 tables — see below); `crewRolesWrites.archiveNative` toggles `isActive` instead |
| `getCrewSkills()` | crew.read | All skills with member counts |
| `createCrewSkill(data)` | crew.create | Create skill |
| `deleteCrewSkill(id)` | crew.delete | Delete skill |
| `addCertification(crewMemberId, data)` | crew.update | Add cert to member |
| `removeCertification(certId)` | crew.update | Remove cert |
| `getCrewRoleOptions()` | crew.read | Dropdown options |
| `getCrewSkillOptions()` | crew.read | Multi-select options |
| `getCrewDepartments()` | crew.read | Distinct departments |
| `getOrgUsersForCrewLink()` | crew.read | Org users available for linking |
| `updateCrewMemberImage(id, image)` | crew.update | Update profile picture URL |
| `linkCrewMemberToUser(id, userId)` | crew.update | Link/unlink crew to platform user |

### `src/server/crew-assignments.ts` (Phase 2) → `convex/crewAssignments.ts` + `convex/crewAssignmentsWrites.ts` (shifts: `convex/crewShifts.ts`)
| Function | Permission | Description |
|----------|-----------|-------------|
| `getProjectCrew(projectId)` | crew.read | All assignments for a project |
| `createAssignment(projectId, data)` | crew.create | Assign crew to project |
| `updateAssignment(id, data)` | crew.update | Update assignment |
| `deleteAssignment(id)` | crew.delete | Remove assignment |
| `updateAssignmentStatus(id, status)` | crew.update | Change status |
| `generateShifts(assignmentId)` | crew.update | Auto-generate daily shifts |
| `updateShift(shiftId, data)` | crew.update | Edit individual shift |
| `deleteShift(shiftId)` | crew.update | Remove shift |
| `getProjectLabourCost(projectId)` | crew.read | Aggregate estimated cost |
| `getCrewMembersForAssignment(projectId)` | crew.read | Available crew for picker |

### `src/server/crew-availability.ts` (Phase 3) → `convex/crewAvailability.ts` + `convex/crewAvailabilities.ts` + `convex/crewAvailabilityWrites.ts`
| Function | Permission | Description |
|----------|-----------|-------------|
| `getCrewAvailability(crewMemberId, start?, end?)` | crew.read | Availability blocks for a member |
| `addAvailability(data)` | crew.update | Add availability block |
| `removeAvailability(id)` | crew.update | Remove availability block |
| `checkCrewConflicts(crewMemberId, start, end, excludeId?)` | crew.read | Conflict detection (availability + assignments) |
| `getCrewPlannerData(start, end)` | crew.read | All crew with assignments/availability in range |
| `getCrewAvailabilityStatus(ids[], start, end)` | crew.read | Status map for visual indicators |

## Rate Cascade
Assignment rate is resolved in this order (pure function, `convex/lib/crewRate.ts`
`resolveRate` — the ONE implementation; reused server-side by both
`convex/crewAssignmentsWrites.ts` and `convex/projectServicesWrites.ts`, and reused
client-side by `src/lib/project-service-read.ts`/`services-panel.tsx` for the live
preview — no duplicated cascade math):
1. `rateOverride` on the assignment (if set and > 0)
2. `crewMember.defaultDayRate` (daily) or `crewMember.defaultHourlyRate` (hourly)
3. `crewRole.defaultRate` (with role's rate type)
4. Fallback: $0 daily

## Cost Calculation
- **DAILY**: rate × number of days (start to end inclusive)
- **HOURLY**: rate × estimatedHours
- **FLAT**: rate (fixed amount)
- `calculateEstimatedCost()` (same file) turns the resolved rate into
  `CrewAssignment.estimatedCost`, computed on every write that can change it —
  from either side (see "Project Detail Integration" below, issue #796).

## Charge Cascade & Margin (WS10 #949)
The client-facing twin of the rate cascade above, resolved PER-SERVICE (not per
assignment) by `convex/lib/crewRate.ts` `resolveChargeRate` — deliberately
SIMPLER than `resolveRate`: role-first, no member-level charge rate exists (spec
decision — client pricing shouldn't wobble per crew member):
1. `projectServices.chargeRateOverride` (if set and > 0) — overrides the charge
   rate for every crew assignment on that service
2. The assigned crew's `crewRole.chargeRate` (same `rateType` the cost side uses)
3. Fallback: **null** — no auto-pricing figure exists for that assignment (never
   coerced to a fake $0; if NOTHING resolves anywhere on the service, margin stays
   hidden rather than showing a fake 0%/-100% reading — no backfill).

`recalcServiceChargeFromCrew()` (`convex/lib/serviceCost.ts`, the charge-side twin
of `recalcServiceCostFromCrew()`) sums `calculateEstimatedCost()` over the
resolved charge rate for every crew assignment on the service into
`projectServices.crewChargeTotal`, called from the SAME 5-ish call sites as the
cost twin (`crewAssignmentsWrites.ts` create/update/delete/bulk-delete,
`projectServicesWrites.ts` create/update crew reconcile). Same >=1-crew-assignment
trigger as the cost side (type-agnostic — symmetry with `serviceCost.ts:31`).

**Manual-price protection** (the `costTotal` clobber lesson, #796, applied to
price): a typed `unitPrice` on the service is an explicit manual override and is
NEVER touched by the charge recalc. Only when `unitPrice` is unset does
`lineTotal` get auto-computed from `crewChargeTotal` (minus `discount`, clamped
>= 0) — so `crewChargeTotal` feeds `lineTotal` for auto-priced services, which
then flows through the EXISTING `serviceRevenue` path in `recalcProjectTotals`
(`convex/lib/recalc.ts`) — no new revenue bucket, no double-count. The Pricing
section in `services-panel.tsx`'s service dialog shows "Auto from crew: $X" next
to the Rate field when auto-priced, with a "Use manual rate" button that copies
the auto value into the field as an explicit override (never silently clobbers a
typed price).

**Naming note:** the new schema field is `crewChargeTotal`, not `chargeTotal` —
`chargeTotal` was already in use (`src/lib/project-service-read.ts` /
`src/server/project-services.ts`) for a DIFFERENT aggregate concept (sum of
`lineTotal` across a project's services, i.e. total client-facing services
revenue). `crewChargeTotal` is the per-service, pre-discount input that feeds
`lineTotal`; conflating the two names would have been an R-3.10 violation.

**Visibility:** cost (`defaultRate`, `costTotal`) and margin (charge - cost) are
manager+ only (`useIsManagerPlus()`, `src/lib/use-permissions.ts`); the charge
rate/total (`chargeRate`, `crewChargeTotal`/`lineTotal`) is visible to every role
(members see the client-facing price, not the internal cost or margin). The
roles admin table (below) is the one place BOTH rate columns are manager+-gated —
server-enforced via `crewRoles.ts` `listForSettings`.

## Service ↔ Crew Cost Linkage (issue #796)
A `CrewAssignment` with a `serviceId` is "owned" by that `ProjectService`: its
resolved cost rolls up into the service's own `costTotal`, which is what feeds the
service's line item and the project's `serviceCostTotal`. This is enforced from
**both** write paths so the two surfaces can never disagree:
- **Service-side** (`convex/projectServicesWrites.ts`): adding a crew member to a
  service (or editing crew there) runs the rate cascade immediately (no more "silently
  $0 until someone edits it from the crew side") and calls
  `recalcServiceCostFromCrew()` (`convex/lib/serviceCost.ts`) after every
  create/update crew reconcile.
- **Assignment-side** (`convex/crewAssignmentsWrites.ts`): editing an assignment's
  rate/hours, or creating/deleting one with a `serviceId` set, calls the SAME
  `recalcServiceCostFromCrew()` (and `recalcProjectTotals`) so a rate change made
  from the crew UI is reflected on the owning service too.
- **Double-counting**: `recalcProjectTotals`'s `labourCostTotal`
  (`convex/lib/recalc.ts`) only sums assignments with **no** `serviceId` — a
  service-linked assignment's cost is already inside `serviceCostTotal` via the
  service's own `costTotal`. Standalone assignments (rare now — see below) still
  roll up through `labourCostTotal` as before. The SAME exclusion applies to
  `crewAssignments.projectLabourCost` (it fed the Overview's "Crew" tile and the old
  `CrewPanel` summary bar; both are gone, the tile in UX Phase 7, and no page reads
  it now) and its pure
  counterpart `aggregateProjectLabourCost` — both were fixed to exclude
  service-linked assignments after they were found double-displaying a
  service's crew cost as a second, separate "Crew" total.
- A **crew-less** service keeps whatever `costTotal` was last set manually (e.g. a
  vehicle/transport-only service with no crew) — `recalcServiceCostFromCrew()` only
  takes over once the service has 1+ crew.
- **Charge side (WS10 #949):** the SAME crew reconcile also runs
  `recalcServiceChargeFromCrew()`, rolling the resolved charge rate up into
  `crewChargeTotal` (and, when no manual `unitPrice` is set, into `lineTotal`) —
  see "Charge Cascade & Margin" above for the full cascade + manual-override rules.

## Pages
| Path | Component | Description |
|------|-----------|-------------|
| `/crew` | CrewDashboard / CrewTable | Manager+ sees dashboard with stats, timesheets, assignments, offers; others see crew list |
| `/crew/new` | CrewMemberForm | Create crew member |
| `/crew/[id]` | Detail page | Profile picture (upload/remove), contact, rates, skills, assignments (with status management), availability, certifications, time entries, calendar, linked user display |
| `/crew/[id]/edit` | CrewMemberForm | Edit crew member (includes user account linking) |
| `/crew/planner` | CrewPlannerPage → `CrewPlanner` | The Crew workspace's **Planner** word: the shared Crew head (see "Crew workspace" below) over the one-week planner (see "Crew Planner") |
| `/crew/timesheets` | `TimesheetsList` (`src/components/crew/workspace/timesheets/`) | The Crew workspace's **Timesheets** word on `ListPage` (UX Phase 15, spec §9h.4) — see "Crew workspace" below |
| `/crew/settings` | redirect | Server redirect to `/crew/planner?sheet=roles`: the roles admin is now the **Crew roles & rates** sheet (`src/components/crew/workspace/roles/`). Old links and bookmarks keep working |

**CrewTable data source (2026-07, perf fix):** server-side paginated —
`crewMembers.listPage` (filter/sort/crewRole join done in Convex) via
`useAuthedQuery`, replacing whole-org `useCrewMembers`/`useCrewRoles` live
subscriptions that filtered/joined/sorted client-side. See
`docs/designs/perf-convex-efficiency-2026-06.md` Finding #1. The linked platform
user (Better Auth, cross-domain) stays a separate merge applied after the paginated
fetch — search no longer matches the linked user's display name, only this table's
own fields (a narrow, disclosed tradeoff since Convex can't join Better Auth data).
Rows go through the same `memberRowRedactor` as `list`/`getById` (the feed token
only for the member themself or `crew:update` on a user session; rates only with
crew pay).

## Crew workspace (UX Phase 15, spec §9h, D48)

One page, **Crew**, with two views as head words, `Planner  Timesheets`
(`ListHead`'s additive `headWords` prop; each word is its own route, so both
stay deep links). `src/components/crew/workspace/crew-workspace.tsx` owns the
words, the page ⋯ items both views share (**Crew list**, **Crew roles &
rates…**) and the roles sheet, which is URL state: `?sheet=roles` (where
`/crew/settings` redirects). Each view keys its list by the active org, so an
org switch drops the selection and the seen rows.

### Timesheets (`timesheets/timesheets-list.tsx`, spec §9h.4)
- `ListPage` over `crewTimeEntries.allEntries`; the URL is the state
  (`src/lib/list-views/timesheets.ts`): strip **Submitted · Approved · Queried ·
  All** (Submitted is the default), `Person` and `Status ▾` filters (the strip
  and Status intersect), sort by person / date / hours / status, the pager, and
  saved views (old `crewMemberId` filters convert to `person` on read).
- Columns: person (role) · job (number + name, description, query reason in
  amber) · date (times and break under it) · hours · **Rate (pay)** · **Total**
  · status; Approved by and Notes are opt-in under ⋯ › Columns. Rate (pay) and
  Total are columns ONLY when the server returned them (`payVisible`) — the
  client never decides who sees pay. A carried day rate prints `incl.`, an
  unresolved rate is blank, never $0. Footer line: `Totals · 361h · $16,962`
  (the money only for a pay-visible caller).
- Row ⋯ (`src/lib/row-actions/time-entry.ts`): Edit entry, Submit, Approve,
  Query…, Open crew member, Delete entry (confirmed). Which verb a row offers
  comes from the ONE transition table the server gates on
  (`convex/lib/timeEntryTransitions.ts`). Exported rows have no ⋯.
- Bulk: `Approve n · Submit n · Query… · Export` (each count is the rows it
  would change). Submit / Approve / Query… toast with Undo from ONE closure:
  `revert(result)` — the forward result's own `changed` + `stamp`. Skipped rows
  are named. Export calls the same server CSV as Export all…, narrowed to the
  ticked ids (`exportTimesheetCSV({ ids })`, Zod-validated), so pay columns are
  still decided server-side.
- Edit entry and Log time (two steps: tick people, then one set of hours) are
  sheets (bottom on a phone). Saving an edit returns the entry to Draft and
  clears its approval (`updateNative`), so its Undo (the snapshot replayed) is
  offered only for an entry that WAS a draft; any other says so before Save.
  Log time's Undo is ONE atomic mutation,
  `crewTimeEntriesWrites.undoCreateManyNative({ ids, stamp })`: it deletes
  exactly the entries that call created and refuses the whole Undo if any was
  edited, submitted or approved since (offered only with `crew:delete`). Like
  `revertNative`, it is author-scoped: only the user whose Log time wrote the
  entries' CREATE rows at that stamp may take them back.
  Query… is a dialog whose Save stays disabled until a reason is typed.
- Phone: cards `name` / `#2336 · Sat 7 Nov · 8.5h · Submitted` with the total
  on the right, the sticky Log time, `Show 25 more`. Export all… stays in the
  page ⋯ on a phone too: it is the only date-range export.

### Crew roles & rates (`roles/crew-roles-sheet.tsx`, spec §9h.5)
The old `/crew/settings` page as a sheet: active roles in display order,
archived ones under a muted head, cost / charge only when the SERVER says the
caller sees pay (`crewRoles.ratesVisible` = `canSeeCrewPay`, never the client's
role; `crewRoles.listForSettings` strips the rates otherwise, and an edit then
sends no rate fields). Row ⋯
(`src/lib/row-actions/crew-role.ts`): Edit… · Move up / Move down (active roles
only, absent at the ends) · Archive… (usage dialog) · Restore. A move is ONE
atomic `moveNative`, its Undo the opposite move; archive ↔ restore and an
edit's snapshot are the other Undos. New role has no Undo (there is no role
delete).

## Profile Pictures
- Upload/remove via hover overlay on avatar in crew detail page header (only for unlinked crew members)
- API route: `POST/DELETE /api/crew/avatar` — validates org ownership, resizes to 256x256 JPEG via sharp
- Stored in S3 under `{orgId}/crew/{crewMemberId}/avatar.jpg`
- Avatars shown in: crew table (inline with name), crew detail page header
- Falls back to initials (first + last name) when no image
- **Linked crew members** inherit their profile picture from the linked user account — no separate upload

## Crew Member Form (`/crew/new` + `/crew/[id]/edit`)
`CrewMemberForm` (`src/components/crew/crew-member-form.tsx`) is built on the
shared `SmartFormLayout` shell (see [08-assets](./08-assets.md)) — both routes
render it (edit pre-fills `initialData`, reusing create). Sections: Identity
(first/last name, type + status `Select`s with sentence-case labels, linked
platform user via `ComboboxPicker` with auto-fill) → Contact (email, phone) →
Rates (day/hourly/overtime) → "More details" accordion (department, default role
via `crewRoleId` picker, DOB, ABN/GST, address, emergency contact, notes, tags).
Live preview rail: `PersonAvatar` (synced photo if linked) + name + type chip +
rate line. The `crewRoleId` field already existed in the schema but previously
had no UI; it is now surfaced as a default-role picker. Same
`createCrewMember`/`updateCrewMember` actions, `crewMemberSchema`, and `crew`
create/update permission gates.

## Crew Member Detail Page (`/crew/[id]`)
- Detail-page bar layout: breadcrumb → **hero** (`PersonAvatar` + name + status indicator + type badge + an Available/Unavailable badge) with inline contact quick-actions (mailto/tel chips, linked-user note) that render **only when present** (calm-by-default, no `—` noise) → edit/delete actions.
- **At-a-glance strip** below the hero (single surface, vertical dividers, mirrors the project summary strip via the local `GlanceTile`): next shift (date + project), hours this month (approved, calendar-month), active assignments (live count + total), and headline rate (day rate, falling back to hourly, with OT multiplier sub-line). All computed client-side from the already-loaded `assignments` / `timeEntries` / rate fields — empty/zero values render as quiet muted text, never a bare dash.
- Two-column body unchanged: tabs (Assignments / Availability / Time / Calendar) in `DetailMain`; Contact / Role & department / Rates / Skills / Tags / Availability / Notes / Activity in `DetailSidebar`. Sidebar Role/Department/Rates placeholders now use `text-faint` so missing values recede.
- Own-profile banner and `crew.read`-or-own-profile access gate are preserved; all dialogs (availability, time entry, delete, regenerate token) and mutations are unchanged.

## User Account Linking
- Crew members can be linked to platform users via `userId` field
- **The "Platform account" picker lives in the Identity section** of the crew member form — selecting a user auto-fills first name, last name, and email
- Linked crew members inherit **name, email, and profile picture** from the user account for display
- Users already linked to another crew member are filtered out of the picker
- Linked user shown in crew detail page header with link icon (hidden on own profile)
- Server-side validation: user must be an org member, can't double-link
- `getOrgUsersForCrewLink()` returns org members with `alreadyLinked` flag
- `getMyCrewMemberId()` returns current user's linked crew member ID (if any)
- `linkCrewMemberToUser(id, userId)` for programmatic linking/unlinking

## Self-Access
- Users with a linked crew profile can **always view their own crew page**, even without `crew.read` permission
- "My Crew Profile" link appears in the user dropdown menu (next to Account Settings)
- Own profile page shows a banner: "You are viewing your own crew profile"
- `getCrewMemberById` returns `isOwnProfile: true` when the logged-in user matches the crew member's `userId`

## Project Detail Integration
> **UX Phase 5a:** the "Labour & logistics" tab is now **Logistics**
> (`src/components/projects/logistics/`, [84-job-logistics.md](./84-job-logistics.md)); `ServicesPanel`
> and `CrewPanel` are gone. Crew are child rows under their service (read-only) and, with every verb
> (offers, confirm, status, remove with Undo), in the **By person** view; **Pick crew** is one sheet;
> `sendCrewOffers` sends offers; `shiftScheduleNative` moves services and crew calls with the job
> dates. The text below describes the pre-5a panel; the data model and cost linkage are unchanged.

There is **no separate "Crew" tab** — the "Labour & logistics" tab on the project
detail page (`/projects/[id]`) is entirely owned by `ServicesPanel`
(`src/components/projects/services-panel.tsx`), which is now the **sole crew UI**
on the page (issue #796 — "put all crew management on the services"):
- **Crew is added per-service**: the service edit dialog's Crew section has a crew
  member picker plus a **per-crew rate table** (`CrewRateTable`) — one row per
  assigned member showing name, resolved rate (live preview of the same cascade the
  server runs), an overridable rate/rate-type/hours, and that row's cost. The
  service's "Cost to Business" total becomes a read-only auto-calculated sum of that
  table once any crew is assigned (see "Service ↔ Crew Cost Linkage" above); a
  crew-less service keeps the old manually-typed cost field.
  `CrewRateTable` renders as a real `Table`/`TableRow`/`TableCell` (from
  `@/components/ui/table`) instead of stacked flex rows — column labels ("Crew",
  "Rate", "Cost") live once in the header instead of being repeated per row per
  field, and the Rate cell joins the override amount + rate-type select into one
  bordered control. The Hours column only renders at all when at least one
  assigned row is hourly-rated. The crew-member picker's selected-chip row
  (`MultiComboboxPicker`'s default "X selected" chips under the trigger) is
  suppressed here (`showSelectedTags={false}`) since the rate table immediately
  below lists the same members — showing both was duplicate information.
- **`CrewPanel`** (`src/components/projects/crew-panel.tsx`) is rendered FROM
  INSIDE `ServicesPanel` (not mounted separately by the page) as a "Project crew"
  section below the service list — every crew member across every service on the
  project, in one table, for viewing/status-changing/messaging/call-sheets. It no
  longer has an "Add crew" entry point or an add-mode dialog: crew are only ever
  *created* via a service's rate table now; `CrewPanel`'s `AssignmentDialog` is
  edit-only (rate override, dates, role, phase, status, notes) for assignments that
  already exist, whichever side created them.
- Assignment list with phase grouping, PM highlighting; status dropdown (Pending →
  Offered → Accepted → Confirmed → Completed); bulk status/delete; offer-all;
  bulk/individual messaging; call sheet button — all unchanged from before, just
  reached through `ServicesPanel` instead of a page-level sibling.
- **Conflict/availability indicators (WS8 #947, closes the #796 follow-up above)**:
  the crew-picker inside the service dialog now shows the same live
  conflict/availability signal the edit dialog always had — see
  "Crew Conflict & Availability Indicators" below for the single-owner query and
  severity model.
- **Labour cost** shown in project financial summary (via `labourCostTotal` +
  `serviceCostTotal`, see "Service ↔ Crew Cost Linkage" above)
- **Call Sheet** button lives with the crew section (moved along with `CrewPanel`)
  and in the Documents dropdown

## Call Sheet PDF
- `generateCallSheetPdf()` in `src/lib/pdfme/generate-pdf.ts`, using the pdfme templates
  `src/lib/pdfme/templates/call-sheet.ts` / `call-sheet-services.ts` and plugin
  `src/lib/pdfme/plugins/gearflow-call-sheet-info.ts` (see [13-pdfs](./13-pdfs.md)) — landscape A4 document
- API route: `GET /api/documents/call-sheet/[projectId]?date=YYYY-MM-DD`
- Lists all non-cancelled crew sorted by call time then role
- Includes: project info, location, site contact, crew table (name, role, phase, call/wrap times, phone, notes)
- Uses shift-specific times when available for the requested date

## Availability Management (Phase 3)
- Crew member detail page has an "Availability" tab to add/view/remove blocks
- Types: UNAVAILABLE (hard block, red), TENTATIVE (soft, amber), PREFERRED (wants work, green)
- Conflict detection integrated in assignment dialog — shows warnings when assigning crew with conflicts
- Hard conflicts (UNAVAILABLE) shown in red, soft conflicts (TENTATIVE, double-booked) in amber
- Allows override — admin can still assign despite warnings

## Crew Conflict & Availability Indicators (WS8 #947)

**Single-owner query, no new primitive.** `convex/crewAssignments.ts`'s
`membersForAssignment` is the one query behind the service dialog's crew picker;
it now takes `rangeStartMs`/`rangeEndMs` (the service's own dates — the service
dialog computes and passes them; previously it didn't, which was the whole
#796 follow-up gap) and an `excludeServiceId` (the service being created/edited,
so its OWN crew rows don't get reported as conflicting with themselves — a
DIFFERENT service on the SAME project now correctly surfaces as a same-day
double-book, and cross-project assignments always stay included regardless of
service). A new sibling query, `conflictsForProject`, feeds the same signal to
`CrewPanel`'s crew table in one batched call keyed by assignment id (kept
separate from `projectCrew` deliberately — that composite already collects
shifts per row and shouldn't get fatter). Both call ONE shared pure function,
`convex/lib/crewConflicts.ts`'s `computeMemberConflictSignal`, so the
severity/availability rules live in exactly one place. Reads are index-bounded
on `by_crewMemberId_startDate_endDate` (`.lte("startDate", rangeEndMs)`
— deliberately one-sided: a matching `.gte` would silently drop a real conflict
from a multi-day block that started before the window but still overlaps it).

**Severity alignment (the pencil rule, extended to assignment status).**
`crewConflicts.ts`'s existing model (WS3 #942, still what the org-wide
Overbookings board's `computeCrewDoubleBookings` uses) treats every
assignment-vs-assignment conflict as `soft` — a crew member CAN legitimately be
pencilled onto two quoted jobs. WS8 deliberately upgrades that rule for the
picker and the assignment edit dialog ONLY: an overlapping assignment's own
status now decides how real the hold is — `CONFIRMED`/`ACCEPTED`/`COMPLETED` →
**hard** ("Booked: {project}"), `PENDING`/`OFFERED` → **soft** ("Pencilled:
{project}"). An `UNAVAILABLE` availability block is still hard, `TENTATIVE`
still soft, and a `PREFERRED` block is a **positive hint** (green), never a
conflict — new for the picker/rate-table/crew-table surfaces (the org-wide
board still only cares about hard/soft). `convex/crewAvailability.ts`'s
`conflicts` query (the edit dialog's data source) adopts the same status-keyed
severity for its assignment-type entries — both surfaces (picker + edit dialog)
share the upgrade together, per the spec.

**Rendering — one color system, not a parallel one.** `src/lib/status-colors.ts`
gained a `"conflictSeverity"` category (`hard`→error, `soft`→warning,
`preferred`→success) plus an `intentBorderClass(intent)` helper that derives the
existing `border-l-<token>` card-accent convention (already used verbatim
elsewhere — `csv-import-dialog.tsx`, `equipment-add-form.tsx`, etc.) from the
same intent `StatusIndicator` already uses. `CrewPanel`'s `AssignmentDialog`
conflict banners (previously hardcoded `border-l-t-out`/`border-l-warn`
strings) now go through `getStatusIntent("conflictSeverity", …)` +
`intentBorderClass` — same visual result, one source of truth.
`ComboboxPickerOption` gained a non-searchable `badge` slot (`combobox-picker.tsx`
— `description` stays the searchable metadata slot) rendering a `StatusIndicator`
dot+label. The service dialog's crew picker rows, the `CrewRateTableRow` sub-line,
and a section-level "N of M selected have clashes" summary all derive their
badge from the ONE `pickConflictBadge` precedence helper in `services-panel.tsx`
(unavailable/hard-conflict > tentative/soft-conflict > a preferred hint >
nothing). A "Set service dates to check availability" neutral hint (the
equipment-picker's dateless-availability precedent) shows instead when the
service has no dates yet — there's nothing to check.

**Bulk paths (non-gating).** "Send offers"/"Confirm all" in the service dialog
now go through a confirm `Dialog` (previously fired immediately — no AlertDialog
per CLAUDE.md) whose description includes a pre-flight "N of M have scheduling
clashes" line when applicable; `CrewPanel`'s existing "Offer all" confirm dialog
gained the same line. Neither ever blocks the action — every indicator on this
page (picker badge, rate-table sub-line, section summary, bulk pre-flight line,
crew-table column) is advisory only and never gates submit.

**Crew table.** `CrewPanel`'s desktop table gained a "Conflicts" column (the
hardcoded `PhaseGroup` group-header `colSpan` moved 9→10 to match) and its
mobile card variant shows the same badge inline — fed by `conflictsForProject`,
keyed `(projectId, range)` and bounded to the project's own dated assignments.

**Dead code removed.** `src/lib/crew-scheduling-read.ts`'s `computeAvailabilityStatus`
(zero production callers, Prisma-era leftover) and its test are deleted — its
UNAVAILABLE→TENTATIVE→busy→available precedence lives on, ported into
`computeMemberConflictSignal`'s `availability` field.

## Crew Planner (UX Phase 15, spec §9h.3, D46)

`/crew/planner` is the Crew workspace's **Planner** word
(`src/components/crew/workspace/planner/`, pure derivations in
`src/lib/crew-planner.ts`, URL codec in `src/lib/crew-planner-url.ts`, row and
bulk verbs in `src/lib/row-actions/crew-call.ts`). The route is a thin server
component; the fortnight, the today-tiles, the crew-member Select and the glyph
legend are gone (every block prints its own word).

- **One week** (D46) from the **org's week start** (`useOrgWeekStartsOn`, #1086:
  Mon, or Sun for a Sunday-start country) with ‹ › Today; it opens on this week,
  or the week holding the next working days on a weekend. Rows are active crew by last name; the last column
  is **Hours** = planned (each booked call's `estimatedHours`, else its times ×
  its days in the week; PENDING / DECLINED are not planned — the live rule) `/`
  logged (`crewTimeEntries.approvedHoursByMember`). Derived, never stored.
- **A call is a block**: tick (a 24px target) · job number (links to the job's
  Logistics tab) · role · times · status word (`Offered 4d`, amber from 3 days).
  The block is a plain container: its primary is ONE stretched button (opens the
  **call sheet**), with the tick, the link and ⋯ as sibling controls — never
  interactive content nested in a button. ⋯ on hover/focus (always on touch).
- **Empty cells print the person's day**: `Unavailable` (hatched, with its
  reason), `Pencilled` (a TENTATIVE block, Q-S5), `Preferred`. Clicking one opens
  **Offer a call** for that person and day (needs `crew:create`).
- **Strip** `All · Needs crew · Unconfirmed · Mine`: All = calls this week; Needs
  crew = open slots (`crewPlanner.openCalls`); Unconfirmed = Pending + Offered +
  Accepted; Mine = calls on jobs I am the PM of (the Jobs `My jobs` rule —
  `plannerData` now carries each job's `projectManagerId`). Unconfirmed and Mine
  keep only people with a matching call and dim the other blocks.
- **Filters** read their value: `Role`, `Skill`, `Job` (also dims other jobs'
  blocks), `Availability` (Free · Booked · Unavailable · Pencilled · Preferred).
  Week, strip, search and filters are ALL the URL (D11); other params
  (`sheet=roles`) are kept. The #1246 find-cover deep link
  `?week=<epoch ms>&role=<id>&avail=AVAILABLE` still lands filtered (`AVAILABLE`
  reads as Free; the old `TENTATIVE`/`ASSIGNED`/… values map too; the epoch-ms
  week is read as the viewer's LOCAL day, the way it was written).
- **Needs crew** replaces the grid with the open calls by day (a multi-day run
  once, under its first short day in the week): job · call · times · `needs n` ·
  up to three people with that role free on EVERY day Offer to suggested would
  book (preferred first). A row opens Offer a call with the first suggestion picked;
  row ⋯ = Offer to…, Offer to suggested, Open job. When `openCalls` stopped at
  its cap (`truncated`), the list says `n+ open slots` and states that some calls
  are not listed. It suggests no filter: Role / Job narrow the list on the
  client, not the server's read.
- **Offer a call** (sheet): Person (each with their day state), Day, Job service
  (every open service RUNNING that day, a multi-day run on each day it covers,
  `needs n`), Role, Start, End, the role's cost rate (only when the server sent
  it), `Send the offer now`. For a multi-day run it asks **This day only / Whole
  run** (default: the picked day). It creates a PENDING call through the same
  `crewAssignmentsWrites.createNative` Logistics uses (with the service's
  `phase`); with Send on it then calls `sendCrewOffers` — the button asks once
  more in place, and the toast has no Undo (the email is out). Saved as Pending,
  its Undo deletes the created call (only with `crew:delete`).
- **Bulk** (tick calls, shift-click ranges, select-all in the header): `Offer n`
  (PENDING → OFFERED, confirmed, no Undo), `Confirm n` (ACCEPTED → CONFIRMED,
  Undo `unconfirmManyNative(result)`), `Cancel n` (red, last, confirmed;
  `cancelManyNative` then `sendCancellationEmails(toTell)`; no Undo). Ticking
  open calls under Needs crew offers `Offer to suggested n`: free or preferred
  people with the role on EVERY day the call will book, up to the worst gap
  among them, one person once per DAY across the batch (`planSuggestedOffers`;
  a call claims each day it books), created then offered in one send. It books
  `bookSpans` — one call per contiguous run of SHORT days inside the visible
  week — so it never reaches a day the planner didn't check (a Thu → next-Tue
  run offered from this week books Thu–Sun; S2) and a filled day between two
  short ones is never over-staffed (short Mon and Wed: two calls). Select-all and shift ranges
  skip calls **dimmed** by the Job filter or the Unconfirmed / Mine segment; a
  confirm that reaches more than one job names them (`Jobs: #2341, #2350.`); a
  tick whose call left the live data, or was dimmed after it was ticked, drops
  out of every count AND every verb. Crew mail goes out in batches of
  `MAX_CREW_MAIL_BATCH` (100, the action's own cap; ids deduped first), so a
  500-call bulk write emails everyone; if a later batch fails, the toast says
  `n sent, m not sent` with Retry for exactly the unsent rest.
- **Which verb a call offers** comes from ONE table,
  `convex/lib/crewCallTransitions.ts` (`canCrewCall`), read by the server gates
  (`confirmManyNative`, `cancelManyNative`, `sendCrewOffers`) and the menus.
  `sendCrewOffers` now refuses (per row, named) a call that is not PENDING or
  OFFERED, so a bulk offer can never knock an ACCEPTED/CONFIRMED call back — and
  the refusal is ATOMIC: the write is the service mutation
  `crewAssignments.markOfferedIfOfferable`, which re-checks the status inside
  the same transaction as the OFFERED patch (a yes that lands between the
  action's read and its write wins). `cancelManyNative` also clears the call's
  `responseToken`.
- **The call sheet** shows role, times, status (with when it was offered) and
  the person's day, and the block ⋯ verbs as buttons (the same spec). It holds
  only ids and reads the call from the live data, so an Offer / Confirm shows the
  new status and a cancelled call closes it. Editing a
  call's role, times or rate stays on the job's Logistics tab: `updateNative`
  replaces the whole assignment, and a planner edit below the pay line (which
  never read `rateOverride`) would wipe it.
- **Footer**: `10 people · 5 of 13 confirmed · 2 accepted · 2 offered · 4 pending`,
  with `n declined` in red as the one flag.
- **Live**: `plannerData`, `openCalls` and the logged hours are live
  subscriptions keyed on the URL week (no `Date.now()` in the args).
- **Phone** (§9h.6): day mode — day chips (`Tue 17 · 1 open`, red count), then one
  day as Needs crew (every run covering that day) · Booked (64px cards, 22px tick
  on a 44px target, ⋯; a DECLINED call doesn't book the day) · Free (tap = Offer a
  call) · Unavailable; the Needs crew strip lists the week's open calls by day.
  Sticky `Offer call`, replaced by the bulk bar while ticked. Sheets open from the
  bottom.

### UX Phase 15 reads and writes (spec §9h)
- **`crewPlanner.openCalls({ orgId, startMs, endMs })`** — the `Needs crew` list:
  services short of people via the Overbookings board's own
  `computeServicesMissingCrew`, which reads the ONE per-day rule
  `crewShortfallByDay` (`convex/lib/crewShortfall.ts`, B1). The shortfall is
  **per day**: an assignment fills only the days its `[startDate, endDate]`
  covers (no dates = the whole run), DECLINED/CANCELLED fill nothing, and a run
  is short if ANY day is below `crewCountRequired`. So a "this day only" call
  on a Mon–Wed run that needs 1 leaves Tue and Wed open. Each row carries
  `shortDays` (clipped to the window, each with its own gap), and `shortfall`
  is the worst of them; a run with no short day in the window is not listed.
  The planner lists a run under its first short day, opens it only on its
  short days (phone chips, Offer a call's service list) and names partial
  runs `Wed, Thu short` (`src/lib/crew-short-days.ts`).
  Only each job's **live-version** service rows count (`isLiveVersionRow` — every
  version keeps its own copy of a service), on in-org, non-template, non-cancelled
  jobs. A multi-day service counts when its `[date, endDate]` overlaps the window,
  even if it started before it (the scan reaches back 31 days). Range ≤ 14 days,
  bounded both ends on `by_organizationId_date`, capped with a `truncated` flag.
  Each row also carries `phase` (what a call on it staffs) and `endDate`, which
  the planner's Offer a call creates the assignment with.
- **`crewAssignmentsWrites.confirmManyNative`** (`Confirm n`): ACCEPTED → CONFIRMED
  only, the rest is `skipped`; one activity row per call recording the prior state.
  **`unconfirmManyNative({ ids, stamp })`** is its exact Undo, reading the prior
  state from those rows and refusing if any call changed since (same rule as the
  timesheet `revertNative`).
- **`crewAssignmentsWrites.cancelManyNative`** (`Cancel n`, `danger: "high"`):
  PENDING/OFFERED/ACCEPTED/CONFIRMED → CANCELLED, one activity row per call, time
  entries untouched; returns `toTell` (the calls whose crew member already had the
  offer) for the caller to send cancellation mail. No Undo — the mail is sent.
- **`crewRolesWrites.moveNative({ id, direction })`**: Move up / Move down as ONE
  atomic renumber (replaces the two non-atomic `updateNative` calls; ties become
  movable). It swaps with the nearest role in the SAME list — active roles past
  archived ones and vice versa, since the roles sheet lists archived roles under
  their own head — so a move is always visible. Its Undo is the opposite move.
- `plannerData` also returns each member's `skillIds` (for `Skill ▾`) and redacts
  assignment pay below manager (see Time Tracking › pay).

## Crew Planner — confirmation layer, availability requests, planned vs actual (Work-layer Phase 4, #1246)

> **History.** The fortnight grid, its glyph badges and the header sentence
> described below were replaced by UX Phase 15's one-week planner (see "Crew
> Planner" above): status words, the footer counts and the Hours column carry
> the same facts. The server pieces here (`PLANNER_HIDDEN_STATUSES`,
> `approvedHoursByMember`, the offer nudges, first-come fill) are unchanged.

> Design: `docs/designs/work-layer.md` §8.5/§9/§10, build plan phase 4.
> Seam: ROADMAP §2.1 (crew & services overhaul) owns services, rates and the
> offer flow itself; this phase owns the planner's confirmation layer and the
> shared agenda engine on top of the EXISTING offer flow — no changes to
> `crewCountRequired`, rates, or the core offer email content beyond three new
> variants (reminder / position-filled / call-time). No open PR/branch touched
> §2.1 when this shipped (verified fresh against `TwoToned/gearflow`).

**Confirmation badges.** Every shift block on `/crew/planner` now carries a
text glyph paired with its `getStatusColor("assignment", …)` intent —
`✓ confirmed`, `? offered`, `✗ declined`, `· ` (not yet offered) — never
colour alone (POLICY.md §3.3). `plannerData` (`convex/crewAvailability.ts`)
used to exclude DECLINED assignments from the grid entirely (the shared
`EXCLUDED_ASSIGNMENT_STATUSES` set, meant for "does this hold the member's
time" conflict math); the planner now uses its OWN `PLANNER_HIDDEN_STATUSES`
(CANCELLED only) so a declined shift still renders with its badge. The header
strip gains a confirmation summary sentence — "6 of 9 confirmed · 2 offered ·
1 declined" — computed client-side over every distinct assignment in the
visible fortnight (PENDING/CANCELLED excluded from the math; they still get
their own glyph on the block). `plannerData` also stops leaking
`responseToken` (the single-use offer-respond bearer credential) into its
payload — the same redaction `projectCrew` already does.

**Unanswered-offer threshold.** The "> 48h" staleness threshold is
`resolveCrewOfferStaleHours` (`convex/lib/orgSettings.ts`), an org setting
(`OrgSettings.crewTime.unansweredOfferHours`, default 48, Settings → Crew & time) resolved
server-side; it drives the offer nudge email. (The Today "Needs you" Triage rail with
Re-offer / Find cover actions, and `dashboardLists.needsYou`, were removed with the work layer.
The planner still accepts `/crew/planner?role=&avail=AVAILABLE&week=` deep links.)

**Request availability… (bulk, first-come fill).** `CrewPanel` gains a
"Request availability…" action (`RequestAvailabilityDialog`) — pick a
project service (its `crewCountRequired` is what "filled" means), an optional
role, and a date range. `requestCrewAvailability` (`src/server/crew-communication.ts`)
resolves eligible crew via the EXISTING `crewAssignments.membersForAssignment`
query (the same conflict/availability computation the assignment picker
already uses — not a second eligibility definition), creates one
`crewAssignments` row per eligible member linked to that `serviceId`, and
sends each the existing offer email via `sendCrewOffer`. **First-come fill**:
when enough of those rows reach ACCEPTED/CONFIRMED to meet the service's
`crewCountRequired`, the public respond route
(`/api/crew/respond/[token]`) calls a new service-gated mutation,
`crewAssignments.autoFillServiceNative`, which auto-cancels the other still-open
offers on that same service (no new table — `serviceId` is the existing
grouping key). The fill is **per day** (UX Phase 15, `crewShortfallByDay` over the
ACCEPTED/CONFIRMED rows, `coveredDaysFull`): an open offer is cancelled only when
every day IT covers is now full, so a Monday-only accept on a Mon–Wed run never
cancels a Tue–Wed offer. Then the route best-effort emails each one a "position filled"
notice (`notifyPositionFilled`, `src/lib/crew-position-filled.ts`). These
no-session senders — the notice, both nudges and `buildAssignmentEmailData` —
are PLAIN server-only modules, never `"use server"` exports (an exported action
is callable from any session, and these have no authz of their own); a guard
test (`src/server/__tests__/use-server-email-authz.test.ts`) fails on any
ungated email/push sender in a `"use server"` file. **24h auto-nudge**: `src/lib/crew-time-nudges.ts`'s
`sendCrewOfferNudges` rides the SAME 15-minute notification cron
(`/api/cron/notifications`) and the SAME `notificationEmailLogs` dedupe ledger
(`createIfMissing`, one nudge per assignment ever) — no second cron, no second
dedupe mechanism. No SMS anywhere in this flow (none exists in the codebase).

**Planned vs actual.** A new sticky "Planned / actual" column on the planner,
per crew member, over the visible fortnight — derived and read-only, no new
table. Planned = the sum of each visible assignment's own `estimatedHours`
(already computed at booking time, `convex/lib/crewRate.ts`), excluding
DECLINED/PENDING. Actual = approved logged hours from `crewTimeEntries`, via
a new query `crewTimeEntries.approvedHoursByMember` (indexed
`by_crewMemberId_date` per member, bounded to the planner's own roster).
Approval, dispute and export flows on `crewTimeEntries` are untouched — this
is a read-side addition only.

**`crewTimeEntries.workItemId` (optional, read-side).** A crew-assigned work
item (`projectTasks.assigneeCrewId` set) can now show "logged" minutes from
its own approved time entries: `crewTimeEntries` gains an optional
`workItemId` field (+ `by_workItemId` index) that `createNative`/
`createManyNative`/`updateNative` accept and org-validate
(`assertRefInOrg(ctx, "projectTasks", …)`), and a new query
`crewTimeEntries.loggedMinutesForWorkItems` (gated on `work`, not `crew` — a
work item's own peek needs `work:read`) sums approved minutes per work item.
No UI writes this field yet and none of the approval/dispute/export lifecycle
changes — the field exists so Phase 2's Work tab / work-item peek (design
§8.2 "Estimate · logged") has something to read without another schema
change.

**Call-time reminders.** Off by default per org
(`OrgSettings.crewTime.callReminderEnabled`, Settings → Crew & time).
`sendCrewCallTimeReminders` (`src/lib/crew-time-nudges.ts`), same cron and
dedupe ledger as the offer nudge above, emails each crew member on a
CONFIRMED assignment starting "tomorrow" — resolved in the **org's stored
timezone** (`startOfDayInTimezone`/`endOfDayInTimezone`, `src/lib/quote-validity.ts`,
never the server's clock, POLICY.md R-9.3) — with call time, location and PM
phone (the existing site-contact fields the offer/confirmation emails already
carry). Dedupe key includes the calendar day, so a long-running assignment
still gets a fresh reminder on ITS day-before, not just once ever.

**Deferred to Phase 5.** An overtime estimate at booking time (back-to-back
shifts crossing a crew member's `overtimeMultiplier` threshold) needs the
rate rules ROADMAP §2.1 owns — not built, not stubbed.

## Calendar Integration (Phase 4)

### iCal Feed per Crew Member
- Each crew member can have an iCal feed enabled from their detail page "Calendar" tab
- Feed URL: `GET /api/crew/calendar/[token]` (or `[token].ics`)
- Token is a 32-byte cryptographically random URL-safe base64 string
- No authentication required — the token IS the auth
- **Who can see the token (UX Phase 15):** `icalToken` leaves Convex only through
  the ONE member-row boundary, `memberRowRedactor`
  (`convex/lib/crewMemberRedaction.ts`), on every member read
  (`crewMembers.{list,listPage,getById}`, `crew.memberDetail`). It goes to the
  member themself (the row's linked `userId`) and to a caller with `crew:update`
  (who enables, disables and regenerates links), and only on a USER session — an
  API key / agent never gets it, even acting as such a user. Everyone else gets
  the field absent. The Calendar tab (`CrewIcalFeedCard`,
  `src/components/crew/crew-ical-feed-card.tsx`) builds the URL from
  `memberDetail`'s token, so a plain `crew:read` viewer sees that the feed is on
  but never its URL. The only other crew token, `crewAssignments.responseToken`,
  is stripped for every non-service caller. Tests: `convex/crewReadRedaction.test.ts`,
  `src/components/crew/__tests__/crew-ical-feed-card.smoke.test.tsx`.
- Feed contains all CONFIRMED/ACCEPTED assignments as VEVENT entries by default
- **Per-member opt-in — include pending assignments:** a `Switch` next to the feed URL
  (Calendar tab, `crewMembers.icalIncludeTentative`, default false/absent) also emits
  PENDING/OFFERED assignments — those still awaiting an offer or a crew response. Included
  events are `STATUS:TENTATIVE` (not `CONFIRMED`) with a `(Tentative)` `SUMMARY` prefix and a
  "(Not yet confirmed)" `DESCRIPTION` line, so the distinction survives in any calendar client.
  DECLINED/CANCELLED/COMPLETED assignments never appear, toggle or not. Toggled via
  `setIcalIncludeTentative(crewMemberId, include)` (`crew.update`), read via `getIcalSettings`.
- If shifts exist, one event per shift; otherwise one event per assignment
- Events include: project name, role, phase, location, site contact, notes
- **Project manager projects also appear, even without a crew assignment:** if
  this crew member is linked to a platform user (`crewMember.userId`) and that
  user is a project manager on a project (the `projectManagers` table — added
  via the project detail page's "Project managers" panel, independent of crew
  assignments), the feed includes one additional all-day `VEVENT` per such
  project spanning its full window (`getProjectWindow` — the same "gear
  committed" start/end used for availability, `src/lib/project-window.ts`),
  `SUMMARY:"{project name} (Project Manager)"`, `UID:pm-project-{projectId}@gearflow`.
  This is purely additive — it doesn't replace or dedupe against any
  shift/assignment events the same project may also produce.
- **Cancelled jobs drop off.** Feeds are computed live, so an assignment or PM event whose project is `CANCELLED` is simply not emitted (personal feed, org crew feed `/api/calendar/[token]/crew`, and the per-assignment `.ics` download, which 404s). A deleted project has no rows at all. Calendar clients remove the events on their next poll.
- Token can be regenerated (invalidates old URL) or feed can be disabled
- **Response caching:** `Cache-Control: private, max-age=300` (changed 2026-07-25, R-8.9.3 finding #862 — was `no-cache, no-store, must-revalidate`). Calendar clients (Google/Apple/Outlook) already poll a feed URL on their own multi-minute-to-hourly cadence, not per user action, so a short cache window is safe and avoids re-running the full `getByIcalToken` + assignments + shifts + per-project-lookup chain on every external poll. This is deliberately narrower than the sibling no-cache token-feed routes (`/api/warehouse/display/[token]`, `/api/auditor/[token]`) — those are live status views that must stay uncached; only this feed's pull-based, client-controlled refresh cadence justifies caching.

### Schema Fields (CrewMember)
- `icalEnabled` — Boolean, default false
- `icalToken` — String, unique, nullable
- `icalIncludeTentative` — Boolean, optional, default false — include PENDING/OFFERED
  assignments (as tentative) on this member's feed

### Per-Assignment .ics Download
- API route: `GET /api/crew/calendar/assignment/[id]`
- Requires authentication (session-based)
- Downloads a single .ics file for one assignment
- Available from the assignment row actions dropdown in the project crew panel

### Server Actions (`src/server/crew-calendar.ts`)
| Function | Permission | Description |
|----------|-----------|-------------|
| `enableIcalFeed(crewMemberId)` | crew.update | Enable feed + generate token |
| `disableIcalFeed(crewMemberId)` | crew.update | Disable feed (keeps token) |
| `regenerateIcalToken(crewMemberId)` | crew.update | New token, invalidates old URL |
| `getIcalSettings(crewMemberId)` | org member | Get icalEnabled + icalIncludeTentative only — never the token (it reads with the service identity, so it would bypass the member-row boundary) |
| `setIcalIncludeTentative(crewMemberId, include)` | crew.update | Toggle whether pending/offered assignments show as tentative |
| `getAssignmentIcsData(assignmentId)` | crew.read | Full assignment data for .ics |

### iCal Library (`src/lib/ical.ts`)
- `generateVCalendar(calName, events, tzid)` — RFC 5545 compliant VCALENDAR with VTIMEZONE block for the org's IANA timezone (default `Australia/Sydney`)
- `generateVEvent(event, tzid)` — single VEVENT with TZID-anchored DTSTART/DTEND and UTC DTSTAMP
- `buildDateTime(date, time?, tzid)` — combine date + optional "HH:mm" wall-clock time, interpreted in the given timezone
- Supports all-day events (`allDay: true` → emits `VALUE=DATE`) and timed events (TZID-anchored)
- **Timezone handling:** events are anchored with `TZID=<zone>` plus a hardcoded VTIMEZONE block in the calendar header (Australia/Sydney/Melbourne/Hobart/Adelaide/Brisbane/Perth/Darwin, Pacific/Auckland, Europe/London, America/Los_Angeles/New_York, UTC). Unknown zones fall back to UTC `Z`-form output. Uses `Intl.DateTimeFormat` for tz conversion — no external dep, DST-aware, no server-tz leakage. Org's timezone read from `OrgSettings.timezone` (defaults to Australia/Sydney).

## Communication & Offers (Phase 5)

### Offer Flow
- Admin creates assignment (PENDING) then sends offer via "Send Offer" action
- Status changes: PENDING -> OFFERED (email sent with Accept/Decline links)
- Crew responds via token-based links: OFFERED -> ACCEPTED or DECLINED
- Admin confirms: ACCEPTED -> CONFIRMED (confirmation email sent)
- `responseToken` on CrewAssignment — unique, one-time use, cleared after response
- **The token is service-only.** It is a bearer credential for
  `/api/crew/respond/[token]`, so no `crew:read` caller may ever read it: the
  raw-row reads `crewAssignments.{list,getById,listByProject,listByServiceIds}`
  strip it for every non-service caller (user AND agent), the same way
  `projectCrew`/`plannerData` already did. Respond links are only ever built
  server-side (offer/reminder emails via `src/lib/crew-scheduling-read.ts` and
  the respond route, all on the service token) — never hand the token to the
  browser to build one.
- **Crew pay on those reads is manager+.** `estimatedCost`/`rateOverride` on the
  four assignment reads, `projectCrew` (and its nested member/role rates),
  `crew.memberDetail` and the crew dashboard lists; `defaultDayRate`/
  `defaultHourlyRate` on `crewMembers.{list,listPage,getById}`; the role
  `defaultRate`/`chargeRate` on `crewRoles.{list,listForSettings,getById}`
  (`roleRowRedactor`); and `projectLabourCost` (all-zero shape, its whole
  payload is pay) reach only callers for whom
  `canSeeCrewPay(ctx, orgId)` (`convex/lib/crewPayVisibility.ts`) holds —
  manager+ standing (`isCallerManagerPlus`, re-read from the member row) AND not
  a `noFinancials` API key. The service identity always passes. Field lists are
  ONE definition each: `ASSIGNMENT_COST_FIELDS` (`convex/crewAssignments.ts`) and
  `MEMBER_RATE_FIELDS` (day rate, hourly rate, overtime multiplier) /
  `ROLE_RATE_FIELDS` (cost and charge rate) in `convex/lib/crewPayFields.ts`. Covered by `convex/crewReadRedaction.test.ts` and
  `convex/crewPayGating.test.ts` (member, manager, noFinancials key). The `/crew`
  list's Day rate column is absent unless `crewRoles.ratesVisible` says the
  caller sees pay, and `crewWrites.updateNative` ignores rate set/clear from a
  caller who can't (the stored rates stand, as with role edits, S4).
- **Below the pay line the Logistics service sheet has no role rate** (by
  ruling): `crewRoles.list` returns no `defaultRate`/`chargeRate` to such a
  caller, so the sheet's crew cost preview comes up empty and the charge-rate
  override's hint drops its role-rate part entirely (`RoleRateHint`, gated on
  `crewRoles.ratesVisible`) — never "(none set, so no auto-pricing)", which
  would be a false claim about a rate the caller simply can't see. Pricing
  itself is unaffected — it is computed server-side from the stored rates.
- **Server actions decide pay for their real caller (B-2).** They read Convex
  with the service identity, which always passes `canSeeCrewPay`, so each one
  that returns crew pay calls `callerSeesCrewPay()` (`src/lib/crew-pay-caller.ts`,
  the same `crewPayVisible`; an API-key actor is noFinancials):
  `exportTimesheetCSV`, `getProjectServices` (`redactServiceCrewPay`: each call's
  `estimatedCost`, `rateOverride` and `resolvedRate` are ABSENT, and the Logistics
  crew row — service child and People view — then has no cost cell) and
  `getAssignmentIcsData` (crew:read, never `responseToken`). Below the pay line a
  service save keeps each call's stored `rateOverride`/`rateType`
  (`crewRateInputs`). `buildAssignmentEmailData` (the full row, token and pay)
  moved out of the `"use server"` file to `src/lib/crew-assignment-email-data.ts`:
  as an exported action it was callable from any session with no authz.

### Email Templates (`src/lib/crew-emails.ts`)
- `crewOfferEmail` — project details + Accept/Decline buttons
- `crewConfirmationEmail` — confirmed assignment details
- `crewCancellationEmail` — cancellation notice
- `crewUpdateEmail` — updated assignment details
- `crewBulkMessageEmail` — freeform message with project context

### Server Actions (`src/server/crew-communication.ts`)
| Function | Permission | Description |
|----------|-----------|-------------|
| `sendCrewOffer(assignmentId)` | crew.update | Send offer email, set status to OFFERED |
| `sendCrewOfferAll(projectId)` | crew.update | Offer all PENDING assignments |
| `sendConfirmationEmail(assignmentId)` | crew.update | Send confirmation email |
| `sendCancellationEmail(assignmentId)` | crew.update | Send cancellation email |
| `sendBulkMessage(projectId, message, filter?)` | crew.update | Email all active crew on project |

**Phase 6b — durable email side-effects.** The offer/confirmation/cancellation
sends route through `deliverSideEffectEmail()` (`src/lib/email-side-effect.ts`).
When `NATIVE_EMAIL_SIDEEFFECTS=true`, the send is enqueued on the Convex durable
scheduler (`api.emails.enqueue` → `internal.emailActions.deliver`) — off the
request path, retry-safe via a `sentEmails` idempotency ledger keyed on the offer
token (or a per-send nonce for confirm/cancel). Default OFF → inline `sendEmail()`
as before. Requires `RESEND_API_KEY` + `EMAIL_FROM` on the Convex deployment to
actually deliver. `sendBulkMessage` and the org/settings/SSO admin sends are a
mechanical follow-up (same helper).

### API Routes
- `GET /api/crew/respond/[token]?action=accept|decline` — Public, token-based response page
- Returns styled HTML confirmation page after updating assignment status

### UI Integration
- **Per-assignment**: "Send Offer" in row actions dropdown (only for PENDING)
- **Bulk**: "Offer All" button (sends to all PENDING with email), "Message" button opens dialog
- **Middleware**: `/api/crew/respond/` added to public routes (no auth required)

## Permissions
Resource `crew` with actions: `read, create, update, delete`
- owner/admin: all
- manager: create, read, update
- member/staff/warehouse/viewer: read

Since `crew:create`/`crew:update` are manager+-only, the Crew roles & rates
sheet's write surface (`crewRolesWrites.ts`) is already manager+-only in practice —
every role can VIEW the sheet (`crew:read`), but the cost (`defaultRate`) and
charge (`chargeRate`) rate columns render only when `crewRoles.ratesVisible`
(`canSeeCrewPay`) says so, server-enforced via `crewRoles.ts`'s `listForSettings`
query (field-stripped for non-manager+ callers — the plain `list` query, used by
cost-preview call sites elsewhere, is unchanged).

All read server actions enforce `requirePermission("crew", "read")` —
including `getCrewMembers`, `getCrewMemberById`, `getCrewRoles`,
`getCrewSkills`, `getCrewRoleOptions`, `getCrewSkillOptions`,
`getCrewDepartments`. `getOrgUsersForCrewLink` requires `update` since
its only purpose is to populate the link-to-user picker. The lone
exception is `getMyCrewMemberId`, which uses `getOrgContext()` so a
user can always look up their own crew profile regardless of crew
read permission.

## Crew Dashboard (`convex/crewDashboard.ts`)
- Manager/admin/owner only — users with `crew.update` permission see the dashboard; others see the crew table
- **Stats**: active crew, assignments, pending offers, submitted timesheets, hours (7d), expiring certs
- **Read pattern (R-9.8)**: `crewAssignments` has a `by_organizationId_status` compound index — `stats`/`activeAssignmentsSummary`/`pendingOffers` query it per-status (`assignmentsByStatus()`) instead of collecting every assignment in the org and filtering in JS; `crewTimeEntries` already had the equivalent index, used the same way for `stats`'s submitted/hours-this-week counts. `crewLookups()` (members/roles/projects) stays a full per-org collect — those are roster/fleet-scale tables, not transaction-volume ones — and `allOrgAssignments()` (shared by `pickerList`'s full per-member history and `upcomingShifts`'s assignment-id scoping, since `crewShifts` has no `organizationId` column) also stays full-collect by necessity. Both are registered §15 exceptions, not bare comments — see `docs/exceptions.md` (R-8.3.3 `crewDashboard-lookups` / `crewDashboard-fullAssignments`).
- **Four list boxes** (pending timesheets, active assignments, upcoming shifts, pending offers) use a shared `DashboardListCard`: fixed header (title + count chip + optional action) over a **height-capped, internally scrolling body** (`max-h-[19rem] overflow-y-auto`). Caps each box so a long list (e.g. lots of pending offers) can't grow to swallow the page and hide its siblings; all four stay balanced. Error / loading / empty states handled inside the card.
- **Pending Timesheets**: approve/dispute individual or bulk from dashboard
- **Active Assignments**: links to project detail
- **Upcoming Shifts**: next 10 scheduled shifts, consecutive shifts for same assignment grouped as date ranges
- **Pending Offers**: send offer directly from dashboard
- **Log Time**: multi-select crew member dialog, then time entry form with Project/General toggle
- **Export Timesheets**: dialog with date range picker, downloads CSV
- **Crew List**: embedded crew table at the bottom

## Integration Points
- **Sidebar**: "Crew" with HardHat icon and ONE sub-item, Planner (`moreLabel` "Planner & timesheets"); Timesheets is the Crew page's head word and `/crew/timesheets` a `NOT_IN_NAV` deep link (D48). Gated by `crew` resource
- **Top bar**: `crew`, `timesheets`, `planner` segment labels
- **Page commands**: searchable crew page with children (Planner, Timesheets, Crew roles & rates → `/crew/planner?sheet=roles`)
- **Global search**: searches first/last name, email, phone, department, role name, tags
- **Slash commands**:
  - `/crew` list page: `/new`, `/planner`, `/timesheets`, `/roles`, `/log-time`, `/export`
  - `/crew/[id]` detail page: `/edit`, `/assignments`, `/availability`, `/certifications`, `/time`, `/calendar`, `/add-availability`, `/add-cert`, `/log-time`
  - `/crew/timesheets` page: `/log-time`, `/export`
- **Notifications**: expiring certifications (30 days), pending crew offers, submitted timesheets awaiting approval
- **Dashboard**: active crew count and pending crew offers shown in main dashboard stats
- **Activity log**: CREATE/UPDATE/DELETE logged for crew members, roles, assignments, and availability

## Validation Schemas (`src/lib/validations/crew.ts`)
- `crewMemberSchema` — full member form
- `crewRoleSchema` — role form
- `crewSkillSchema` — skill creation
- `crewCertificationSchema` — certification form
- `crewAssignmentSchema` — project assignment form
- `crewShiftSchema` — individual shift form
- `crewAvailabilitySchema` — availability block form

## Status Labels (`src/lib/status-labels.ts`)
- `crewMemberStatusLabels`, `crewMemberTypeLabels`, `crewCertStatusLabels`
- `crewRateTypeLabels`, `assignmentStatusLabels`, `phaseLabels`, `shiftStatusLabels`
- `availabilityTypeLabels`, `timeEntryStatusLabels`

## Time Tracking (Phase 6)

### Data Model — `CrewTimeEntry`
- `id, organizationId, assignmentId? (optional — null for general shifts), crewMemberId`
- `description?` — freeform label for standalone shifts (e.g. "Warehouse maintenance")
- `date, startTime, endTime, breakMinutes, totalHours?`
- `status` — DRAFT, SUBMITTED, APPROVED, DISPUTED, EXPORTED
- `approvedById?, approvedAt?, notes?`
- Indexes: `[organizationId]`, `[assignmentId]`, `[crewMemberId, date]`

### Status Flow
```
DRAFT → SUBMITTED → APPROVED → EXPORTED
                   → DISPUTED → (edit) → DRAFT
```

### Server Actions (`src/server/crew-time.ts`)
| Function | Permission | Description |
|----------|-----------|-------------|
| `getTimeEntriesForMember(crewMemberId)` | crew.read | All time entries for a crew member |
| `getTimeEntriesForProject(projectId)` | crew.read | All time entries for a project |
| `createTimeEntry(data)` | crew.create | Log time entry, auto-calculates totalHours |
| `updateTimeEntry(id, data)` | crew.update | Edit (only DRAFT/DISPUTED entries) |
| `deleteTimeEntry(id)` | crew.delete | Delete (only DRAFT entries) |
| `submitTimeEntries(ids)` | crew.update | Batch DRAFT → SUBMITTED |
| `approveTimeEntries(ids)` | crew.update | Batch SUBMITTED → APPROVED |
| `disputeTimeEntry(id, reason?)` | crew.update | SUBMITTED → DISPUTED |
| `exportTimesheetCSV(filters?)` | crew.read | CSV export with date/project/member filters |

### API Routes
- `GET /api/crew/timesheet?dateFrom=...&dateTo=...&crewMemberId=...&projectId=...` — CSV download

### UI
- **Crew detail page**: "Time" tab with table of all entries, add/edit dialog, bulk submit/approve buttons, CSV export
- **Log Time dialog**: Toggle between "Project" (linked to assignment) and "General" (standalone shift with description)
- **Actions per entry**: Edit (DRAFT/DISPUTED), Submit (DRAFT), Approve (SUBMITTED), Dispute (SUBMITTED), Delete (DRAFT)

### Query…, exact Undo, and pay (UX Phase 15 — D47, D49)

**Query (D47).** The UI word for `DISPUTED` is **Queried** (status) / **Query…**
(verb); the enum and API values are unchanged (`docs/glossary.md`). A query
carries its reason on **`crewTimeEntries.queryReason`** — never on `notes`, which
is the crew member's own text. `crewTimeEntriesWrites.queryNative({ ids, reason })`
moves SUBMITTED/APPROVED entries to DISPUTED; the reason is required and bounded
(`QUERY_REASON_MAX` = 500, `convex/lib/timeEntryQuery.ts`, shared with
`timeEntryQuerySchema`). A queried entry is no longer approved: Query clears
`approvedById` / `approvedAt` (the dialog says "an approved entry loses its
approval"), and `revertNative` of a query restores that stamp exactly from the
recorded prior state. `submitNative` and `approveNative` clear `queryReason`.
The legacy single-entry `disputeNative` (crew dashboard, crew record) is
unchanged until Phase 13 moves those surfaces to Query….

**One activity row per entry, one exact Undo.** Submit, Approve and Query write
an activity row PER changed entry (`${auditId}:${entryId}`) whose `metadata`
records the entry's prior state (`kind: "time_entry_transition"`, `transition`,
`prevStatus`, and any prior `queryReason` / approver stamp). Each returns
`{ count, changed }`; the hook adds the call's `stamp` (its `now`).
`revertNative({ ids, stamp })` is the ONE Undo for all three: it takes ONLY
the ids and the stamp — no transition, no prior status. For each entry it reads
which transition ran and the prior state back from the forward write's own row
(same entry, same stamp, same user, the row whose transition produced the
entry's current status), and refuses the whole Undo (`ConvexError`) if any
entry's `updatedAt` no longer equals the stamp, so a second Undo of the same
write refuses too. Never pass prior state from the client.

**Pay (D49).** `crewTimeEntries.allEntries` adds, per row, `rate` / `rateType` /
`total` / `rateIncluded`, plus `totals.pay` over the filtered set — **only when
`canSeeCrewPay`** (`convex/lib/crewPayVisibility.ts`: manager+ and not a
`noFinancials` key); otherwise those keys are absent and `payVisible: false`.
Everyone gets `counts` (per status, for the strip), `totals.hours`,
`queryReason` and `updatedAtMs` (the next Undo's stamp). The money is DERIVED
in `convex/lib/timeEntryMoney.ts`, never stored:
- **Rate** = the PAY (cost) cascade `resolveRate` — assignment override →
  member day → member hourly → role default (a general entry uses the member's
  own role). Nothing resolved ⇒ blank, never `$0`. The UI labels it "Rate (pay)".
- **Total** = `HOURLY` rate × hours; `DAILY` the day rate **once per person per
  calendar day**, however many entries that day has (the earliest carries it,
  the rest are `rateIncluded`); `FLAT` once per person per assignment.
- The carrier is computed over every org entry, so paging and filters never
  move it.

The same gate redacts pay elsewhere: `crewAvailability.plannerData` drops
`rateOverride` / `estimatedCost` below manager, and
`crewAssignments.membersForAssignment` returns `defaultDayRate` /
`defaultHourlyRate` as `null` below manager, and `crewDashboard.pickerList` (the
Log time picker) drops each call's `rateOverride` / `estimatedCost` below manager.
Every `crewDashboard` read also strips the single-use offer `responseToken` (a
bearer credential) in its one `isoAssignment` helper.

**CSV.** `exportTimesheetCSV` builds through `src/lib/timesheet-csv.ts` →
`toCsv` (`src/lib/csv.ts`, formula-injection guard). The twelve original
columns keep their order and the raw status enum; `Query reason` is appended,
and `Rate (pay)` / `Total` only for a signed-in manager+ (never an API-key
actor), from the same `deriveEntryMoney`.

## Future Phases (not yet implemented)
- Phase 7: Crew portal

### Service schedule → crew schedule sync
A service's date / start / end / scheduled time is the schedule of every crew assignment linked
to it. `projectServicesWrites.updateServiceNative` now pushes a *changed* schedule onto each
linked assignment (`startDate/endDate/startTime/endTime`, `estimatedCost` recomputed, service
cost/charge rolled up) and re-times the assignment's `SCHEDULED` `crewShifts` (a shift on a
surviving day keeps its own location/notes; new days get a shift; dropped days lose theirs; worked
or cancelled shifts and shift-less assignments are untouched). An unrelated save (rename, price)
does not rewrite crew times — only an actual schedule change does.
