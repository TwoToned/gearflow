# Project Tasks (Asana-style to-do lists)

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

Per-project task lists so operators can track project work inside RVLT Flow instead of
external tools (Asana, Slack threads). Each project gets a **Tasks** tab.

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

Indexes: `(organizationId, projectId)`, `(projectId, status)`, `(assigneeUserId, status)`.
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
- ⚠️ `getMyOpenTasks(limit)` (cross-project "my tasks" read for a user-centric home screen) could
  not be found anywhere in current code — it appears to have never shipped, or was removed.
  Treat that line as aspirational/stale.

Every mutation writes its own audit row via `writeActivityLog` (Convex's `logActivity` counterpart)
with `entityType: "ProjectTask"` and the `projectId`.

## UI (`src/components/projects/tasks-panel.tsx`)
Rendered in the project detail page's **Tasks** tab. Quick-add input (Enter to add a TODO),
tasks grouped by status (To do / In progress / Done), each row with a status toggle (circle →
in-progress dot → done check), priority dot, due-date badge (red when overdue and not done),
checklist progress (`n/m`), and assignee avatar. A row dropdown edits, advances status, or deletes.
The edit dialog covers title, description, status, priority, due date, assignee (ComboboxPicker
of users + crew), and an inline checklist editor.

## Follow-ups (deferred)
- **Notifications on assignment / due date.** The notification system exists
  ([FEATUREDOCS/17](./17-notifications.md)); wiring task assignment + due-soon reminders is the
  obvious next step. Left out of v1 to keep scope minimal.
- **Drag-and-drop reordering.** `reorderProjectTasks` is implemented server-side; the panel
  currently reorders via "move to next status" only. A DnD handle is a UI-only follow-up.
- **Comments / @mentions on tasks.** Ties into the broader Wave 3 comments feature.
