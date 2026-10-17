# Project Tasks (basic to-do lists)

> _Owner: Jayden Nawotka · Last reviewed: 2026-10-17 (review quarterly — POLICY.md R-5.5)_

A deliberately **basic** task list. Each project has a **Tasks** tab; every user has `/my-tasks`
(their open tasks across every job) and a "My tasks" dashboard widget. Nothing is automated: no
recurrence, stages, subtasks, links, snoozing, templates or follow-up engine. (An earlier "work
layer" — Today, Triage, follow-up automation, client timeline/next step/pipeline — was built and
then removed in 2026-10; `docs/designs/work-layer*.md` are historical only.)

## Data model
`projectTasks` (Convex):
- `organizationId`, `projectId` (required for new tasks; legacy personal rows may have none)
- `title` (≤200), `description?` (≤5000)
- `status` — `TODO | IN_PROGRESS | DONE | CANCELLED` (default `TODO`); `completedAt` is stamped on
  the transition into `DONE` and cleared when it leaves
- `priority` — `LOW | NORMAL | HIGH` (default `NORMAL`)
- `dueDate?`, `sortOrder` (append = `max+1`)
- `assigneeUserId?` XOR `assigneeCrewId?` (a task is assigned to an org member OR a crew member;
  assigning one clears the other), `createdById?`, `createdAt/updatedAt`

Vocabulary lives in `src/lib/project-tasks.ts` (UI) and `convex/lib/validators.ts`
(`ProjectTaskStatus`/`ProjectTaskPriority`).

**Deprecated columns (kept in `convex/schema.ts`, never read or written):** `checklist`, `kind`,
`stage`, `parentId`, `startDate`, `dueTime`, `scheduledStart/End`, `snoozedUntil`,
`estimateMinutes`, `tags`, `sourceKey`, `isPrivate`, `templateId`, `recurrence`,
`watcherUserIds`, `automation`; and the tables `workItemLinks`, `workSignalStates`,
`workTemplates`. Convex rejects a schema push that drops a field/table that still holds data, so
these stay until a data-wipe migration is run. Rows that were subtasks or automated follow-ups
simply show up as ordinary tasks now.

## Convex functions
Reads in [`convex/projectTasks.ts`](../convex/projectTasks.ts); browser-direct writes in
[`convex/projectTasksWrites.ts`](../convex/projectTasksWrites.ts) via
`src/hooks/use-project-tasks-writes.ts`. Reads and writes gate on `work:read`/`work:update` OR
`project:read`/`project:update` (already-issued API keys only carry the `project:*` scopes).
- `listByProjectWithRelations(projectId, orgId)` — ordered by `sortOrder`, then `createdAt`;
  joins the assignee (user only if still an org member; crew org-checked).
- `listByProject`, `getById` — raw reads.
- `assignees(orgId)` — org members + active crew for the assignee picker.
- `myOpenTasks(orgId, now)` — the caller's own OPEN tasks across projects (user-assigned plus
  crew-assigned via `crewMembers.by_userId`), de-duped, org re-checked (both source indexes are
  global), sorted overdue → due asc (undated last) → priority, bounded to 100. `now` is
  client-passed and minute-bucketed.
- `createNative` / `updateNative` / `deleteNative` / `bulkUpdateNative` / `bulkDeleteNative` /
  `reorderNative` — validate project and assignee ∈ org, bound string lengths, audit every write
  (`entityType: "ProjectTask"`).

## UI
- **Tasks tab** (`src/components/projects/tasks-panel.tsx`): add box, open list (tick to
  complete), a "Closed" section (tick to reopen), and an edit dialog (title, notes, status,
  priority, due date, assignee, delete). Data via `src/hooks/use-project-task-list.ts`, which
  refetches the composite read when the live `projectTasks` subscription changes.
  `?tab=work` (the old name) still resolves to this tab.
- **`/my-tasks`** (`src/app/(app)/my-tasks/page.tsx`) and the **My tasks** dashboard widget
  (`MyTasksWidget`).

### Web push (subscription only, #1244, design §13)

`pushSubscriptions` (Convex table, one row per `(organizationId, userId, endpoint)` — endpoint
is the natural dedupe key since a browser re-subscribing on the same device returns either the
same endpoint or a fresh one). Reads: `convex/pushSubscriptions.ts`'s `isSubscribed`
(self-scoped). Writes: `convex/pushSubscriptionsWrites.ts`'s `subscribeNative`/
`unsubscribeNative` (`requireSelfScope`, a caller only ever touches their own device's row). UI: `src/hooks/use-push-subscription.ts` +
a toggle on `/account/notifications` (`Notification.requestPermission()` →
`PushManager.subscribe()` → store the row). Service worker: `worker/index.ts` — a custom
source `@ducanh2912/next-pwa` auto-discovers (`customWorkerSrc` default "worker", no config
change needed) and `importScripts`-es into the generated `public/sw.js`, handling `push` and
`notificationclick`. VAPID key pair: `scripts/generate-vapid-keys.mts` (`pnpm run
vapid:generate`) — plain Node `crypto` EC P-256 key pair, base64url-encoded; **no new
dependency**, since only the SEND side needs a sender library.

**Nothing in this deployment sends a push.** (A sender, `src/lib/web-push.ts`, exists but its only caller — the follow-up engine's urgent nudge — was removed.) The
table + subscribe/unsubscribe flow + service-worker receive handler are the complete
deliverable; a server-side sender (a job that signs a Web Push request per subscription row
and calls the push service, on a `notifications`-table event) is a follow-up big enough to
deserve its own pass rather than being rushed into an already-large phase. `worker/index.ts`'s
`push` handler has no effect until that sender exists.
