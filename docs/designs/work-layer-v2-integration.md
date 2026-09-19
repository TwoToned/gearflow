# Work layer v2 — integration pass

> _Owner: Jayden Nawotka · Drafted 2026-09-19 · Status: **P1 + the rail shipped** (see the
> change table's Built column); the rest is design_
>
> Successor to [`work-layer.md`](./work-layer.md). That doc designed the program and phases 0–4
> shipped against it. This one audits what those phases actually produced, names why it reads as
> half-built, and specifies the pass that makes work a first-class citizen of a project.
> Mockups: a Design canvas of six artboards (Today, project Overview, the Equipment tab with the
> work rail, the Work tab, phone, row states) drawn on DESIGN.md's real tokens — linked from the
> PR that carries this doc.
>
> **Revised 2026-09-19 after review:** work's home on a project is the **context sidebar**
> (§4.3), not a card that dominates Overview. The rail rides every working tab; Overview keeps a
> short summary. §4.3/§4.4 and the change table below reflect that.

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

### 4.1 The composer — one component, every host

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

### 4.3 The rail — work rides the context sidebar

**Work's home on a project is the context sidebar, not a card on Overview.**

`DetailSidebar` (340px, sticky) already rides along on every tab except Overview, carrying
Schedule · Location · Team · Activity. A **Work** section goes in **between Team and
Activity**: the standing reference facts (schedule, location, team) stay together above it,
and the two "what is happening" sections — work and the activity feed — sit together below.
Work above Schedule was the first proposal and is wrong: it splits the reference block in
half to put a list where the eye expects facts.

This is the difference between a destination and an ambient surface. Work is remembered *while
you are doing something else*: you are pricing gear in Equipment and you remember the parking
permits. A card on Overview means changing tabs twice to write that down, so it does not get
written down. A rail that is already on screen means one click.

```
┌ Work   9 of 14        1 late   3 unowned ┐
│ ▁▁▁ ▃▃▃▃▃▃ ▁▁▁ ▁▁▁ ▁▁▁ ▁▁▁                │  stage meter, one line
├───────────────────────────────────────────┤
│ ○ Confirm venue access      1d late  (JN) │
│ ○ Book LX crew — 2 of 4        Thu   (JN) │
│ ○ Print run sheets             Thu   (?)  │
│ ○ Truck pack list              Fri   (BR) │
│ ○ Dock booking — bay 2      23 Sep   (SO) │
├───────────────────────────────────────────┤
│ ⊕ Add work…                               │
│ All 14 in the Work tab  ›                 │
└───────────────────────────────────────────┘
```

- **Collapsible**, with the counts (`9 of 14`, `1 late`, `3 unowned`) in the header so it stays
  glanceable when collapsed. Collapse state is per-user and remembered in `localStorage` — a
  convenience nothing reads back, so blocked storage just starts it expanded.
- **Five rows, open work only**, ordered overdue → due → undated. `All 14 in the Work tab ›`
  carries the rest. The rail is a working set, not a list view — if it needs a scrollbar it has
  failed.
- **Rows are live**: the circle toggles done, the row opens the peek, the avatar assigns. Same
  mutations the Work tab already calls — no new write path.
- **One-line composer** at the bottom, which grows its owner chip and Add button only once you
  type. Collapsed it is one row of height; expanded it is the §4.1 composer.
- **Truncate, don't wrap.** 340px minus the circle, due and avatar leaves ~200px of title. A
  one-line ellipsis keeps the row rhythm; the peek has the full text.

**Where it is suppressed, and why.** Two tabs:

| Tab | Rail's Work section | Why |
|---|---|---|
| Work | hidden | The tab *is* the list. Rendering both shows the same rows twice on one screen. |
| Overview | n/a — no sidebar at all | #1063: on Overview the sidebar's content is the point of the page, so it is composed into peer cards instead. Work follows that existing rule rather than inventing a second one. |

That is the same dedupe rule the context rail already lives by, which is why this needs no new
concept: `project-context.ts` shapes the facts once and two renderers present them. `Work`
gets the same treatment — `project-work-card.ts` becomes the shared shaping module behind the
rail section, the Overview card and the tab header count.

### 4.4 Project Overview — a summary, not a second list

Because the rail carries the list, the Overview card stops trying to. It keeps the job's *shape*
and its *problems*, and nothing else:

1. **Stage meter** — six thin bars, one per stage, widths weighted by item count. The whole job
   in one strip.
2. **"Needs a decision"** — failing readiness checks (with their existing `Open labour` /
   `Open board` deep links), overdue items, and the **"3 items have no owner"** row with
   *Assign*. D4's silence becomes a visible count, one click from resolution. Nothing that is
   merely open and on track appears here.
3. **One line to capture** a new item, same composer.
4. **A footer link**: `5 more open · everything in the Work tab ›`.

Where the rail answers *what is outstanding*, this answers *is this job in trouble*. A clean job
collapses to a meter, an all-clear badge and the capture line — three rows of height instead of
the current card's full stage-grouped list.

Two things survive from the current card: readiness checks stay derived system rows with their
deep links (`project-readiness-checks.ts` untouched), and **stage-less rows stop vanishing** —
D2's `continue` is removed, and a row with no stage counts toward the meter's unallocated
segment and appears in the rail. It no longer needs its own Overview bucket, because the rail
lists it.

### 4.5 Work tab — owners, not just stages

The list/board/calendar toggle and the bulk bar are kept as built. Two changes:

- **Group by owner is the default** (stage stays available). The Overview card answers "where is
  this job up to"; the Work tab answers "who is doing what". Grouping both by stage made the tab
  a longer copy of the card.
- A **`Nobody` lane**, badged *not on anyone's Today*, carrying the unowned rows. Same fact as the
  card's amber strip, in the place where you fix it in bulk.
- **Only mine** toggle, since a PM on a big job wants their own slice without losing the lanes.

### 4.6 Peek — the work item's home until `/work/[id]` exists

The existing non-modal peek grows the fields the design always specified: owner, due, stage,
priority, estimate, links (client · venue · quote chips), subtasks with an add row, activity, and
a footer of *Mark done · Snooze · ⋯*. Docked on the Work tab, overlaid on Today, a bottom sheet on
a phone. It stays non-modal for the documented reason (CLAUDE.md's Radix/Base UI note).

### 4.7 Phone

Today keeps the bucket list and drops the rails to a single **Next up** strip. The composer pins
above the bottom nav with its owner/when chips always visible — the destination guarantee matters
most on the surface where people add work while walking. 44px hit areas on every circle via the
existing `.touch-target` utility; the visual circle stays 20px.

On a project, `DetailSidebar` stacks **below** the main column under `lg` — so on a phone the
Work section would land at the bottom of a long gear table, which is not a working surface.
Below `lg` the rail's Work section collapses by default and the tab bar carries the count
(`Work · 9/14`) instead: on a phone the Work tab is the surface, and the rail is a desktop
affordance. This is a deliberate divergence, not a responsive accident.

## 5. Changes required

| # | Change | Where | Size | Built |
|---|---|---|---|---|
| 1 | Default `assigneeUserId` to the acting user when a create has **no** `projectId`, no `parentId` and no explicit assignee | `convex/projectTasksWrites.ts` `createNative` | ~4 lines + test | ✅ |
| 2 | Pass the owner/when the composer chose | `today-work-list-widget.tsx` | small | ✅ |
| 3 | Stage-less rows counted, not dropped | `src/lib/project-work.ts`'s meter (the rail/card share it); `project-work-card.ts`'s own `continue` still stands until §4.4 lands | ~6 lines + test | partly |
| 4 | **Work section in the rail** — collapsible, 5 rows, live circles, composer, "all N" link | new `src/components/projects/project-work-rail-section.tsx`, mounted in `project-context-rail.tsx` | medium | ✅ |
| 5 | Suppress the rail's Work section on the Work tab (Overview has no rail already) | `projects/[id]/page.tsx` | small | ✅ |
| 6 | Slim the Overview card to meter + "needs a decision" + capture line + footer link | `overview/work-card.tsx`, `project-work-card.ts` | medium | |
| 7 | Unowned count (built, in `project-work.ts`) + the *Assign* action on it (not built) | `project-work.ts`, rail header, card | small | partly |
| 8 | Composer component, shared by Today / rail / card / Work tab | new `src/components/work/work-composer.tsx` | medium | ✅ |
| 9 | Shared `WorkRow` used by every surface — the rail still carries its own row markup, so this is the next extraction, not done | new `src/components/work/work-row.tsx` | medium | |
| 10 | Group-by-owner default + `Nobody` lane + Only mine | `tasks-panel.tsx` | small | |
| 11 | Index `projectTasks` in global search (the `search_title` index already exists) | `convex/globalSearch.ts` | medium | |
| 12 | `/work/[id]` route rendering the peek full-page | new route | medium | |
| 13 | `/task` verb in the command palette | `command-search.tsx` | small | |
| 14 | Drop the fingerprint resync; **one** `useProjectWorkData` per page, shared by the rail, the card and the tab count | `use-project-work-data.ts`, `projects/[id]/page.tsx` | medium | |

Nothing above needs a schema change. Every field the design uses (`stage`, `dueDate`,
`assigneeUserId`, `parentId`, `estimateMinutes`, `tags`, `snoozedUntil`) shipped in phase 1.

## 6. Phasing

- **P1 — stop losing rows (1 day).** Changes 1–3, each with a test. Independently shippable, and
  it closes the reported bug on its own.
- **P2 — work rides along (3–4 days).** Changes 4–10, starting with the rail section: it is the
  change that answers "second-class citizen", and the slimmed Overview card only makes sense once
  the rail exists to carry the list. Change 14 lands here too if the triple-mount bites — one
  query now feeds three renderers on the same page.
- **P3 — reach (2–3 days).** Changes 11–13. Work gets a URL, a search entry and a palette verb.

## 7. Deliberately not doing

- No new table, no new resource, no migration. The spine is `projectTasks` and stays so (R-3.1).
- No time tracking, no timer, no "plan my day" auto-scheduler.
- No second write path for any surface: the rail, the card, the tab and Today call the same
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
4. Should the rail's Work section default open or collapsed for a new user? Open shows the
   feature exists; collapsed protects the Activity feed's position for people who never use it.
   Proposed: open, remembered per user thereafter.
5. Five rows in the rail is a guess. If jobs routinely carry more open work than that, the cut
   should be "overdue + due this week" rather than a fixed count — worth watching once it ships.
