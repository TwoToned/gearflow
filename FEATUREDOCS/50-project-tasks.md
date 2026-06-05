# Project Tasks (Asana-style to-do lists)

Per-project task lists so operators can track project work inside GearFlow instead of
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

## Server actions (`src/server/project-tasks.ts`)
All writes use `requirePermission("project", "update")`; reads use `("project", "read")`.
- `getProjectTasks(projectId)` — ordered by `sortOrder`, then `createdAt`; includes assignee + creator.
- `getTaskAssignees()` — org members (users) + active crew, for the assignee picker (gated on
  project read so no separate `orgMembers` permission is needed).
- `createProjectTask(...)` — validates project ∈ org and assignee ∈ org (`assertAssigneeInOrg`),
  appends to the end (`max(sortOrder)+1`), sets `completedAt` if created as `DONE`.
- `updateProjectTask(id, ...)` — partial update; manages the `completedAt` transition both directions.
- `deleteProjectTask(id)`.
- `reorderProjectTasks(projectId, orderedIds)` — writes each row's `sortOrder` to its index,
  scoped to org + project (a foreign id can't be reordered in).
- `getMyOpenTasks(limit)` — cross-project: non-`DONE` tasks assigned to the current user, ordered
  by due date (nulls last), then priority, then age. Powers the user-centric home screen.

All queries are scoped to `organizationId` (and `userId` for `getMyOpenTasks`). Every mutation
calls `logActivity` with `entityType: "ProjectTask"` and the `projectId`.

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
