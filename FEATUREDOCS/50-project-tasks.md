# Project Tasks (Asana-style to-do lists)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Per-project task lists so operators can track project work inside RVLT Flow instead of
external tools (Asana, Slack threads). Each project gets a **Tasks** tab, and every user gets
a cross-project **`/my-tasks`** view of everything currently assigned to them (see below).

## Data model
`ProjectTask` (`project_task`):
- `organizationId`, `projectId` (both FK, cascade delete with the project)
- `title`, `description?`
- `status` — `ProjectTaskStatus` (`TODO | IN_PROGRESS | DONE`), default `TODO`
- `priority` — `ProjectTaskPriority` (`LOW | NORMAL | HIGH`), default `NORMAL`
- `dueDate?`
- `sortOrder` — manual ordering within a project's list
- `checklist?` — JSON array of `{ id, text, done }` sub-steps (inline, not a table)
- `assigneeUserId?` / `assigneeCrewId?` — at most one; a task is assigned to either an org
  user OR a crew member. Both FKs are `onDelete: SetNull` so deleting the person keeps the task.
- `createdById?`, `completedAt?` (set when status enters `DONE`, cleared when it leaves)

Indexes: `(organizationId, projectId)`, `(projectId, status)`, `(assigneeUserId, status)`,
`(assigneeCrewId, status)` (added for `myOpenTasks`, below — mirrors the user-id index so a
crew-assigned task's open status can be range-scanned the same way).
Migration: `20260606000000_project_tasks`.

### Work-layer Phase 1 (#1243) — schema widening, not a rewrite
`projectTasks` is the ONE table the work layer (Today, per-project tasks, personal
follow-ups) reads and writes — Phase 1 widens it additively rather than introducing a
parallel `workItems` table, per the design doc's explicit "one table" decision:
- `projectId` is now `v.optional(v.string())` — personal/client-scoped work has no
  project. Every pre-Phase-1 row still has it set; nothing back-fills existing rows to
  optional, the column just now permits absence going forward.
- `kind` (`ProjectTaskKind` — `task | follow_up`, absent = `task`), `stage`
  (`ProjectTaskStage` — `quote | prep | load_in | show | return | close`, see
  `convex/lib/workVocabulary.ts`'s `defaultStageForProjectStatus`), `parentId` (one level
  of subtasks — the new, structured replacement for `checklist`, which is kept for exactly
  one release after the backfill migration ships, then dropped — expand/contract, Convex
  functions deploy ahead of the app image).
- Scheduling: `startDate` (org-tz midnight — the opening end of a **span**, see
  "The composer" below; it does NOT hide or defer the row, despite what its original
  Phase-1 comment claimed), `dueTime` (`"HH:mm"`
  in the org timezone), `scheduledStart`/`scheduledEnd` (the agenda block Today renders),
  `snoozedUntil`, `estimateMinutes`, `tags` (free-form strings, no tag table).
- `sourceKey` — deterministic identity for a system-created or promoted row, naming the
  underlying entity: set when a human promotes a derived Triage signal (e.g.
  `"quote:expiring:<quoteId>"`, the join key back to `workSignalStates` below), by template
  seeding (`"template:<key>:<status>"`), and by the follow-up engine
  (`"quote:nonext:<quoteId>"`, [FEATUREDOCS/82](./82-follow-up-automation.md)).
- `automation` — set ONLY on rows the follow-up engine owns (FEATUREDOCS/82): rule, subject,
  rung, loop start, urgency, why, human-locked fields, resolution. Its presence routes a
  human's edit/close/delete of the row back through `reconcileFollowUps` (DONE advances or
  ends the ladder; delete becomes a soft `CANCELLED` tombstone; edited fields are locked).
- `isPrivate`, `templateId` (set when seeded from a `workTemplates` row on a project
  lifecycle transition — see the tracking issue's §8.2; the seeding mutation itself is a
  later Phase 1 slice, not yet built).

New indexes: `by_organizationId_assigneeUserId_status` / `by_organizationId_assigneeCrewId_status`
(org-PREFIXED — the pre-existing `by_assigneeUserId_status`/`by_assigneeCrewId_status` are
global indexes and must stay org-re-checked in-handler per R-8.4.3; the new composite pair
exists so a future read can scope at the index level instead), `by_organizationId_status_dueDate`,
`by_parentId` (subtask lookup), and `search_title` (title search, filtered to `organizationId`).

**`workSignalStates`** (new table) records a human's decision — snoozed / dismissed /
promoted — about a DERIVED Triage signal. Nothing else about a signal is ever stored: the
signal itself is computed on read from other tables (quotes, crew offers, etc.), and this
table exists only so that decision survives across reads. Rows are per-user
(`by_organizationId_userId_sourceKey`) — one PM dismissing a signal never hides it from
another. `promotedWorkItemId` is set when a signal is promoted into a real `projectTasks`
row. No operations file exists for it yet (`convex/projectTasksSchemaPhase1.test.ts` pins
the shape directly via `ctx.db`) — wiring lands with Today's snooze/promote UI, a later
Phase 1 slice.

**Subtasks never appear as flat siblings.** `listByProject`, `listByProjectWithRelations`,
and `myOpenTasks` all exclude rows with `parentId` set — a subtask renders only nested
under its parent (in a later Phase 1 slice; today's UI doesn't show subtasks at all yet).
This must ship BEFORE the checklist→subtask backfill migration runs, per the design doc's
explicit ordering rule, so a freshly-backfilled subtask never briefly appears as a
top-level row. `getById` is unfiltered (a single-doc fetch, needed to open a subtask
directly once the nested UI exists). The project-delete cascade
(`convex/projectWrites.ts` `deleteNative`/`deleteTemplateNative`) already deletes every
`projectTasks` row for a project unconditionally, so parent and subtask rows are removed
together with no extra code — pinned by a subtask row in
`convex/projectWrites.test.ts`'s full-cascade test. `duplicateNative` never copies tasks
at all (parent or child), so there's no clone-time subtask concern either.

**Checklist → subtask backfill.** `convex/backfillChecklistSubtasks.ts`
(`backfillChecklistSubtasksPage`, SERVICE-only, paginated, `apply=false` dry-run) creates
one child `projectTasks` row per non-empty `checklist` item on a parent that doesn't
already have a subtask — status from the item's `done` flag, `sortOrder` preserving
checklist order, `organizationId`/`projectId` inherited from the parent, and the
checklist item's own `id` PRESERVED as the new row's id (design doc §10.4's explicit
acceptance criterion — ids are client-generated via `crypto.randomUUID()`, already
globally unique; a fresh id is generated only if one is missing or already taken by an
unrelated row). `completedAt` for an already-done item is the parent's own `updatedAt`
(when the checklist was last saved), not migration time. Idempotent (skips a parent that
already has any subtask); never touches/clears the parent's `checklist` field itself
(that stays for exactly one release after this ships, then a separate follow-up drops
it — expand-contract). Driver:
`scripts/convex-backfill-checklist-subtasks.ts`. **Not executed against production from
this repo/session** — a human runs the driver with real Convex credentials once the
peek-panel subtask UI (a later Phase 1 slice) exists to render the migrated rows; running
it today would already be safe (the flat readers above exclude `parentId` rows), there's
just nothing yet that shows them.

**A signal's human decision — `workSignalStatesWrites.ts`.** Browser-direct,
USER-scoped writes (`requireSelfScope`, mirrors `notificationsWrites.ts`'s posture): a row is
owned by the `(organizationId, userId)` baked into the verified token, so a caller only ever
touches their own decisions in their active org.
- `snoozeSignalNative(sourceKey, snoozedUntil)` / `dismissSignalNative(sourceKey)` —
  upsert on `(orgId, userId, sourceKey)`: one row per person per signal, re-snoozing just
  updates it. Danger `low`.
- `promoteSignalNative(sourceKey, title, projectId?, assigneeUserId?, assigneeCrewId?,
  dueDate?, priority?)` — materialises a derived Triage signal (design doc §9) into a real
  `projectTasks` row AND records the `promoted` decision in ONE transaction, so a signal can
  never end up "promoted" with no row to show for it. Assignee defaults to the promoting
  user unless an explicit `assigneeUserId`/`assigneeCrewId` is given (the crew case clears
  the self-default so the existing user↔crew XOR, shared from `projectTasksWrites.ts`'s
  `assertAssigneeInOrg`, is never violated by the default itself). Audited exactly like
  `createNative` (`entityType: "ProjectTask"`). Danger `medium` — same tier as
  `createNative`, since it creates a real, org-visible work item.

Reading which signals exist and computing them live (never stored — design doc §9) is
`dashboardLists.needsYou`, extended in Phase 1 to subtract these decisions — see
[FEATUREDOCS/79](./79-today.md) alongside the Today UI that consumes it.

**Work templates — seeded on CONFIRMED.** `convex/lib/workTemplateSeeding.ts`'s
`maybeSeedWorkTemplates` creates real `projectTasks` rows when a project ENTERS a
lifecycle status (design doc §8.2) — called ONCE at the end of both paths that can
reach `CONFIRMED`: `projectWrites.ts`'s `updateStatusNative` (manual) and
`projectAutoStatus.ts`'s `maybeAutoAdvanceProjectStatus` (the `PAYMENT_SETTLED` auto
rule) — same call-site discipline as the rest of `projectAutoStatus.ts` (once, at the
end, never in a loop, never before the status write lands). Only `CONFIRMED` is wired
(the design doc's only worked example).

- An org's own `workTemplates` rows (schema table, org-scoped, `isActive`-filterable)
  win when any exist for `(orgId, triggerStatus)`; otherwise `DEFAULT_CONFIRMED_TEMPLATES`
  — the design doc's five worked examples verbatim ("Send deposit invoice", "Book
  crew", "Confirm venue access", "Truck pack", "Chase balance") — are used. **No admin
  UI writes `workTemplates` yet** (a later phase) — the table exists now so a future
  settings screen has somewhere to write without another schema change.
- Each template's `offsetFrom` is `"trigger"` (relative to the moment it seeds — an
  immediate admin follow-up like the deposit invoice), `"rentalStart"`, or
  `"rentalEnd"` (relative to the event itself — design doc §8.2's "event −5d"
  phrasing). A `rentalStart`/`rentalEnd` template whose base date isn't set yet is
  still seeded, just with no `dueDate` — never silently dropped.
- **Idempotent per `(project, template key, triggerStatus)`** via `sourceKey`
  (`template:<key>:<triggerStatus>`) — a project re-crossing into CONFIRMED (a revert
  then re-confirm) is never reseeded. `templateId` is also stamped on the row.
- **Assignee is the PM** (design doc's rule): `projects.projectManagerId`, else the
  earliest `projectManagers` row, else unassigned — an unassigned seeded item shows in
  the project's future Work card (Phase 2), not in anyone's Today.

**RBAC — `work:read`/`work:update` OR `project:read`/`project:update`.** A new `work`
permissions resource was added additively to `permissionsCore.ts` (owner/admin/manager:
full CRUD; member/warehouse: create/read/update; viewer: read). Every task read
(`getById`, `listByProject`, `assignees`, `listByProjectWithRelations`, `myOpenTasks`) and
every browser-direct write (`createNative`, `updateNative`, `deleteNative`,
`bulkUpdateNative`, `bulkDeleteNative`) accepts EITHER scope, via a same-file
`requireWorkOrProjectRead`/`requireWorkOrProjectUpdate` helper that tries `work:*` first and
falls back to `project:*`. This is required, not cosmetic: `apiKeys.scopes` is a frozen
stored string never re-validated after mint/OAuth-consent, so an already-issued key that
only ever knew about `project:read`/`project:update` must keep authorising task operations
after `work` exists. Regression coverage:
`convex/projectTasksWorkScopeTransition.test.ts` (an old project-only key, a new work-only
key, and a key with neither all exercised against both a read and `createNative`).

## Convex functions (formerly `src/server/project-tasks.ts`, now deleted)

Reads in [`convex/projectTasks.ts`](../convex/projectTasks.ts); browser-direct writes in
[`convex/projectTasksWrites.ts`](../convex/projectTasksWrites.ts), called via
`src/hooks/use-project-tasks-writes.ts`. As of work-layer Phase 1 (#1243), reads and writes
gate on `work:read`/`work:update` OR `project:read`/`project:update` — see the RBAC
transition note under "Data model" above.
- `listByProjectWithRelations(projectId, orgId)` — ordered by `sortOrder`, then `createdAt`;
  includes assignee + creator. (`getProjectTasks`)
- `assignees(orgId)` — org members (users) + active crew, for the assignee picker. (`getTaskAssignees`)
- `createNative(...)` — validates project ∈ org and assignee ∈ org, appends to the end
  (`max(sortOrder)+1`), sets `completedAt` if created as `DONE`. (`createProjectTask`)
- `updateNative(id, ...)` — partial update; manages the `completedAt` transition both directions.
  (`updateProjectTask`)
- `deleteNative(id)`. (`deleteProjectTask`)
- `bulkUpdateNative` / `bulkDeleteNative` — batched Phase 4 bulk ops, see
  [FEATUREDOCS/59](./59-bulk-operations.md).
- `reorderMany(orgId, orderedIds)` in `convex/projectTasks.ts` — writes each row's `sortOrder` to
  its index, scoped to org (a foreign id can't be reordered in). Still `requireService`-gated
  (not yet browser-direct) and has no production caller — matches the "Drag-and-drop reordering"
  follow-up below; only exercised by `convex/review2Bulk.test.ts`.
- `myOpenTasks(orgId, now)` — cross-project "my tasks" read (#952 / QW-3), backing both
  `/my-tasks` and the dashboard's tasks-due block (see [FEATUREDOCS/06](./06-pages-layouts.md)
  and the dashboard section of `DESIGN.md`). `requireOrgRead` + a user token (mirrors
  `dashboardLists.blocking`'s auth shape rather than inventing a new one). Union of this user's
  directly-assigned OPEN tasks (`by_assigneeUserId_status`) and their crew-assigned OPEN tasks
  (`by_assigneeCrewId_status`, crew ids resolved via `crewMembers.by_userId`), de-duped by task
  id. Both source indexes are GLOBAL (span every org) — every row is re-checked against `orgId`
  in-handler before use. Sorted overdue → due asc (undated last) → priority, bounded to 100.
  `now` is client-passed and minute-bucketed (dashboard convention — Convex queries can't read
  the clock); dates come back epoch-ms, not the ISO strings `listByProjectWithRelations` returns.
  Tests: `convex/projectTasks.myOpenTasks.test.ts`.

Every mutation writes its own audit row via `writeActivityLog` (Convex's `logActivity` counterpart)
with `entityType: "ProjectTask"` and the `projectId`. `/activity`'s `entityTypeLabels` map
(`src/app/(app)/activity/page.tsx`) gained a `ProjectTask: "Task"` entry (work-layer phase 0,
#1241) — until then these rows rendered the raw `"ProjectTask"` string in the Type column and
were unfilterable, since `filterOptions` is built from that map.

## UI (`src/components/projects/tasks-panel.tsx`)
Quick-add input (Enter to add a TODO), tasks grouped by a "Group by" selector (status / stage /
assignee / due — `buildTaskSections` in this file, pure and unit-tested), each row with a status
toggle (circle → in-progress dot → done check), priority dot, due-date badge (red when overdue
and not done), checklist progress (`n/m`), and assignee avatar. A row dropdown edits, advances
status, or deletes. The edit dialog covers title, description, status, priority, due date,
assignee (ComboboxPicker of users + crew), an inline checklist editor, and (Phase 2, #1244)
**Repeats** (recurrence frequency) and **Add a watcher** (chips, remove via ×).

### Work-layer Phase 2 (#1244) — the Work tab, Overview card, and the revived board

**Tab rename.** The project detail page's Tasks tab is now **Work**
(`src/app/(app)/projects/[id]/page.tsx`'s `VALID_TABS`), showing "Work · 9 of 14" (done of
total, cancelled excluded) in the trigger. `?tab=tasks` still works — `normalizeTabParam`
rewrites it to `work` before it's matched against `VALID_TABS`, so an old bookmark, ⌘K entry,
or notification link never silently falls back to Overview.

**Work tab (`src/components/projects/work-tab.tsx`)** — list / board / calendar toggle over
**one** data source (`src/hooks/use-project-work-data.ts`, extracted out of `tasks-panel.tsx`
so list/board/calendar can each call it without tripling the fetch/live-resync logic; only one
view ever mounts at a time, so this is never three concurrent subscriptions). `list` is
`TasksPanel` verbatim. `board` (`work-board-view.tsx`) is a stage-columns kanban — dnd-kit
(`@dnd-kit/core` + `/sortable`, same sensor config as the Equipment tab's own drag-reorder:
one delay-based `PointerSensor` + a `KeyboardSensor`) — drag within a column calls the new
`reorderNative`, drag across columns also patches `stage` via `updateNative`. `calendar`
(`work-calendar-view.tsx`) is a read-only day-strip grouped by due date (no calendar/date-grid
library exists in the tree, and a day-strip already answers "what's due when" for one
project's task list).

**`reorderNative` (`convex/projectTasksWrites.ts`)** — the browser-direct sibling of
`convex/projectTasks.ts`'s `reorderMany` (which stays `requireService`-gated and untouched,
per the design doc's explicit "leave it as is, add a new one"). Same shape as
`lineItemWrites.reorderNative`: assigns `sortOrder = index` for exactly the ids in
`orderedIds`, `assertBulkSizeOk`-capped, RBAC via `requireWorkOrProjectOrgUpdate`, foreign-org
ids silently skipped. `danger: "low"` (structural only — never money or status).

**Overview → Work card (`src/components/projects/overview/work-card.tsx`) REPLACES the
standalone Readiness panel** (`project-readiness-panel.tsx`, deleted — two surfaces showing
the same checks was exactly the duplication this program exists to remove).
`project-readiness-checks.ts`'s pure check logic is **unchanged**; the card only decides what
to do with a failing check.

**Rewritten by work-layer v2 (`docs/designs/work-layer-v2-integration.md` §4.4): the card is a
SUMMARY, not the project's work list.** The list moved to the context sidebar's Work section
(`project-work-rail-section.tsx`, §4.3) on every working tab, and the Work tab owns the full
view. Overview has no sidebar at all (#1063), so the card is work's counterpart there and
answers the one question the others can't at a glance — *is this job in trouble?* It renders:

- the **stage meter** — one thin bar per stage that HAS work, from
  `summariseProjectWork` (`src/lib/project-work.ts`, shared with the rail so the two can't
  disagree about open/late/unowned or the arithmetic);
- **"Needs a decision"** — `buildWorkDecisionRows` (`src/lib/project-work-card.ts`, pure,
  unit-tested): a failing check (severity ≠ `pass`) as a system row with its existing deep
  link, then genuinely LATE work, then ONE summary row for unowned work ("3 items have no
  owner", action → the Work tab's bulk bar). Work that is merely open and on track earns no
  row — that is the rail's business;
- a one-line **composer** (`WorkComposer`, §4.1) and a link out.

The previous stage-grouped version listed every row and skipped any with no `stage`, so its
own done/total disagreed with the Work tab header directly above it (§2 D2 — every pre-#1243
row has no stage). Neither the meter nor the decision rows filter on stage now; the meter
gives stage-less work its own trailing `No stage` segment.

The conflicts check's expandable per-asset swap list (`ConflictRow`) is preserved inside the
card (not dropped) so "no lost check" holds for its full interactive detail, not just the
summary line.

**Timeline row (`src/components/projects/overview/work-timeline-row.tsx`)** — a read-only
7-day strip (current calendar week, Monday-start) with four tracks: gear window
(`project.rentalStartDate`/`rentalEndDate`), services (`projectServices.listByProject`'s
`date`), crew (`useProjectCrew`'s per-assignment `shifts[].date`), work (this project's task
`dueDate`s). No calendar-grid library — a day-strip is enough to answer "what's on which day
this week" and drag-to-reschedule is a later agenda-engine phase (design §10.7).

**Revived board (`src/components/projects/project-board.tsx`, mounted at `/projects?view=board`
via `projects-view.tsx`'s table/board toggle)** — was dead code (no consumer rendered it) before
this phase. A drop calls `useNativeProjectStatus().updateStatus` through the **same**
`useConfirmStatusGate` the lifecycle stepper uses — never a bypass. That hook's signature moved
from per-hook-instance `(orgId, projectId, currentStatus, onProceed)` to per-call
`requestStatusChange(projectId, currentStatus, nextStatus)` (#1244) so ONE hook instance can
preview a confirm-impact check for *whichever* card is being dragged, not a single project
fixed for the component's lifetime — the project detail page updated its two call sites to
match (`src/hooks/__tests__/use-confirm-status-gate.test.tsx` covers both the single- and
multi-project shapes). Cards show "9/14 work · 1 overdue" via the new batched
`projectTasks.workCountsForProjects` query (bounded **per project** via
`by_organizationId_projectId`, not an org-wide `projectTasks` collect — see that query's own
comment on why this doesn't trip the R-9.8 collect ratchet the way a naive org-wide count
would). Cards in `QUOTING`/`QUOTED` get a simple days-since-`updatedAt` tint (amber ≥ 3 days,
`--t-out`-soft ≥ 7 days) — full per-client rotting thresholds are Phase 3 (design §8.4), this
is deliberately the "simple tint" the issue asked for, not that.

**Recurrence** (`projectTasks.recurrence`, schema `{freq: "daily"|"weekly"|"monthly",
daysOfWeek?, dayOfMonth?}` — `convex/lib/workVocabulary.ts`'s `WORK_RECURRENCE_FREQUENCIES`,
never a second hand-declared union) — never stored on a subtask. The **next occurrence is
created only when the current one is marked DONE** (Todoist model, never pre-generated):
`updateNative`'s DONE-transition branch calls `spawnNextOccurrence`
(`convex/projectTasksWrites.ts`), which computes the new due date via
`convex/lib/workRecurrence.ts`'s `computeNextOccurrenceDueDate` (org-timezone, reusing
`resolveOrgQuoteConfig` rather than adding a fourth timezone getter — R-3.1) and inserts a
fresh top-level row carrying the same title/project/stage/priority/assignee/tags/watchers and
the *same* recurrence rule. Re-saving an already-DONE task never spawns a second one.

**Watchers** (`projectTasks.watcherUserIds`, bounded to 50, always users — never crew, no
"crew watches a task" concept in design §8.2) — validated against org membership on every
create/update (`assertWatchersInOrg`, mirrors `assertAssigneeInOrg`'s shape). A dedicated
`setWatchingNative` toggles the CALLING user's own membership without risking clobbering a
concurrent watch/unwatch on the same row (the general `updateNative` watcher patch stays for
bulk/admin edits of the whole list). Notification-on-activity for watchers is a **documented
follow-up**, not wired this phase — the field and the add/remove UI exist so a future
notification type has something to read.

### Web push (subscription only, #1244, design §13)

`pushSubscriptions` (Convex table, one row per `(organizationId, userId, endpoint)` — endpoint
is the natural dedupe key since a browser re-subscribing on the same device returns either the
same endpoint or a fresh one). Reads: `convex/pushSubscriptions.ts`'s `isSubscribed`
(self-scoped). Writes: `convex/pushSubscriptionsWrites.ts`'s `subscribeNative`/
`unsubscribeNative` (`requireSelfScope`, same posture as `workSignalStatesWrites.ts` — a caller
only ever touches their own device's row). UI: `src/hooks/use-push-subscription.ts` +
a toggle on `/account/notifications` (`Notification.requestPermission()` →
`PushManager.subscribe()` → store the row). Service worker: `worker/index.ts` — a custom
source `@ducanh2912/next-pwa` auto-discovers (`customWorkerSrc` default "worker", no config
change needed) and `importScripts`-es into the generated `public/sw.js`, handling `push` and
`notificationclick`. VAPID key pair: `scripts/generate-vapid-keys.mts` (`pnpm run
vapid:generate`) — plain Node `crypto` EC P-256 key pair, base64url-encoded; **no new
dependency**, since only the SEND side needs a sender library.

**Deliberately NOT wired this phase**: nothing in this deployment sends a push. The
table + subscribe/unsubscribe flow + service-worker receive handler are the complete
deliverable; a server-side sender (a job that signs a Web Push request per subscription row
and calls the push service, on a `notifications`-table event) is a follow-up big enough to
deserve its own pass rather than being rushed into an already-large phase. `worker/index.ts`'s
`push` handler has no effect until that sender exists.

### The composer (#tae40e) — every field set before Add

`WorkComposer` (`src/components/work/work-composer.tsx`) is the ONE way work is created —
Today, the project rail, the Overview card, and (since #tae40e) the Work tab's list view,
which previously had its own title-only `<Input>` + Add button.

**Layout.** The title input owns its own row; the chips and Add wrap onto a second row
beneath it. The original one-row version raced the input against four chips in a flex line,
which in the 340px project rail left the field about forty pixels wide — you could not read
what you were typing. `work-composer.smoke.test.tsx` pins the two rows apart.

**`ChipButton` MUST forward its props and ref.** Every chip is a `DropdownMenuTrigger
asChild` child, and `asChild` clones the element with Radix's handlers, ref and
`data-state` on it. The original component destructured the props it knew about and
dropped the rest, so the chips rendered perfectly and **did nothing when clicked**.
Typecheck, lint and `next build` all passed. Only a test that clicks a chip and looks for
the menu catches it — which is why one exists.

**The chips**, all set before the row is ever written:

| Chip | Scope | Notes |
| --- | --- | --- |
| Owner | both | `nobody` allowed only on a job — an unowned personal item would land nowhere, and the composer blocks that (`describeWorkDestination`) |
| Stage | job only | personal work has no stages |
| Dates | both | due date (presets + a date field) plus an optional start date |
| Priority | both | `NORMAL` is the unset state and prints as "Priority", not "Normal" |
| Notes | both | `description`; a chip rather than a permanent line, because the rail is already two rows tall. Shows a dot when it is carrying something |

Title and notes clear after Add; **the other chips keep their settings** — adding five
things to the same stage for the same person is one intent, not five.

### Date spans: `startDate` → `dueDate`

A row with both dates **runs** over that stretch. It is not a defer/"not before" date:
nothing hides a row until its start. (The schema's Phase-1 comment said otherwise, but the
field was never written or read by anything, so this is the first meaning it has had.)

The ordering invariant lives in three layers, each doing its own layer's job:

1. **`assertDateSpanOrdered`** (`convex/projectTasksWrites.ts`) is the real gate — `*Native`
   mutations are browser-callable by anyone with a session. It checks the **resulting** row,
   not the incoming args: an update that moves one end still has to hold against the end
   already stored, which is exactly the inversion a "both args present" check waves through.
2. **`resolveWorkDates`** (`src/lib/work-due-dates.ts`) drops an impossible span client-side,
   so the user never round-trips a server error for something the UI can see.
3. The start field's `max` attribute, so the browser itself refuses one first.

**On the calendar** (`work-calendar-view.tsx`), a span appears under **every day it runs**,
marked start / middle / end with a "day 2 of 3" caption. The Work tab's calendar is a
day-strip, not a month grid, so repetition *is* the bar — there is nothing to draw one
across. `src/lib/work-calendar-spans.ts` owns that arithmetic and its tests; the component
only draws the result. A span is capped at `MAX_SPAN_DAYS` (31) and **always keeps both
ends** — truncating the tail would hide the deadline, the one day a reader is looking for.
A backwards span (possible on a row stored before the guard existed) collapses to its due
date rather than throwing: a renderer should make a bad row look wrong, not take the tab
down.

## My tasks — superseded by Today (`src/app/(app)/my-tasks/page.tsx`)

**As of work-layer phase 0.5 (#1242), `/my-tasks` is a pure redirect —
originally to `/today`, and since D10C (2026-09-21) to `/dashboard`, since
`/today` itself now just redirects there too.** Everything this section used
to describe (the cross-project personal-scope task list, backed by
`myOpenTasks` above, grouped Overdue / Today / Later) now lives in the
`TodayWorkListWidget` dashboard-board widget — see
[FEATUREDOCS/79](./79-today.md). The redirect is kept (not a hard delete) so
old bookmarks/links and ⌘K muscle memory still land somewhere real. Today
also fixes a real bug the old page had: its Overdue/Today/Later split
bucketed by the BROWSER's local midnight (`new Date(now).setHours(0,0,0,0)`),
not the org's timezone — Today buckets in the org's timezone instead
(`src/lib/today-buckets.ts`).
Test: `src/app/(app)/my-tasks/__tests__/page.smoke.test.tsx` now just asserts the redirect.

## Follow-ups (deferred)
- **Notifications on assignment / due date, and on a watcher's watched task.** The notification
  system exists ([FEATUREDOCS/17](./17-notifications.md)); wiring task assignment/due-soon/
  watcher-activity reminders is the obvious next step. Left out to keep this phase's scope
  bounded — see the "Watchers" section above.
- **Web push send.** The subscription table + browser flow + service-worker receive handler
  are complete (see "Web push" above); a server-side sender is the deferred half.
- **Drag-and-drop reordering** — done this phase (#1244): `reorderNative`, see above.
  (Previously listed here as deferred; superseded.)
- **Comments / @mentions on tasks.** Ties into the broader Wave 3 comments feature.
