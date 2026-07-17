# Crew Management

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
- `defaultRate?, rateType?` (HOURLY | DAILY | FLAT)
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
- `phase?` — BUMP_IN, EVENT, BUMP_OUT, DELIVERY, PICKUP, SETUP, REHEARSAL, FULL_DURATION
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

### `src/server/crew.ts` (Phase 1)
| Function | Permission | Description |
|----------|-----------|-------------|
| `getCrewMembers(params)` | crew.read | Paginated list with search, filters, sorting |
| `getCrewMemberById(id)` | crew.read | Full detail with role, skills, certifications |
| `createCrewMember(data)` | crew.create | Create with skill connections |
| `updateCrewMember(id, data)` | crew.update | Update with skill set replacement |
| `deleteCrewMember(id)` | crew.delete | Delete crew member |
| `getCrewRoles()` | crew.read | All active roles |
| `createCrewRole(data)` | crew.create | Create role |
| `updateCrewRole(id, data)` | crew.update | Update role |
| `deleteCrewRole(id)` | crew.delete | Delete (fails if assigned) |
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

### `src/server/crew-assignments.ts` (Phase 2)
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

### `src/server/crew-availability.ts` (Phase 3)
| Function | Permission | Description |
|----------|-----------|-------------|
| `getCrewAvailability(crewMemberId, start?, end?)` | crew.read | Availability blocks for a member |
| `addAvailability(data)` | crew.update | Add availability block |
| `removeAvailability(id)` | crew.update | Remove availability block |
| `checkCrewConflicts(crewMemberId, start, end, excludeId?)` | crew.read | Conflict detection (availability + assignments) |
| `getCrewPlannerData(start, end)` | crew.read | All crew with assignments/availability in range |
| `getCrewAvailabilityStatus(ids[], start, end)` | crew.read | Status map for visual indicators |

## Rate Cascade
Assignment rate is resolved in this order:
1. `rateOverride` on the assignment (if set and > 0)
2. `crewMember.defaultDayRate` (daily) or `crewMember.defaultHourlyRate` (hourly)
3. `crewRole.defaultRate` (with role's rate type)
4. Fallback: $0 daily

## Cost Calculation
- **DAILY**: rate × number of days (start to end inclusive)
- **HOURLY**: rate × estimatedHours
- **FLAT**: rate (fixed amount)

## Pages
| Path | Component | Description |
|------|-----------|-------------|
| `/crew` | CrewDashboard / CrewTable | Manager+ sees dashboard with stats, timesheets, assignments, offers; others see crew list |
| `/crew/new` | CrewMemberForm | Create crew member |
| `/crew/[id]` | Detail page | Profile picture (upload/remove), contact, rates, skills, assignments (with status management), availability, certifications, time entries, calendar, linked user display |
| `/crew/[id]/edit` | CrewMemberForm | Edit crew member (includes user account linking) |
| `/crew/planner` | CrewPlannerPage | 14-day Gantt-style timeline of all crew |
| `/crew/timesheets` | TimesheetsPage | All time entries with DataTable, filtering, search, edit/delete, export |
| `/crew/settings` | CrewSettingsPage | Manage roles and skills |

**CrewTable data source (2026-07, perf fix):** server-side paginated —
`crewMembers.listPage` (filter/sort/crewRole join done in Convex) via
`useAuthedQuery`, replacing whole-org `useCrewMembers`/`useCrewRoles` live
subscriptions that filtered/joined/sorted client-side. See
`docs/designs/perf-convex-efficiency-2026-06.md` Finding #1. The linked platform
user (Better Auth, cross-domain) stays a separate merge applied after the paginated
fetch — search no longer matches the linked user's display name, only this table's
own fields (a narrow, disclosed tradeoff since Convex can't join Better Auth data).
`icalToken` redaction for non-service callers carries over unchanged.

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
- **Crew tab** on project detail page (`/projects/[id]`) via `CrewPanel` component
- Assignment list with phase grouping, PM highlighting
- Add/edit assignment dialogs with crew picker, role, phase, dates, rate override
- Status dropdown (Pending → Offered → Accepted → Confirmed → Completed)
- **Labour cost** shown in project financial summary
- **Call Sheet** button in crew tab and Documents dropdown

## Call Sheet PDF
- `src/lib/pdf/call-sheet-pdf.tsx` — landscape A4 document
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

## Crew Planner
- 14-day Gantt-style timeline at `/crew/planner`
- Shows all active crew with their assignments and availability blocks
- **At-a-glance strip** above the board (single surface, vertical dividers): crew on roster, booked today, free today, off today — computed client-side from the loaded data
- **Filter / search bar**: free-text search (name, role, department, project), plus crew-member, project, and availability-status (`Booked` / `Unavailable` / `Tentative` / `Preferred`) Selects. All filtering is **client-side** over the already-loaded planner data — no server round-trip. "N of M shown" counter + Clear button when any filter is active. Picking a project filter highlights matching assignment chips (red ring) and dims non-matching ones; a dedicated "no crew match these filters" empty state appears when filters exclude everyone.
- Day cells render labelled status **chips** (project number / `N×` / `Off` / `Tent.` / `Pref.`) via `status-colors`, not bare dots: primary red (assignment), `t-out` (unavailable), warn (tentative), ok (preferred). Blank cell = no plans. On-fill text follows §3.7 (`text-white` on the red assignment fill).
- Sticky crew name column with per-row `Nd` booked-days chip; circular today pill in the header; weekend columns tinted
- Tooltip on hover showing project details or availability reason
- Navigation: back/forward by week, "Today" button
- Sidebar: "Planner" link under Crew

## Calendar Integration (Phase 4)

### iCal Feed per Crew Member
- Each crew member can have an iCal feed enabled from their detail page "Calendar" tab
- Feed URL: `GET /api/crew/calendar/[token]` (or `[token].ics`)
- Token is a 32-byte cryptographically random URL-safe base64 string
- No authentication required — the token IS the auth
- Feed contains all CONFIRMED assignments as VEVENT entries
- If shifts exist, one event per shift; otherwise one event per assignment
- Events include: project name, role, phase, location, site contact, notes
- Token can be regenerated (invalidates old URL) or feed can be disabled

### Schema Fields (CrewMember)
- `icalEnabled` — Boolean, default false
- `icalToken` — String, unique, nullable

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
| `getIcalSettings(crewMemberId)` | crew.read | Get icalEnabled + icalToken |
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

All read server actions enforce `requirePermission("crew", "read")` —
including `getCrewMembers`, `getCrewMemberById`, `getCrewRoles`,
`getCrewSkills`, `getCrewRoleOptions`, `getCrewSkillOptions`,
`getCrewDepartments`. `getOrgUsersForCrewLink` requires `update` since
its only purpose is to populate the link-to-user picker. The lone
exception is `getMyCrewMemberId`, which uses `getOrgContext()` so a
user can always look up their own crew profile regardless of crew
read permission.

## Crew Dashboard (`src/server/crew-dashboard.ts`)
- Manager/admin/owner only — users with `crew.update` permission see the dashboard; others see the crew table
- **Stats**: active crew, assignments, pending offers, submitted timesheets, hours (7d), expiring certs
- **Four list boxes** (pending timesheets, active assignments, upcoming shifts, pending offers) use a shared `DashboardListCard`: fixed header (title + count chip + optional action) over a **height-capped, internally scrolling body** (`max-h-[19rem] overflow-y-auto`). Caps each box so a long list (e.g. lots of pending offers) can't grow to swallow the page and hide its siblings; all four stay balanced. Error / loading / empty states handled inside the card.
- **Pending Timesheets**: approve/dispute individual or bulk from dashboard
- **Active Assignments**: links to project detail
- **Upcoming Shifts**: next 10 scheduled shifts, consecutive shifts for same assignment grouped as date ranges
- **Pending Offers**: send offer directly from dashboard
- **Log Time**: multi-select crew member dialog, then time entry form with Project/General toggle
- **Export Timesheets**: dialog with date range picker, downloads CSV
- **Crew List**: embedded crew table at the bottom

## Integration Points
- **Sidebar**: "Crew" with HardHat icon, sub-items: Planner, Timesheets, Roles & Skills. Gated by `crew` resource
- **Top bar**: `crew`, `timesheets`, `planner` segment labels
- **Page commands**: searchable crew page with children (Planner, Timesheets, Roles & Skills)
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

## Future Phases (not yet implemented)
- Phase 7: Crew portal
