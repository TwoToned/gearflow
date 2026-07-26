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

## Convex functions (formerly `src/server/project-tasks.ts`, now deleted)

Reads in [`convex/projectTasks.ts`](../convex/projectTasks.ts); browser-direct writes in
[`convex/projectTasksWrites.ts`](../convex/projectTasksWrites.ts) (`requireOrgPermission("project",
"update")`, called via `src/hooks/use-project-tasks-writes.ts`). Reads use `requireOrgRead`/
`requireOrgPermission("project", "read")`.
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
with `entityType: "ProjectTask"` and the `projectId`.

## UI (`src/components/projects/tasks-panel.tsx`)
Rendered in the project detail page's **Tasks** tab. Quick-add input (Enter to add a TODO),
tasks grouped by status (To do / In progress / Done), each row with a status toggle (circle →
in-progress dot → done check), priority dot, due-date badge (red when overdue and not done),
checklist progress (`n/m`), and assignee avatar. A row dropdown edits, advances status, or deletes.
The edit dialog covers title, description, status, priority, due date, assignee (ComboboxPicker
of users + crew), and an inline checklist editor.

## My tasks (`src/app/(app)/my-tasks/page.tsx`)
A cross-project, personal-scope view: every open task assigned to the current user (directly
or via their crew record), backed by `myOpenTasks` above. Bespoke card list (mobile-first, one
column — not a `DataTable`), grouped by due bucket in this order: **Overdue / Today / This week
/ Later** (undated tasks fall into Later). Each row shows a status-cycle icon (TODO → IN_PROGRESS
→ DONE, same cycle as `tasks-panel.tsx`), priority dot, due badge (red when overdue), and a link
through to the task's project. The status-cycle button is only interactive when
`useCanDo("project", "update")` is true — viewer/warehouse roles get a static (non-clickable)
icon instead, consistent with the read-only treatment elsewhere. Zero open tasks renders a
`FlowMascot` all-clear empty state (personality allowed there — it's a true zero-state — but
never inside the Overdue group itself, per DESIGN.md §9's ban on personality in overdue/alert
copy). Registered in the sidebar RAIL (directly under Dashboard, no resource gate — personal
scope, not an org resource) and in `PAGE_COMMANDS` (`searchable: false`). **Sidebar-only** — not
in the mobile bottom nav, which stays the 5 daily-operator workflows (DESIGN.md §16).
Test: `src/app/(app)/my-tasks/__tests__/page.smoke.test.tsx`.

## Follow-ups (deferred)
- **Notifications on assignment / due date.** The notification system exists
  ([FEATUREDOCS/17](./17-notifications.md)); wiring task assignment + due-soon reminders is the
  obvious next step. Left out of v1 to keep scope minimal.
- **Drag-and-drop reordering.** `reorderProjectTasks` is implemented server-side; the panel
  currently reorders via "move to next status" only. A DnD handle is a UI-only follow-up.
- **Comments / @mentions on tasks.** Ties into the broader Wave 3 comments feature.
