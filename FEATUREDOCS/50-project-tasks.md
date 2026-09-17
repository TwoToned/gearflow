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
- Scheduling: `startDate` (org-tz midnight; hides the row until then), `dueTime` (`"HH:mm"`
  in the org timezone), `scheduledStart`/`scheduledEnd` (the agenda block Today renders),
  `snoozedUntil`, `estimateMinutes`, `tags` (free-form strings, no tag table).
- `sourceKey` — set ONLY when a human promotes a derived Triage signal (quote expiring,
  crew declined, etc.) into a real row; deterministic, names the underlying entity (e.g.
  `"quote:expiring:<quoteId>"`). Never set by anything else — it's the join key back to
  `workSignalStates` below.
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
Rendered in the project detail page's **Tasks** tab. Quick-add input (Enter to add a TODO),
tasks grouped by status (To do / In progress / Done), each row with a status toggle (circle →
in-progress dot → done check), priority dot, due-date badge (red when overdue and not done),
checklist progress (`n/m`), and assignee avatar. A row dropdown edits, advances status, or deletes.
The edit dialog covers title, description, status, priority, due date, assignee (ComboboxPicker
of users + crew), and an inline checklist editor.

## My tasks — superseded by Today (`src/app/(app)/my-tasks/page.tsx`)

**As of work-layer phase 0.5 (#1242), `/my-tasks` is a pure redirect to
`/today`.** Everything this section used to describe (the cross-project
personal-scope task list, backed by `myOpenTasks` above, grouped Overdue /
Today / Later) now lives on Today — see
[FEATUREDOCS/79](./79-today.md). The redirect is kept (not a hard delete) so
old bookmarks/links and ⌘K muscle memory still land somewhere real. Today
also fixes a real bug the old page had: its Overdue/Today/Later split
bucketed by the BROWSER's local midnight (`new Date(now).setHours(0,0,0,0)`),
not the org's timezone — Today buckets in the org's timezone instead
(`src/lib/today-buckets.ts`).
Test: `src/app/(app)/my-tasks/__tests__/page.smoke.test.tsx` now just asserts the redirect.

## Follow-ups (deferred)
- **Notifications on assignment / due date.** The notification system exists
  ([FEATUREDOCS/17](./17-notifications.md)); wiring task assignment + due-soon reminders is the
  obvious next step. Left out of v1 to keep scope minimal.
- **Drag-and-drop reordering.** `reorderProjectTasks` is implemented server-side; the panel
  currently reorders via "move to next status" only. A DnD handle is a UI-only follow-up.
- **Comments / @mentions on tasks.** Ties into the broader Wave 3 comments feature.
