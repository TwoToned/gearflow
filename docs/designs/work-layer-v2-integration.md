# Work layer v2 — integration pass

> _Owner: Jayden Nawotka · Drafted 2026-09-19 · Status: design, not yet built_
>
> Successor to [`work-layer.md`](./work-layer.md). That doc designed the program and phases 0–4
> shipped against it. This one audits what those phases actually produced, names why it reads as
> half-built, and specifies the pass that makes work a first-class citizen of a project.
> Mockups: a Design canvas of five artboards (Today, project Overview, Work tab, phone, row
> states) drawn on DESIGN.md's real tokens — linked from the PR that carries this doc.

## 1. The complaint, stated precisely

Three things were reported: a quick task added on Today never appears anywhere; the whole work
layer feels half-baked and poorly integrated; work in projects feels like a second-class
citizen. All three are true, and they are the same defect seen from three angles.

**The work layer built three readers over one table and never guaranteed that every row has a
reader.** `projectTasks` rows are surfaced by exactly three queries, each with its own filter:

| Surface | Query | Shows a row only if |
|---|---|---|
| Today / work list widget | `projectTasks.myOpenTasks` | `assigneeUserId` is you, or `assigneeCrewId` is one of your crew records |
| Project → Overview → Work card | `projectTasks.listByProjectWithRelations` via `buildWorkCardStages` | it has a `projectId` **and** a `stage` |
| Project → Work tab | `projectTasks.listByProjectWithRelations` | it has a `projectId` |

Nothing enforces that a written row satisfies any of them. A row that satisfies none is written,
audited, counted against the org's write limit — and then read by nobody, forever. There is no
"all work" view to fall back on: `/my-tasks` is now a redirect to `/today`
(`src/app/(app)/my-tasks/page.tsx`), work items are absent from `globalSearch`, and there is no
`/work/[id]` route. A lost row is lost permanently.

## 2. Audit — the six defects (2026-09-19)

### D1 · Today's quick-add writes an orphan (the reported bug)

`src/components/dashboard/widgets/today-work-list-widget.tsx`'s `submitQuickAdd` calls
`writes.create({ title })` — no `assigneeUserId`, no `projectId`. `createNative`
(`convex/projectTasksWrites.ts`) sets `createdById` from the verified actor but **never defaults
`assigneeUserId`**: `buildNewTaskDoc` writes `assigneeUserId: falsyOrUndef(a.assigneeUserId)`,
which is `undefined` here. `resolveNewTaskPlacement` returns `{ projectId: undefined }` for the
no-project, no-parent case.

So the row lands with no assignee and no project. `myOpenTasks` only range-scans
`by_assigneeUserId_status` and `by_assigneeCrewId_status`, so it never returns it. No project
claims it. **The task is created successfully, the input clears, a toast never fires, and the row
is invisible from that moment on.** FEATUREDOCS/79 describes this feature as "lands as a personal
task"; that is what was intended, and the assignee default that would have made it true was never
written.

This is a correctness bug in a write path, not a UI polish item.

### D2 · A stage-less task is invisible on the project's home

`src/lib/project-work-card.ts`:

```ts
for (const task of tasks) {
  if (!task.stage) continue; // no stage bucket to render it in on this card
```

Every `projectTasks` row created before #1243 has no `stage` (the field did not exist), and
nothing backfilled them. Any row created through a path that does not resolve a stage has none
either. Those rows exist on the Work tab and are counted in the tab's `9 of 14` label
(`projects/[id]/page.tsx`), but the Overview card silently omits them — the card's own
`done/total` summary disagrees with the tab header sitting three centimetres above it.

### D3 · The Overview Work card cannot be worked

`src/components/projects/overview/work-card.tsx` renders a status circle as a non-interactive
`<span aria-hidden>`. There is no checkbox, no assignee, no due date, no priority, no quick-add,
no peek. Every row's only affordance is a deep link to another tab. The card also violates
DESIGN.md's state matrix: its loading state is the bare text `Checking work…`, not skeleton rows.

The project's home page shows work and offers no way to do any of it. That is the literal
mechanism behind "second-class citizen".

### D4 · Project work is born ownerless

`tasks-panel.tsx`'s quick-add creates a row with a `projectId` and no assignee. Unassigned work
never reaches anyone's Today (by design — `work-layer.md` §14 Q2 chose assigned-to-me only), and
the project surfaces do not show that it is unowned or how many are. Work accumulates on the job
in a state where nobody has been told about it, and no surface says so.

### D5 · Work is unreachable from anywhere else in the app

- `convex/globalSearch.ts` scans assets, bulk assets, models, kits, clients, projects, locations,
  categories — not `projectTasks`. The `search_title` index added in #1243 has no reader.
- There is no `/work/[id]` route (`work-layer.md` §8.2 specified one). A work item cannot be
  linked to, shared in Slack, or referenced from a notification.
- The command palette (`src/components/layout/command-search.tsx`) has no `/task` verb.

Work is the only first-class-sounding object in the app with no URL, no search entry and no
palette verb. That absence is most of the "not integrated" feeling.

### D6 · Reactivity and duplicate reads

`useProjectWorkData` still runs the fingerprint-resync hack `work-layer.md` §8.6 committed to
removing (a live subscription on the raw table driving a refetch of a composite read). And
`projects/[id]/page.tsx` mounts `useProjectWorkData(id)` at page level purely for the tab count,
while the Overview card and the Work tab each mount their own — up to three concurrent copies of
the same query on one page.

## 3. The rule this pass adds

> **No work item may exist that no surface will show.**
> Every row has an **owner**, a **project**, or both. "Neither" is not a state the product can
> produce — refused at the composer, and defaulted on the server as a backstop.

Everything below follows from that one sentence. It is worth stating as a rule rather than a bug
fix because the same hole reappears every time a new writer is added (templates, Mira, the MCP
`create_work_item` tool, a future recurrence expansion) — a default in one shared mutation covers
all of them; a fix in one input does not.

## 4. Design

### 4.1 The composer — one component, three hosts

The bare text input becomes a composer that always **names its destination before you commit**.

```
┌────────────────────────────────────────────────────────────────┐
│ ⊕  Add work…                        [◍ Me ▾] [Today ▾]  [ Add ] │
├────────────────────────────────────────────────────────────────┤
│ ● Lands in your work list · today · no project                 │
└────────────────────────────────────────────────────────────────┘
```

- **Owner chip** — defaults to the current user on Today, and to the project manager
  (`projects.projectManagerId`, else earliest `projectManagers` row) on a project. Never starts
  empty.
- **When chip** — Today / Tomorrow / No date. Defaults to Today on `/today`, No date on a project
  (project work is due-dated deliberately, not by reflex).
- **Stage chip** replaces the When chip on a project, defaulting from the project's lifecycle
  status exactly as `resolveNewTaskPlacement` already does server-side.
- **Destination line** states, in plain words, which list the row will appear in. It is the whole
  fix for D1 expressed as UI: you cannot add a row without reading where it goes.
- **`Unassigned` chosen with no project** → the line turns amber, says *"Nobody owns this and it
  has no project — it would land nowhere"*, and **Add is disabled**. The only way to produce the
  D1 state is now blocked in the UI and defaulted on the server.
- Inline tokens for power users: `@name` sets the owner, `#stage` sets the stage, `/date` sets the
  due date. The chips are the discoverable path; the tokens are the fast one. Both write the same
  fields — no second parse.

### 4.2 The row — one component, every host

```
○  Confirm venue access                         [1d late]  (JN)
   GAL-118 Gala Dinner · Prep
```

Circle · title · context line · state badge · owner avatar. The context line is the only thing
that varies by host: on Today it names the job and stage, on a project it names nothing (the job
is the page) and the owner avatar carries the weight.

Eight states, all drawn on the `RowStates` artboard: default, overdue (`--t-out`/`bg-out-soft`,
never brand red, no personality copy), done (struck, stays visible until refresh so undo is one
click), system/`auto`, unowned (dashed avatar + `Assign`), snoozed, mention, blocked-by-lock.

### 4.3 Project Overview — the Work card becomes the project's spine

The card stays where it is (first card, main column, under the stepper). It stops being a
readout:

1. **Stage meter** across the top — six thin bars, one per stage, widths weighted by item count.
   The whole job's state in one strip, replacing per-stage bars repeated down the card.
2. **Project-scoped composer** (§4.1) inside the card. Adding work to a job should not require
   changing tabs.
3. **"3 items have no owner" strip** — amber, with *Assign all to me*. D4's silence becomes a
   visible count. This is the single highest-value addition: it converts the failure mode into a
   one-click resolution.
4. **Rows are live**: the circle is a real `<button>` that toggles done, the owner avatar opens an
   assign menu, the due date opens a date menu, the row opens the peek. Same mutations the Work
   tab already calls — no new write path.
5. **`No stage yet` group** — D2's `continue` becomes a real bucket. A row without a stage is a
   row someone has to triage, not a row to hide.
6. **Done rows collapse** behind `Show 5 done`, so the card stays short on a busy job. "Front and
   centre without being over the top" is bought here: the card shows open work and problems, and
   nothing else, but everything it shows is actionable.

Readiness checks stay exactly as they are — derived system rows inside the same list, with their
existing deep links. `project-readiness-checks.ts` is untouched.

### 4.4 Work tab — owners, not just stages

The list/board/calendar toggle and the bulk bar are kept as built. Two changes:

- **Group by owner is the default** (stage stays available). The Overview card answers "where is
  this job up to"; the Work tab answers "who is doing what". Grouping both by stage made the tab
  a longer copy of the card.
- A **`Nobody` lane**, badged *not on anyone's Today*, carrying the unowned rows. Same fact as the
  card's amber strip, in the place where you fix it in bulk.
- **Only mine** toggle, since a PM on a big job wants their own slice without losing the lanes.

### 4.5 Peek — the work item's home until `/work/[id]` exists

The existing non-modal peek grows the fields the design always specified: owner, due, stage,
priority, estimate, links (client · venue · quote chips), subtasks with an add row, activity, and
a footer of *Mark done · Snooze · ⋯*. Docked on the Work tab, overlaid on Today, a bottom sheet on
a phone. It stays non-modal for the documented reason (CLAUDE.md's Radix/Base UI note).

### 4.6 Phone

Today keeps the bucket list and drops the rails to a single **Next up** strip. The composer pins
above the bottom nav with its owner/when chips always visible — the destination guarantee matters
most on the surface where people add work while walking. 44px hit areas on every circle via the
existing `.touch-target` utility; the visual circle stays 20px.

## 5. Changes required

| # | Change | Where | Size |
|---|---|---|---|
| 1 | Default `assigneeUserId` to the acting user when a create has **no** `projectId`, no `parentId` and no explicit assignee | `convex/projectTasksWrites.ts` `createNative` | ~4 lines + test |
| 2 | Pass the owner/when the composer chose | `today-work-list-widget.tsx` | small |
| 3 | Stage-less rows into a `No stage yet` bucket | `src/lib/project-work-card.ts` | ~6 lines + test |
| 4 | Card rows: toggle-done, assign, due, peek; skeleton loading | `overview/work-card.tsx` | medium |
| 5 | Unowned count + *Assign all to me* | `project-work-card.ts` + card | medium |
| 6 | Composer component, shared by Today / card / Work tab | new `src/components/work/work-composer.tsx` | medium |
| 7 | Shared `WorkRow` used by all three surfaces | new `src/components/work/work-row.tsx` | medium |
| 8 | Group-by-owner default + `Nobody` lane + Only mine | `tasks-panel.tsx` | small |
| 9 | Index `projectTasks` in global search (the `search_title` index already exists) | `convex/globalSearch.ts` | medium |
| 10 | `/work/[id]` route rendering the peek full-page | new route | medium |
| 11 | `/task` verb in the command palette | `command-search.tsx` | small |
| 12 | Drop the fingerprint resync; one shared query per page | `use-project-work-data.ts`, `projects/[id]/page.tsx` | medium |

Nothing above needs a schema change. Every field the design uses (`stage`, `dueDate`,
`assigneeUserId`, `parentId`, `estimateMinutes`, `tags`, `snoozedUntil`) shipped in phase 1.

## 6. Phasing

- **P1 — stop losing rows (1 day).** Changes 1–3, each with a test. Independently shippable, and
  it closes the reported bug on its own.
- **P2 — the card becomes the spine (3–4 days).** Changes 4–8. This is the pass that answers
  "second-class citizen".
- **P3 — reach (2–3 days).** Changes 9–12. Work gets a URL, a search entry and a palette verb.

## 7. Deliberately not doing

- No new table, no new resource, no migration. The spine is `projectTasks` and stays so (R-3.1).
- No time tracking, no timer, no "plan my day" auto-scheduler.
- No second write path for any surface: the card, the tab and Today call the same
  `projectTasksWrites` mutations, and a curated Mira/MCP tool wraps the same registry operation
  rather than reaching Convex directly (CLAUDE.md, the dispatcher note).
- No per-bucket cards on Today. Buckets stay `SectionHeader` + hairline (D7A in `work-layer.md`).

## 8. Open questions

1. Should the server default in change 1 also apply when a **project** is given and no assignee —
   i.e. default project work to the PM? The design says no (unowned is a legitimate, now-visible
   state on a job), but it is the one place a reasonable person would choose differently.
2. Should the `Nobody` lane be visible to non-PM members, or only to whoever can assign?
3. Does `/work/[id]` need its own permission, or does it inherit the project's (and, for a
   personal item, the owner's)?
