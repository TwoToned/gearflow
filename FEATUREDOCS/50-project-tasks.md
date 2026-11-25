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
`watcherUserIds`, `automation`; and the tables `workItemLinks` (not revived: see Task links below),
`workSignalStates`,
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
- **One `Tasks & notes` tab (UX Phase 10, #8c).** Tasks, Notes and Files are ONE job tab
  (`tasks` in `src/lib/job-tabs.ts`; `?tab=notes` and `?tab=files` are aliases that land on
  it and scroll to their section). Its badge is `done/total` plus a red `n overdue`.
  `src/components/projects/tasks-notes/tasks-notes-tab.tsx` hosts the sections (Slice A
  stacks the three existing bodies; later slices replace each). **Task links are deferred**
  (owner ruling 2026-11-24: no schema until decided).
- **"Overdue" is one rule** (`convex/lib/taskDue.ts`): `dueDate` is stored as UTC midnight of
  the typed date, so its calendar day is the UTC day of that instant; "today" is the day
  `now` falls on in the org's timezone (`orgSettings.timezone`, the same one invoice due days
  use; UTC when the org stores none). Open tasks (TODO / IN_PROGRESS) due before today are
  overdue. The tab badge, the `projectReadiness.forProject` overdue count and the grouping
  all call it.
- **Tasks section** (`src/components/projects/tasks-notes/tasks-section.tsx`; replaced
  `tasks-panel.tsx`): tasks grouped by WHEN (Overdue · Today · Tomorrow · This week · Later ·
  No date, then a collapsed `Done · n · m cancelled`) by `src/lib/project-task-groups.ts`;
  chips `Open · Mine · Done · All` + search; an add row at the top (`Due ▾`, `Assign ▾`); each
  row has a completion circle, `High`/`Low`, `In progress` only when it is, the assignee and
  due words as menus, and ⋯ (`src/lib/row-actions/task-row.ts`); Select mode + the one
  `BulkBar` (Assign · Due · Mark done · Delete, `task-bulk.ts`) over `bulkUpdateNative` /
  `bulkDeleteNative`; drag a grip to reorder WITHIN a group (`reorderNative`; `sortOrder` is
  one value per project, so a drag never crosses groups); a Radix task `Sheet` with every
  field and a history line. Data via `src/hooks/use-project-task-list.ts`, which refetches
  the composite read when the live `projectTasks` subscription changes.
- **Every task write is exactly undoable by ids** (`src/hooks/use-task-actions.ts`: one
  toast + one closure). The forward write stores what it changed in its own audit row(s)
  (`${auditId}:${taskId}` per task; one row for a reorder); `undoCreateNative`,
  `undoUpdateNative`, `restoreDeletedNative`, `undoReorderNative` take ids only and refuse
  a stale target (author, 10-minute server-clock window, once, per-field compare-and-set
  through `convex/lib/fieldEditUndo.ts`). A task owns no stored file, so an Undo never
  touches one. Every write also emits an `activityEvents` row (`task_created` /
  `task_completed` / `task_updated` / `task_deleted` / `task_restored`) so the Activity rail
  shows task work.
- **Discussion** is inline on the same tab (`discussion-section.tsx`, the SAME
  `CommentThreadBody` the Sheet panel uses), with `@ Mention ▾` and the `Blocking` switch;
  the header ⋯ item, the header's discussion count badge and Overview's blocking row all jump
  to it (`?tab=discussion`). `Blocking` holds prep and dispatch exactly as before.
  `?tab=work` (the old name) still resolves to this tab.
- **Notes section** (`notes-section.tsx`, `note-card.tsx`): three cards with the AUDIENCE on
  the label (Client notes · prints on the quote & invoice, Crew notes · prints on the call
  sheet & runsheet, Internal notes · only us). Saves on blur or ⌘↵ (no Save button, no Undo:
  the version menu is the way back) through `projectWrites.updateNotesNative`; an
  `Unsaved` / `Saved · Sam · date` line is DERIVED from the `note_updated` activity events the
  save writes (`collaboration.lastNoteSaves`; no stored `updatedBy`, and the event never
  carries the note text). Client notes have a Preview that renders the same markup the
  documents print. A `vN · live ▾` menu shows an earlier version's notes read-only
  (`versionsRead.getVersion`); a viewer sees the text only.
- **Crew notes print** at the top of the call sheet (a `CREW NOTES` block under the info block,
  capped at 12 rows with a pointer back to the job; `crewNotesBlock` in
  `src/lib/pdfme/templates/call-sheet-services.ts`) and of the Logistics run sheet print
  (`print-runsheet.tsx`). Both read ONE helper, `src/lib/crew-notes-print.ts`.
- **Files section** (`files-section.tsx`, `file-row.tsx`): the job's files from
  `projectFiles.listForProject` with a category per file (the `ProjectMediaType` enum, guessed
  from the name on upload, changed through `mediaWrites.setTypeNative`), uploader and date,
  Open / Download / Rename (`mediaWrites.renameNative`, display name only) / Change category,
  chips `All · Documents · Photos`, an always-on checkbox + `BulkBar`, a drop strip naming the
  types and the 50 MB cap, and `Take a photo` on a phone. **Remove is a confirmed hard delete
  of the stored file with NO Undo** (an Undo never deletes or restores stored bytes).
  `Also on this job` (`projectFiles.alsoOnJob`) lists, read-only, the files that live on other
  tabs (sent quote and issued invoice documents, sub-hire attachments, incident photos), each
  with its origin and an open link, gated per source by `callerMayRead`.
- **Task links** (UX Phase 10 Slice E; owner-approved, 2026-11-24): the table
  `projectTaskLinks` (`id, organizationId, taskId, linkedKind: lineItem | file | discussion,
  linkedId, createdById, createdAt`; indexes `by_cuid`, `by_taskId`, `by_linked`) is a bare
  POINTER from a task to something on its own job. Nothing about the target is copied, so a
  renamed line or file never goes stale. It is NOT the retired `workItemLinks` (no typed
  relations, no cross-job links). `convex/lib/taskLinkTargets.ts` is the one place that decides
  a target is THIS org's and THIS job's (every lookup is by a global `by_cuid` / Convex id, so
  each row is org- and project-checked) and caps a task at 25 links. Writes
  (`projectTaskLinksWrites`): `linkNative` (idempotent: an existing pair returns
  `created: false`, no write, no Undo), `unlinkNative`, and the ids-only Undos `undoLinkNative` /
  `undoUnlinkNative`. The forward write stores its author, the SERVER clock and (for an unlink)
  the whole row in its own audit row; an Undo refuses, changing nothing, unless the row is this
  org's and this link's, the caller is the author, it is inside the 10-minute window, it has not
  been undone, and the link is still as that write left it (an unlink's Undo also refuses if
  the pair exists again or the task / target is gone). An Undo never touches a stored file: a
  link points at a file, it does not own one. One bounded read, `projectTaskLinks.listForProject`
  (400 links, 500 tasks), returns every link with its target's label and the linking task's
  title; a link whose target is gone or moved is dropped, never leaked. UI: chips under a task
  row (up to three and `+n`) and a `Linked` list with ✕ in the task sheet (a chip opens its
  target: Equipment, or the Files / Discussion section); `Attach to a task…` in a file row's ⋯
  and an Equipment line's ⋯ (absent without `project:update`; `AttachToTaskDialog` offers the
  job's open tasks, never one already linked); a file row prints `Task: …` for the tasks that link
  to it. Deleting a task keeps its link rows (so a restored task regains them); the read joins
  through the task, so an orphan is never shown.
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
