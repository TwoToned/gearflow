# Work layer — tasks, project management, client relationships, time

> _Owner: Jayden Nawotka · Created: 2026-09-15 · Status: **APPROVED** 2026-09-16 (office-hours, decisions D1–D5) · Review quarterly (POLICY.md R-5.5)_

**Tracking:** [#1240](https://github.com/TwoToned/gearflow/issues/1240) (sub-issues #1241–#1247) · **Build order:** [`work-layer-build-plan.md`](./work-layer-build-plan.md)
**Mode:** intrapreneurship / startup (RVLT Flow is the company's own operating system and a
sold product). **Stage:** has users (the company runs on it daily at flow.rvlt.app).
**Binding constraint:** [`DESIGN.md`](../../DESIGN.md). **Governing policy:** [`POLICY.md`](../../POLICY.md).
**Wireframes:** [`mockups/work-layer-wireframes.html`](./mockups/work-layer-wireframes.html)
(intentionally rough — hierarchy and interaction shape only; DESIGN.md governs visuals).
**Successor:** [`work-layer-v2-integration.md`](./work-layer-v2-integration.md) — the 2026-09-19
audit of what phases 0–4 shipped, and the integration pass that makes work first-class in a
project. Read it alongside this doc before touching a work surface.
**Review status:** three adversarial cold-read passes on the original (16 → 14 → 7 findings,
all applied), then a full `/plan-eng-review` on 2026-09-16 — 13 decisions (R1–R13) plus an
independent outside voice. The review record, what was reused, what is out of scope, the failure
modes and the parallelisation plan are in §20.
**Companion docs:** FEATUREDOCS [50](../../FEATUREDOCS/50-project-tasks.md) (current tasks),
[55](../../FEATUREDOCS/55-project-collaboration.md) (comments), [63](../../FEATUREDOCS/63-client-contacts.md),
[31](../../FEATUREDOCS/31-crew-management.md), [17](../../FEATUREDOCS/17-notifications.md),
[69](../../FEATUREDOCS/69-project-overview.md), [66](../../FEATUREDOCS/66-finance-quotes-invoices-xero.md);
ROADMAP [2.1](../ROADMAP.md) (crew & services overhaul) and [3.1](../ROADMAP.md) (project todo lists).

---

## 1. Problem statement

RVLT Flow has no **work layer**. Nothing in the app answers "what do I, personally, need to do
today, across every job and every client?" Tasks shipped as a per-project checklist
(ROADMAP 3.1, effort M) and were never revisited; the user's own words: *"the tasks stuff feels
very half baked and just thrown on the side"*. Meanwhile every module already generates work
(a quote expiring, crew unconfirmed, a readiness check failing, an overbooking, an overdue
return, a mention) and each lands in a different chip, board or tab.

The goal, in the user's words: *"RVLT is the everything management software for us"*, and
*"time management and tasks and general project management and client management is super
important"*. **UI and UX are the top priority.**

## 2. Demand evidence

- Internal: the company runs on Flow daily; the owner is the one asking. The pain is
  first-person, not hypothesised.
- Structural: the codebase has *five* independent "things you must do" surfaces (dashboard
  "Needs attention" chips, `/overbookings`, `/finance` chase board, project readiness
  checklist, `/my-tasks`) and none of them share a model. That is the app telling us the same
  thing.
- Market: the four incumbents' review threads complain about exactly this seam — see §5.3.

**Gap (see §17, The Assignment):** there is no logged evidence yet of *where* work currently
arrives from outside Flow (Slack, WhatsApp, email, phone, memory) or how much of it is lost.
That log decides the order of the system-source catalogue (§9) and the quick-add grammar.

## 3. Status quo — what exists today (audited 2026-09-15)

| Area | What's there | What's missing |
|---|---|---|
| **Tasks** | One table `projectTasks` (`convex/schema.ts:3107`): TODO / IN_PROGRESS / DONE, LOW / NORMAL / HIGH, due date, assignee = user XOR crew, `checklist: v.any()`, `projectId` **required**. Reads `convex/projectTasks.ts`, writes `convex/projectTasksWrites.ts` (RBAC via `project:update`, rate-limited, audited, 18 backend tests in the two dedicated files plus `review2Bulk`). UI: project **Tasks** tab (`tasks-panel.tsx`, status-grouped list + edit dialog + bulk move/priority/delete), `/my-tasks` (Overdue / Today / This week / Later cards, one-way status cycle), dashboard top-5 block. 17 operations in the API registry. | Subtasks, comments, notifications, reminders, filters, sort, search, saved views, drag-drop (`reorderMany` exists, `requireService`-gated, with **zero production callers**), kanban/calendar/timeline views, labels, estimates, recurrence, watchers, standalone items, templates, a per-task page/deep link, Mira tool, curated MCP tool, global-search indexing, iCal presence, webhook events, readiness effect. `/activity` cannot even label a `ProjectTask` row. |
| **Project management** | Lifecycle stepper (7 stages over 11 statuses), lock strip + unlock sessions, readiness checklist (5 checks, 4 severities, deep-links to the fixing tab), versions/snapshots on one shared counter, templates, groups/categories with dnd-kit, `projectManagers`, two-window dates, `locations`. Generic `commentThreads`/`comments` substrate (entityType + entityId + optional sub-target, blocking flag, `mentionUserIds`). | Notes are three plain strings. Comment threads are mounted on projects, line items, assets, clients and suppliers only. **@mentions generate no notification.** Two unconnected activity systems (`activityLogs` audit vs `activityEvents` feed). A 7-column project kanban (`project-board.tsx`) is dead code. No milestone/phase concept for work. |
| **Clients** | `clients` (type incl. VENUE, billing, payment profile, Xero link), `clientContacts` (primary, cap 50), `projects.clientContactId`. Client page: hero + 4 stats + Projects / Notes / Files + sidebar. `/finance` board segments Quotes out / Expiring / Never sent / Confirmed uninvoiced / Deposit due / Outstanding. Quote status is derived (`quoteState.ts`). | No pipeline, lead, next-step, follow-up, comms history, or contact-level timeline. No invoices tab on the client. A contact belongs to exactly one client; venues are `locations`, not people. **"Flow doesn't email clients"** by design (`send-quote-dialog.tsx`). |
| **Time** | `crewAssignments` (PENDING → OFFERED → ACCEPTED/DECLINED → CONFIRMED), `crewShifts`, `crewAvailabilities`, `crewTimeEntries` (DRAFT → SUBMITTED → APPROVED → EXPORTED), `projectServices.crewCountRequired`, `/crew/planner` week grid, `/crew/timesheets`, call sheets, `crewConflicts`, `/overbookings` (incl. *Services missing crew*, *Unconfirmed crew*), crew offer email + `/api/crew/respond/[token]`. | Time entries never link to work or estimates; hours are captured for payroll, never for planning. No confirmation badges, no bulk availability request, no auto-nudge, no OT estimate at booking, no call-time reminder. **Four hand-rolled calendars** (availability page, booking calendar, crew planner, crew detail) with no shared engine. |
| **Platform** | ⌘K palette with `@entity` scoping, slash commands and date parsing; 21 curated Mira/MCP tools (all gear/warehouse/crew-ops); `savedTableViews`; `tags`; `customFieldDefinitions`; sharded dashboard counters; PWA; Resend email + cron digest; `useKeyboardShortcut` (3 global shortcuts). | **Notifications are derived on read** (`src/server/notifications.ts`, 9 types) — there is no notifications table, so nothing can ever notify about a task, mention, due date or acceptance. No push. No rich-text editor, no list virtualisation, no charting library. |

## 4. Target user and narrowest wedge

**Decision D1 (2026-09-15): daily users are owners / project managers and ops / warehouse
leads.** Crew keep interacting through the existing offer email + token link (no crew login
required for v1). Clients get no door in (see D3).

The user for whom this must be *un-live-without-able*: the owner-PM who currently holds the
day's work in their head and in three chat apps, and the ops lead who needs "what's mine
today" before the first truck moves.

**Narrowest wedge (ships first, standalone value):** a stored notification inbox plus **Today**
— one page that shows the day's agenda and the person's work, with Triage for inbound. If
nothing else in this doc shipped, that page would already replace `/my-tasks` and the
dashboard "Tasks due" block and stop non-blocking mentions vanishing (today only mentions in
*blocking* threads surface, via the dashboard blockers list).

## 5. Research

Per DESIGN.md §10, Mobbin (web) was surveyed for planners, issue lists, CRM records, project
overviews and crew grids. UX structure is taken; visuals are not.

### 5.1 Patterns taken

| Source | Pattern | Verdict |
|---|---|---|
| [Amie](https://mobbin.com/screens/4611b248-aa94-4ad1-aa17-98d58ca6cbba), [Motion](https://mobbin.com/screens/28001df3-b3ba-4ed4-854c-cea779f7ec2f) | Task list beside a day column; drag to time-block; NL quick-add ("New todo @list @2pm") | **Take** the split and the drag; **reject** auto-scheduling (users find it disorienting — human picks, system does busywork) |
| [Linear list](https://mobbin.com/screens/610d34b6-6ad8-45ab-80fb-2107b31ed01e), [Linear view options](https://mobbin.com/screens/94bb4d3b-a8e3-41e8-b8f1-b82d1f904b03) | Grouped list, single-key verbs, Space = peek, list/board toggle on the same data, views are unsaved filters | **Take** all of it; this is the interaction bar |
| [Todoist quick-add](https://mobbin.com/flows/1a8b1a3a-5b67-49b1-a047-32086af027d5) | Tokens parsed live and stripped from the title | **Take**; extend the grammar with RVLT nouns (`@project`, contact names, `#client`) |
| [Attio](https://mobbin.com/screens/1bdfc233-e1f6-4cd6-82e3-2baf285d29c9), [Twenty](https://mobbin.com/screens/4b51a4dc-265c-44bb-9c58-7e85e3731258) | Record = fields rail + one scrollable timeline (activity, emails, tasks, notes, files as tabs) | **Take** the anatomy for client and contact records |
| [Pipedrive](https://mobbin.com/screens/d7c51694-e293-445d-9829-557a50744b38) | "Focus" = the next activity pinned above history; deals **rot** (shade) after N days without a next step | **Take** both — next step on the client, rotting on quoted projects |
| [Deputy](https://mobbin.com/screens/238cdb58-7f42-4423-bda9-f30c426d8292) | Week grid per person, shift blocks with confirmation state, "require confirmation" counters in a footer | **Take** the badge language for the crew planner |
| [ClickUp peek](https://mobbin.com/screens/d0c81936-c473-405f-948c-b6626e769534), [Todoist detail](https://mobbin.com/screens/77828d1f-462b-4864-8d50-1df2829acebd) | Peek/detail: title, properties rail, subtasks, comments, activity | **Take** the anatomy; **reject** ClickUp's density |
| Things 3 (not on Mobbin) | Start date vs deadline: start-dated items hide until they "hop into Today"; a parked *Someday* | **Take** two dates, two behaviours |
| Basecamp | One to-do list per shippable chunk, one owner, one date | **Take** as a discipline: work is grouped by project **stage** |

### 5.2 Patterns rejected

- **Auto-scheduling the day** (Motion, Reclaim): the day of an event company changes hourly; a
  planner that reshuffles you is noise. Time-blocking is manual drag only.
- **Hill charts** (Basecamp): charming, but stage grouping plus readiness already encodes
  "unsolved vs executing" for this domain.
- **Custom statuses / per-org workflow builders** (ClickUp, Jira): the lifecycle stepper is the
  workflow. Work items keep four statuses.
- **A separate "deal" object** (HubSpot, Pipedrive): the project *is* the deal; an enquiry is a
  project at `ENQUIRY`. Adding a lead table would create a second copy of the client + dates +
  PM that the project already carries (R-3.1).
- **Inbox as the home page** (approach C, §12): Triage is a bucket inside Today, not the app's
  front door — the dashboard's three zones (DESIGN.md) stay.

### 5.3 Landscape

- Flex reviews: *"crew lists are barely usable"*, *"wish there were more labor timekeeping /
  crewing / scheduling features"*. Current RMS: *"crew scheduling needs quite a bit of love"*.
  HireHop: an *"address book with more CRM features"* is the top ask. Rentman: *"a contact can't
  be a venue and a venue can have multiple rooms"*. (Capterra / SelectHub / SoftwareAdvice,
  2025–26.)
- Every incumbent bolts a to-do list on the side. None unify system-generated work with human
  tasks. Production companies fall back to Airtable bases (Event → Position → Crew) for exactly
  this.
- 2026 AI patterns worth adopting only as *contributor* roles: triage suggestions, "meeting
  notes → work items", morning brief. Humans stay the assignee; high-danger actions still
  confirm (matches the Mira rule in CLAUDE.md).

**EUREKA:** conventional wisdom says "add a task manager". But in ops software most work is
**generated by the system**, not typed by a human. Making system work and human tasks the same
object, in the same inbox, with the project lifecycle as the automation trigger is the thing
nobody in this category does — and Flow already computes every one of those signals, it just
throws them into unrelated chips.

## 6. Premises and decisions

Premises (stated in the office-hours session, unchallenged; confirm on approval):

1. **Project = deal.** No lead/opportunity table. Enquiries are projects at `ENQUIRY`.
2. **Work can exist without a project** (personal, client-linked, or org-wide).
3. **Crew-side time is in scope but shares one calendar engine** with personal planning; the
   payroll/timesheet approval flow is not redesigned.
4. **DESIGN.md stays law.** No new accent colour; Today/Work inherit the Projects hue (blue)
   the sidebar already uses for My tasks.

Decisions recorded:

| # | Question | Decision | Consequence |
|---|---|---|---|
| D1 | Who lives in this layer daily? | **Owners/PMs + ops/warehouse leads** | Desktop, keyboard-first. Crew interact via existing email + token; no crew Today in v1. No client portal. |
| D2 | What does "time management" mean? | **Both** personal planning and crew time, equal weight | Program owns the shared agenda engine and the planner's confirmation/availability layer (§8.5). Payroll flow untouched. |
| D3 | Should Flow start emailing clients? | **No — keep "Flow doesn't email clients"** | CRM is a *relationship log*, not a comms channel: calls/emails are logged manually; quote/invoice/payment rows are stamped by the system; no deliverability work, no portal. Revisit only if D3 is reopened. |
| D4 | Which build? | **B — the work-layer spine** (§12) | Phased program (§13); A's polish items land inside phases 1–2; C's Triage lands as a bucket inside Today. |

## 7. Product thesis

One spine, three surfaces.

**Spine:** `workItems` (one model for tasks, follow-ups and system-generated work) + a stored
per-user `notifications` inbox + one unified timeline read model + one agenda engine.

**Surfaces:** **Today** (me), **Project** (the job), **Client** (the relationship). The crew
planner gains the confirmation/availability layer on the same spine.

## 8. Product design

Every surface follows DESIGN.md: espresso surfaces, single red for live/primary, `--t-out` tint
for overdue, module hues for wayfinding only, hard offset shadows, sentence case, `PersonAvatar`,
`StatusIndicator` intents from `status-colors.ts`, personality only in empty states (never on an
overdue row), all §8 state-matrix states, §9.1 focus/disabled/invalid states, 44px touch
targets on mobile.

### 8.1 Today (`/today`) — revised by the design review, 2026-09-16

Two versions exist. **Composed Today** is phase 0.5 and ships first. **Full Today** is phase 1.
The difference is not read versus write: it is which columns exist.

| Capability | Composed (0.5) | Full (1) | Why |
|---|---|---|---|
| Buckets, day rail, peek, keyboard | yes | yes | Reads that already exist |
| Done / un-done | yes | yes | `updateNative` exists and is guarded |
| Reply to a mention, re-offer crew, mark notification read | yes | yes | Existing mutations |
| Snooze, time-block, personal items, subtasks, stage grouping, quick-add | no | yes | Each needs a new column |

**Layout (decision D4A — work first, day as context).** The work list is the wide left column
and the page's anchor. The day sits in a narrower right rail as read-only context, matching the
two-column detail layout used across the app. The same item never appears in both: a scheduled
item shows in the day rail with a marker in its list row, not twice.

```
┌──────────────────────────────────────────┬──────────────────────┐
│  Good morning, Jayden                    │  Your day   as of 8:42│
│  Tuesday 16 September                    │  ─────────────────────│
│                                          │  07:00 Load-in        │
│  Overdue ──────────────────────  (only   │        Gala Dinner    │
│  ○ Confirm venue access   1d late         │  10:00 Call · Sarah   │
│                                          │  13:00 Dispatch · AGM │
│  Today ────────────────────────────────  │  15:00 Site visit     │
│  ○ Build quote v2        Uni Open Day    │                       │
│  ○ Book LX crew   2 of 4   Gala Dinner   │  Needs you  as of 8:42│
│  ● Send deposit invoice     done         │  ─────────────────────│
│                                          │  Sam declined AGM     │
│  Triage ─────────────────────  3         │  Quote v1 expires 2d  │
│  ○ Tom mentioned you in LX notes         │                       │
│                                          │                       │
│  Later ──────────────────────  11  ›     │                       │
└──────────────────────────────────────────┴──────────────────────┘
```

- **Bucket order** is Overdue, Today, Triage, Later. Your own commitments come before other
  people's arrivals. Overdue renders **only when non-empty**. Later is one collapsed row with a
  count, replacing the separate This week / Later / Someday buckets.
- **Buckets are sections, not cards (D7A).** Each is a `SectionHeader` label with its extending
  hairline rule, rows running continuously beneath. No per-bucket border or shadow — four
  bordered boxes in a column is the dashboard-card mosaic the app-UI rules forbid.
- **Header (D6, blended).** Greeting plus date, matching the dashboard's established pattern. No
  permanent counts, and never an overdue tally. The orientation line carries operator voice when
  the day is clear and goes plain the moment an Overdue section exists (DESIGN.md §9 bans
  personality in overdue contexts).
- **Freshness (D5A).** The day rail and the Needs-you rail are on-demand (§10.7), so each header
  carries a muted "as of 8:42" in caption type with a refresh control beside it. They refresh on
  tab focus and on a slow interval, and never blank while refreshing. The work list is live and
  carries no timestamp.
- **Row anatomy:** status circle, title, context line (project · stage · due), right-side meta
  (source badge, assignee avatar). Overdue uses the error intent (`bg-out-soft text-t-out`),
  never brand red (§1). Left-edge 2px red bar on hover, no full-row tint (DESIGN.md Tables).
  Source badges (`auto` / `mention` / `template`) map to existing intents through
  `status-colors.ts` — never hand-rolled classes.
- **Day rail entries** use module hues for wayfinding (§3.7): crew shifts purple, services green,
  project windows blue. Text on any hue fill follows the on-fill rule, never assumed white.
- **Peek (D8A):** a **non-modal, page-level side panel**, not a Dialog and not a Sheet. A modal
  would set the body pointer-events lock, and the panel contains nested menus (mention typeahead,
  snooze menu) — the documented click-swallowing footgun. Non-modal also keeps the list
  arrow-navigable while the panel is open. Focus moves to the panel heading on open and returns
  to the originating row on `Esc`. Radius `--r-lg`.
- **Keyboard:** `Space` peek · `D` done · `↑↓ j k` navigate · `Esc` close · `⌘K` anything. Phase 1
  adds `C` new · `Q` quick-add · `S` snooze · `A` assign · `P` priority · `T` today. All obey
  DESIGN.md §4 and appear in the `?` overlay. Drag-to-schedule (phase 1) has a keyboard
  equivalent through the row menu; drag is never the only path.
- **Navigation (D10A):** Today replaces Dashboard in the mobile bottom nav and becomes the
  landing page after login. The dashboard moves to the account menu, and its "My work" zone is
  removed so the same rows do not render twice. This changes DESIGN.md §16, which must be updated
  in the same PR along with both `app-sidebar.tsx` and `mobile-nav.tsx`.
- **Touch (D9A):** the status circle stays visually small with a full 44px invisible hit area via
  the existing `.touch-target` utility. Tapping anywhere else on the row opens the item. Rows stay
  compact; no swipe gesture in v1.
- **Responsive:** desktop two columns; tablet drops the day rail below the work list; phone single
  column with the day rail collapsed to a "Next up" strip and peek as a bottom sheet.
- **Accessibility:** buckets are real headings with list semantics. The live work list announces
  count changes only, never per-row updates. Viewer role renders static circles.

**Interaction states.** Every cell says what the user *sees*.

| Surface | Loading | Empty | Error | Stale | Partial |
|---|---|---|---|---|---|
| Work list | Skeleton rows matching row shape | Mascot + handwritten line, the all-clear reward | Left-bar notice with retry, list stays | n/a (live) | Buckets render as they resolve |
| Day rail | Skeleton blocks | "Nothing scheduled" plain caption | Left-bar notice, keeps last good data | "as of" timestamp greys | Shows what loaded |
| Needs you | Skeleton rows | "Nothing needs you" plain | Left-bar notice, keeps last good data | "as of" timestamp greys | Shows what loaded |
| Peek | Skeleton in panel | n/a | "This item was removed" + close | n/a | n/a |
| Whole page | Full skeleton, 200ms minimum | First-run: what Today will show once work exists | Recoverable notice, never a full-page replacement | Offline banner, page stays usable | One rail can fail while the list works |

A completed write that fails reverts the row and raises a toast naming what failed. First-run is
distinct from empty: a new user sees an explanation of what will appear here, not an all-clear.

**Morning arc.** Opens the page, wants to know nothing is on fire. Overdue is absent or short.
Today is a short committed list. Triage says who needs something. Two or three actions, then the
page is closed or left open as reference. The all-clear is the emotional payoff and gets the
mascot; everything else stays plain. "Plan my day" does not exist in phase 0.5 because there is
nothing to plan with; it arrives in phase 1 with snooze and time-blocking.

### 8.2 Work item (`/work/[id]` and the peek)

- One model for three kinds: `task` (human), `follow_up` (human, client-linked, the CRM "next
  step"), `system` (generated, §9).
- Four statuses: `todo`, `in_progress`, `done`, `cancelled`. Three priorities (unchanged).
- Two dates: `startDate` (hides until then) and `dueDate` (+ optional `dueTime`). Optional
  `scheduledStart/End` = the agenda block. `snoozedUntil`.
- **Stage** groups work on a project: `quote · prep · load_in · show · return · close`.
  Defaulted from the project's lifecycle status at creation, editable. (Distinct from the crew
  `ProjectPhase` enum, which describes *shifts*, not work.)
- **Links** to any entity (client, contact, quote, invoice, service, crew assignment, asset,
  line item, location) via `workItemLinks` (§10.1), rendered as chips that peek/navigate.
- **Subtasks:** one level (`parentId`). Replaces the untyped `checklist` blob; migration
  converts each checklist entry into a child item.
- **Comments + mentions:** the existing `commentThreads` substrate keyed
  `entityType: "workItem"`. A mention creates a notification (§10.2). Blocking threads are not
  used on work items (that flag is for project prep/send gates).
- **Estimate · logged:** `estimateMinutes` on every item. "Logged" appears only on
  crew-assigned items, from approved `crewTimeEntries` rows that reference the item through an
  optional `crewTimeEntries.workItemId` added in phase 4. PM-side time logging and any timer UI
  are out of scope (§11).
- **Labels:** free-form `tags: string[]` exactly as every other entity stores them
  (FEATUREDOCS/26). No tag table exists and none is added.
- **Recurrence (phase 2, field added then — not in the phase-0 schema):** `every day / week on
  [days] / month on [n]`; the next occurrence is created when the current one is done (Todoist
  model), never pre-generated.
- **Templates:** `workTemplates` — an org-level list of items seeded when a project *enters* a
  lifecycle status (e.g. on `CONFIRMED`: "Send deposit invoice" (Quote, owner = PM, due +1d),
  "Book crew" (Prep, +3d), "Confirm venue access" (Prep, event −5d), "Truck pack" (Load-in,
  event −1d), "Chase balance" (Close, +7d)). Offsets are relative to project start/end.
  Seeding is idempotent per (project, template, status). The `pm` assignee rule resolves to
  `projects.projectManagerId`, else the earliest `projectManagers` row, else unassigned (an
  unassigned item shows in the project Work card, not in anyone's Today).

### 8.3 Project — Work tab, Overview Work card, board, timeline

Wireframe board 2.

- **Tabs:** `tasks` becomes **Work** (`VALID_TABS` in `projects/[id]/page.tsx` — the `?tab=`
  deep link `tasks` keeps working as an alias). Tab label shows "Work · 9 of 14".
- **Overview → Work card:** readiness checks and work items are **one list grouped by stage**,
  each stage with a progress bar. A readiness failure *is* a system work item (`auto` badge,
  "resolves itself when 4/4"), with the same "Open labour / Open equipment" deep-link the
  readiness panel has today. The card replaces the separate readiness panel; the pure check
  logic in `project-readiness-checks.ts` is unchanged and becomes a system source (§9).
- **Work tab:** the full list with view toggle **list / board / calendar** (views are filters;
  save via `savedTableViews` only when the user asks), group by stage / assignee / due,
  filters, quick-add scoped to the project (`@Prep` selects the stage), peek, bulk bar (move
  stage, assign, due, priority, delete — already exists), drag to reorder within a stage using
  the dnd-kit setup from the Equipment tab and a new browser-direct `reorderNative` (the
  existing `reorderMany` is `requireService`-gated and cannot be called from the browser).
- **Timeline row view** (Overview, below Work): one week strip with rows *Gear window ·
  Services · Crew · Work*, built on the agenda engine. Read-only in v1 (drag to reschedule is
  phase 2 of the engine).
- **Board (`/projects?view=board`):** revive `project-board.tsx` on dnd-kit; a drop calls the
  existing status-change mutation (locks and justification dialogs apply exactly as the
  stepper's do). Cards show client, date, "9/14 work · 1 overdue"; quoted cards show **rotting**
  (§8.4). The table remains the default view.

### 8.4 Client and contact records, pipeline

Wireframe board 3.

- **Client page:** hero (unchanged) + 4 stats where the fourth becomes **Since last touch**
  (days since the last timeline row). Actions: *Log call*, *Log email*, *Add note*, *New work*.
- **Next step** sits above the tabs: the single open `follow_up` linked to the client with the
  soonest date. **Rule: while any quote for this client is `SENT`, a next step is required.**
  24 hours after a send with no next step logged, the `quote:nonext` source (§9) puts "Quote
  v1 out, no next step" in the PM's Triage; the board card *rots* by days since the client's
  last timeline touch (amber after 7, `--t-out` after 14 — both org settings). Completing a
  next step asks for a one-line outcome, which becomes a timeline row.
- **Timeline tab (default):** one chronological stream per client and per contact: quote sent
  / accepted / declined / expired, invoice issued / paid, job confirmed / completed, comments
  and mentions, work done, logged calls / emails / notes. System rows are stamped by the
  writers that already exist (`quotesWrites`, `invoicesWrites`, lifecycle transitions); humans
  only log what happened *outside* Flow (D3). Filter chips: All · Logged · Money · Work ·
  Comments.
- **Contacts (phase 5, Relationships — separate data-model work, not part of "what do I do
  today"):** a person can be linked to more than one client **and** to venues (`locations`)
  via a `contactLinks` join, so "Sarah, Events Director at Events by Sarah, also our contact at
  MCEC" is one record. Venues gain **rooms** as child `locations` (the `parentId` hierarchy
  already exists). Phases 0–4 keep today's one-client-per-contact model.
- **Pipeline:** the project board filtered to `ENQUIRY → QUOTING → QUOTED → CONFIRMED`, sorted
  by next-step date, reachable as *Clients → Pipeline*. No new object.
- **Tabs:** Timeline · Projects · Contacts · Work · Notes · Files. Invoices appear inside
  Timeline (Money filter) rather than as a tab, so the client page stays at six tabs.

### 8.5 Crew time (planner layer)

Wireframe board 4.

- **Confirmation badges** on every shift block in `/crew/planner`: `✓ confirmed`, `? offered
  · 2d`, `✗ declined`; header summary "6 of 9 confirmed · 2 offered · 1 declined". Colour is
  never the only carrier (§3.3).
- **Declined or unanswered (> 48h, org setting) offers become system items** in the PM's Triage
  with one-key *Re-offer* (existing offer flow) and *Find cover* (opens the planner filtered
  to eligible + available crew).
- **Request availability…** — bulk: pick a date range and a role, send the existing offer
  email (`src/server/crew-communication.ts`, Resend) to all eligible crew, first-come fill up
  to `crewCountRequired`, auto-nudge unanswered after 24h (existing notification cron, deduped
  through `notificationEmailLogs`). No SMS (none exists).
- **Planned vs actual** column: a *derived, read-only* comparison — planned hours from
  shifts/services, actual from approved `crewTimeEntries`. No new tables. Approval, dispute
  and export flows are untouched. An **OT estimate** at booking time (back-to-back shifts
  crossing the member's `overtimeMultiplier` threshold) is phase 5: it needs the rate rules
  from ROADMAP 2.1.
- **Call-time reminders:** email the day before a confirmed shift with call time, location,
  PM phone — off by default per org.

### 8.6 Cross-cutting UX

- **Peek everywhere.** The same peek component serves work items, and later crew assignments
  and quotes, from any list.
- **Views are filters.** List / board / calendar are displays over one query; saving is
  explicit.
- **Inline over modal.** Titles, dates, assignees and stage edit in place; dialogs are for
  destructive confirmation only (the existing `Dialog`-as-confirm convention).
- **Local-first feel.** Every mutation is optimistic against the Convex subscription; the
  current fingerprint-refetch hack in `tasks-panel.tsx` is removed.
- **⌘K:** `/task`, `/call`, `/note`, `/snooze`; work items indexed in `globalSearch`.
- **Mira / MCP:** curated tools `list_my_work`, `create_work_item`, `complete_work_item`,
  `log_client_touch`, `set_next_step` (all `danger: low/medium`; nothing high). Page context
  passes the focused item. Mira can *draft* a morning brief from Today's data; it never
  schedules.
- **Copy voice:** operator voice on buttons and empty states; plain and personality-free on
  overdue, declined, rotting and conflict rows (DESIGN.md §9).

## 9. System-generated work — derived, not stored

> **Revised by the engineering review, 2026-09-16 (decision R3).** The original version of this
> section specified a 15-minute Convex cron that recomputed each project's readiness and wrote a
> row per problem, with dedupe keys, reopen/cancel/cascade rules and a per-tick budget. The
> review established that `projectReadiness.forProject`'s gear section calls
> `fetchCandidateProjects` (which scans the org's entire project history, uncapped, over two
> indexes) plus `fetchGearData` (line items of every overlapping project), so running it once per
> project per tick is quadratic in org size. Production already carries 6.05 GB of database I/O a
> month with two active users, 4.66 GB of it from a single query
> (`docs/designs/perf-convex-efficiency-2026-06.md:634`). **There is no cron in this program.**

**The rule.** A signal the app can already compute is never stored. Triage runs live indexed
reads. Only a human's *decision about* a signal is persisted, in `workSignalStates` (§10.3).

This deletes, in one stroke: the sweep, per-source budgets, dedupe keys, the reopen rule, the
cancel rule, the cascade-on-delete rule, the `autoResolvedAt` stamp, and phase 1's dependency on
`ENABLE_CONVEX_CRONS` being flipped in production. Nothing can go stale, because nothing is a
copy.

```
            WRITE                         READ (live, indexed)
              │                                    │
  comment mentions you                    workTriage.forMe(orgId)
              │                                    │
              ▼                        ┌───────────┴───────────┐
   notifications row  ◄────────────────┤ mentions (own rows)   │
   (the ONLY event we store, §10.2)    │ crew declined/unans.  │  by_organizationId_status
              │                        │ quotes expiring       │  by_organizationId_status
              ▼                        │ work overdue/due-soon │  by_org_status_dueDate
         bell + Triage                 └───────────┬───────────┘
                                                   │  minus
                                       workSignalStates (snoozed /
                                       dismissed / assigned by a human)
```

**Phase-1 Triage sources** (decision R4 — event-driven only; all indexed, none needs a
whole-org collect, so none trips the collect ratchet):

| Signal | Read | Default owner | Human can |
|---|---|---|---|
| Mentioned in a comment | own `notifications` rows | the mentioned user | reply, make a task, dismiss |
| Crew declined | `crewAssignments.by_organizationId_status` = DECLINED | project PM | re-offer, find cover, snooze |
| Crew unanswered | same index, OFFERED + `offeredAt` older than the org's threshold | project PM | nudge, re-offer, snooze |
| Quote expiring | `quotes.by_organizationId_status` = SENT, then `validUntil` in JS | project PM | open quote, snooze |
| Work overdue / due soon | `by_organizationId_status_dueDate` | its assignee | do it, snooze, reschedule |

Quote status is read through `effectiveQuoteStatus()` (`convex/lib/quoteState.ts`), never the
stored column, so an expired quote is never shown as live.

**Gear shortage, overbooking and asset conflicts are NOT in Triage** (decision R4). They already
have two homes people open deliberately: the project Overview readiness checklist and the
Overbookings board. The dashboard uses the cheap `overbookingBoard.counts` query and only
`/overbookings` loads the full bundle (`src/app/(app)/dashboard/page.tsx:213`); putting the full
board behind a page held open all day would reverse that decision and land the heaviest read in
the app on the most-visited screen.

**Signal identity.** Every derived signal has a deterministic `sourceKey`
(`crew:declined:<assignmentId>`, `quote:expiring:<quoteId>`, `mention:<commentId>:<userId>`).
That key is what `workSignalStates` stores a decision against, and what a materialised item
carries if a human promotes a signal into a real task. Keys are stable across recomputation
because they name the underlying row, not the computation.

**Orphans.** If the underlying entity is deleted, its derived signal simply stops being computed
and any `workSignalStates` row for it never matches again. Harmless, but it accumulates: a
`workSignalStates` row whose `sourceKey` has produced no signal for 90 days is pruned by the
existing dismissal-prune pattern (`notificationDismissals`).

**Day boundaries.** Every "overdue", "due soon", "today" and "hides until start" comparison
resolves in the **organisation's timezone** through the existing helpers in
`convex/lib/quoteDates.ts` and `convex/lib/orgSettings.ts` — never the browser's zone, never UTC.

**What the derived model cannot do.** Assigning a system signal to someone who is not its default
owner requires materialising it as a real work item first (one row, one mutation, keyed by the
same `sourceKey`). That is the accepted cost of R3 and the reason `workSignalStates` carries an
optional `promotedWorkItemId`.

## 10. Data model and architecture

> **Revised by the engineering review, 2026-09-16 (decisions R1, R2, R6, R7).** No new
> `workItems` table: the existing `projectTasks` table is **widened in place**. Convex cannot
> rename a table, so a rename means create-copy-repoint-delete, and `@convex-dev/migrations` is
> not installed (`convex/convex.config.ts` registers only the rate limiter and sharded counter),
> so any copy is hand-rolled. Widening preserves every row id, every `entityType: "ProjectTask"`
> audit row, every deep link, every saved view, and all 17 registry operations — which also
> keeps the agent-reachability floor (573, `docs/api-coverage.md`) safe by construction, since
> nothing is ever subtracted. The product says "work"; the table keeps its name. A cosmetic
> rename stays available later and is not worth a migration on its own.

Everything below follows the Convex rules in CLAUDE.md: `ConvexError` only, `requireOrgReadFor`
with a resource on every new read, colocated `agentOps` with danger classes, browser-direct
`*Native` mutations mirroring their Zod bounds server-side (`fieldGuards.ts`), every doc fetched
by a global index org-checked (the `by_cuid` ratchet sits at baseline **0** — a single new
public `by_cuid` read without a `require*Org*` call or an inline `organizationId` comparison
fails CI), `assertBulkSizeOk` on bulk ops, and the registry / OpenAPI / MCP manifest regenerated
and committed together.

### 10.1 `projectTasks`, widened (no new table)

```ts
// EXISTING fields keep their names and semantics. Added in phase 0:
kind: v.optional(v.union(v.literal("task"), v.literal("follow_up"))),   // absent = "task"
stage: v.optional(WorkStage),              // quote | prep | load_in | show | return | close
parentId: v.optional(v.string()),          // one level of subtasks; replaces `checklist`
startDate: v.optional(v.number()),         // org-tz midnight; hides the row until then
dueTime: v.optional(v.string()),           // "HH:mm" in the org timezone
scheduledStart: v.optional(v.number()), scheduledEnd: v.optional(v.number()),  // agenda block
snoozedUntil: v.optional(v.number()),
estimateMinutes: v.optional(v.number()),
tags: v.optional(v.array(v.string())),     // FEATUREDOCS/26 shape, free-form strings
sourceKey: v.optional(v.string()),         // set only when a human promotes a derived signal
isPrivate: v.optional(v.boolean()),
// CHANGED: projectId becomes optional (personal and client-scoped work has no project)
// KEPT for one release, then dropped: checklist (v.any()) — see the migration below
// Added in a later phase, not now: templateId (1), recurrence + watcherUserIds (2)

// New indexes (all org-prefixed — users are multi-org, so no global assignee index):
.index("by_organizationId_assigneeUserId_status", ["organizationId", "assigneeUserId", "status"])
.index("by_organizationId_assigneeCrewId_status", ["organizationId", "assigneeCrewId", "status"])
.index("by_organizationId_status_dueDate",        ["organizationId", "status", "dueDate"])
.index("by_parentId",                             ["parentId"])
.searchIndex("search_title", { searchField: "title", filterFields: ["organizationId"] })
```

`status` gains `"cancelled"`. Priority is unchanged. **Module naming matters:** the new
operations live in `convex/projectTasks.ts` / `convex/projectTasksWrites.ts`, because
`convex/xtenantExhaustive.test.ts` sweep B seeds rows by treating the module name as a schema
table name — a module that does not match the table silently drops out of the sweep.

**Stage defaults from the project's lifecycle status**, resolved once in the shared vocabulary
module (§10.6), never inline:

| Project status | Default stage |
|---|---|
| ENQUIRY, QUOTING, QUOTED | `quote` |
| CONFIRMED, PREPPING | `prep` |
| CHECKED_OUT | `load_in` |
| ON_SITE | `show` |
| RETURNED | `return` |
| COMPLETED, INVOICED | `close` |
| CANCELLED | none — an existing stage is kept |

**Subtasks.** A child row carries `parentId`, inherits `projectId` and `organizationId` from its
parent, and has no `stage` and no `sourceKey`. Cascade rules are a **regression surface**:
`convex/projectWrites.ts:961` (delete) and `:1056` (clone) already sweep tasks and must now
sweep their children too. Both get a test (§ test plan).

### 10.2 `notifications` — the one thing phase 0 stores that it did not before

```ts
notifications: defineTable({
  id: v.string(), organizationId: v.string(), userId: v.string(),
  type: v.string(),          // mentioned | assigned | comment_reply | due_soon | overdue
  entityType: v.string(), entityId: v.string(),
  title: v.string(), body: v.optional(v.string()), href: v.string(),
  dedupeKey: v.string(), readAt: v.optional(v.number()), archivedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_cuid", ["id"])
  .index("by_organizationId_userId_readAt",    ["organizationId", "userId", "readAt"])
  .index("by_organizationId_userId_createdAt", ["organizationId", "userId", "createdAt"])
  .index("by_organizationId_dedupeKey",        ["organizationId", "dedupeKey"]),
```

- Written **inside** the mutation that causes it — a mention row is inserted in the same
  transaction as the comment (`convex/collaborationWrites.ts`), so the comment and the
  notification commit together or not at all. This is deliberately unlike `logActivity`, which
  is best-effort because it crosses into another system; this does not.
- **One notification per event.** Creating or reassigning a work item emits exactly one, typed
  `assigned`; a mention emits exactly one, typed `mentioned`. A derived signal emits none — it is
  computed, so there is nothing to announce twice.
- The **bell** switches to these stored rows. The dashboard "Needs attention" chip tray keeps
  using the nine derived org-wide types in `src/server/notifications.ts`, unchanged. Note that
  `getNotifications` currently performs whole-org reads on every render
  (`getProjectsByOrg` / `getAssetsByOrg` / `getCrewAssignmentsByOrg`); moving the bell off it is
  a read-cost improvement, not a regression.
- Unread count is a plain indexed query on `by_organizationId_userId_readAt`. **No sharded
  counter** — that component exists for hot-row write contention on shared org counters, and a
  per-user unread count is neither hot nor shared.
- `userNotificationPreferences` gains the new types. The email digest reuses the existing
  15-minute cron and its `notificationEmailLogs` dedupe ledger. Web push is phase 2.

### 10.3 `workSignalStates` — a human's decision about a derived signal

```ts
workSignalStates: defineTable({
  id: v.string(), organizationId: v.string(), userId: v.string(),
  sourceKey: v.string(),                      // deterministic, names the underlying row (§9)
  state: v.union(v.literal("snoozed"), v.literal("dismissed"), v.literal("promoted")),
  snoozedUntil: v.optional(v.number()),
  promotedWorkItemId: v.optional(v.string()),  // set when promoted to a real row
  createdAt: v.number(), updatedAt: v.number(),
})
  .index("by_cuid", ["id"])
  .index("by_organizationId_userId_sourceKey", ["organizationId", "userId", "sourceKey"])
  .index("by_organizationId_sourceKey",        ["organizationId", "sourceKey"]),
```

Rows exist **only** for signals a human acted on. A dismissal is per-user, so one PM clearing a
signal never hides it from another. Pruned after 90 days of producing no signal.

### 10.4 The checklist migration (the only data migration in the program)

The untyped `checklist: v.any()` blob becomes subtask rows, using the repo's house pattern
(`convex/backfillProjectWindow.ts` + `scripts/convex-backfill-project-window.ts`): a public
mutation gated by `requireService`, `paginate({ cursor, numItems: numItems ?? 300 })`, an
`apply` flag that defaults to a dry run, returning `{ scanned, updated, isDone, continueCursor }`,
driven by a `tsx` script that takes a fresh client per page, with a colocated test.

Each entry `{ id, text, done }` becomes a child row: **id preserved**, `title = text`,
`status = done ? "done" : "todo"`, `completedAt = parent.updatedAt` when done, no assignee, no
dates, `sortOrder` = array index. The blob is left in place for one release (expand-contract:
Convex functions deploy before the app image), then dropped.

### 10.5 Permissions — a new `work` resource

The warehouse role holds `project: ["read"]` only (`convex/lib/permissionsCore.ts:161`), so
gating work on `project:update` would leave an ops lead unable to complete their own item —
a day-one blocker given decision D1. Phase 0 adds `work` to `RESOURCES` (19 → 20):

| Role | `work` |
|---|---|
| owner, admin, manager | read, create, update, delete |
| member | read, create, update |
| warehouse | read, create, update |
| viewer | read |

(`crew` is a *resource*, not a role. A crew-linked user holds a member or warehouse account and
reads their own items through `requireSelfScope`.)

Same-PR consumers: `src/lib/permissions.ts` (`PERMISSION_REGISTRY`),
`src/lib/permissions.test.ts` (asserts the list is exactly 19 — must become 20),
`src/lib/api/oauth/rbac-scopes.ts` (`RESOURCE_LABELS` / `ACTION_LABELS`; scope narrowing itself
iterates `RESOURCES` and needs no change), and
`src/components/settings/permission-matrix.tsx` (throws if a registry entry is missing).
Project-scoped reads use `requireOrgReadFor(ctx, orgId, "work")`; personal-scope reads use
`requireSelfScope`.

### 10.6 One shared vocabulary module

`convex/lib/permissionsCore.ts` already proves an import-free module bundles into both the Next
and Convex runtimes. Status, priority, kind, stage, the status-to-stage map and the display
labels live in one such module, imported by the Convex validators, the Zod schemas and the UI.
This replaces the two hand-synced copies that exist today (`convex/lib/validators.ts:453` and
`src/lib/project-tasks.ts:6`) rather than adding a third.

### 10.7 Reactivity posture (decision R13)

Convex re-runs a query and re-pushes to every viewer whenever anything inside its read set is
written. The app shell holds **no** always-on subscriptions today, so Today would be the first
page to introduce a permanent background cost, on the page people never close. Reactivity is
therefore spent where the user is the one causing the change:

| Data | Posture | Why |
|---|---|---|
| **My work** | **Live subscription** | I am the writer. Ticking something off must feel instant, and the read set is my own rows |
| **My day** (shifts, services) | One-shot, refresh on focus + slow interval | Someone else's edit, and the schedule changes a few times a day |
| **Signals** (quotes, crew, invoices by status) | One-shot, refresh on focus + slow interval | Changes hourly at most; a live wire over org-wide status ranges is the exact shape that produced the 4.66 GB query |

On-demand panels carry a visible "as of" timestamp so stale never reads as absent. Each bucket
is **capped server-side** with a count ("312 more"), not client-paginated — there is no
virtualisation library in the tree and this page must not introduce one.

### 10.8 API surface

`agentOps`: create / update / complete = `medium`; delete and bulk delete = `high` (confirmation
gate); reads = `low`. No new privileged arguments. New browser-direct `reorderNative` (the
existing `reorderMany` is `requireService`-gated and unreachable from the browser). Webhook
events `work.created` and `work.completed`. Curated Mira and MCP tools land in the continuous
track. `scripts/org-export-tables.ts` classifies the two new tables and bumps
`EXPECTED_TABLE_COUNT` 119 → 121, or `convex/orgExport.test.ts` fails.

## 11. What is deliberately *not* built

- Outbound client email, portal, e-signature, payments (D3).
- Custom statuses, per-org workflow builders, a rules engine beyond lifecycle templates (v1).
- Auto-scheduling, timers, PM-side time logging, a rich-text editor, a Gantt with
  dependencies, time tracking as a billing source.
- A crew-facing Today (D1). Crew keep the email + token flow.
- SMS.

## 12. Approaches considered

| | A — Patch tasks in place | **B — Work-layer spine (chosen)** | C — Inbox-first |
|---|---|---|---|
| Summary | DnD, filters, comments, notifications, subtasks on `projectTasks` | New spine (§10) + Today, Project, Client, Crew surfaces (§8), phased | Triage/inbox becomes the home page; Today, boards and dashboard are views over it |
| Effort | S (human ~3 wks / CC ~2 days) | XL (human ~16 wks / CC ~4 wks, phases 0–5) | XL |
| Risk | Low | Med | High |
| Pros | Fast; polishes what people already see | One model under tasks, CRM and time; notifications finally stored; each phase ships standalone | Everything inbound in one place; strongest "whoa" |
| Cons | Still isolated from clients, calendar, notifications; project-required stays | Multi-month; needs the migration and a new resource | Noise risk; breaks the dashboard's three-zone law; ops leads live in scans, not an inbox |
| Reuses | `tasks-panel`, `reorderMany`, dnd-kit | Everything in §3 plus `commentThreads`, `savedTableViews`, `tags`, notification cron + `notificationEmailLogs`, `project-board.tsx`, readiness checks, `overbookingBoard`, `quoteState`, the crew offer flow | Same as B |
| Completeness | 4/10 | 9/10 | 8/10 |

**Recommendation: B.** A's items land inside phases 1–2 anyway; C's best idea (Triage) lands as
a bucket inside Today without upending the home page.

## 13. Phasing — evidence first (revised 2026-09-16, decision R10)

> The engineering review's outside voice made the point the plan had made about itself and then
> ignored: §17 asks for a week of logging where work actually arrives from, and a morning
> watching the ops lead plan their day. Neither has happened. The original phase 0 committed to
> the schema change, the permission change and the data migration **before** that evidence.
> The sequence below inverts it. The one piece that cannot be composed from what already exists
> is the mentions inbox, because Convex cannot index the `mentionUserIds` array, so nothing can
> answer "who was mentioned" without a stored row. That piece goes first. Everything else waits.

| Phase | Ships | Exit criteria | Effort |
|---|---|---|---|
| **0 · Mentions inbox** | `notifications` table; the mention hook writing one row inside the comment transaction; bell reads stored rows; per-type preferences; `/activity` gains its missing task labels | A mention reaches the bell within one tick; zero mentions lost over a week; no change to any existing task behaviour | 3 days / 4 hrs |
| **0.5 · Today, composed** | `/today` assembled **read-only** from readers that already exist (`myOpenTasks`, crew shifts and services for the day, quotes and crew signals by status) plus the mention inbox. Buckets, peek, keyboard navigation, the agenda column. No schema change, no new resource, no migration. `/my-tasks` redirects | Opened daily by both named user groups for two weeks; the week-long log (§17) collected against a real page | 1 wk / 1 d |
| **1 · The spine, informed** | Widen `projectTasks` in place; the shared vocabulary module; `work` resource **additively** (see R11); subtasks + the checklist migration in the order R12 sets; quick-add, snooze, promote-a-signal, templates | Migration proven id-preserving, idempotent and no-op in dry run against a copy of prod; the vocabulary matches the log, not a guess | 2 wks / 3 d |
| **2 · Project** | Work tab (list / board / calendar, filters, drag reorder), Overview Work card replacing the readiness panel, timeline row, recurrence, the revived board with drag-to-advance, web push | Readiness panel deleted with no lost check; a board drop honours lifecycle locks | 3 wks / 4 d |
| **3 · Client** | `workItemLinks` + the unified timeline read model (both deferred here); client and contact timeline; Log call / email / note; Next step + rotting; Pipeline view | Every sent quote carries a dated next step within 24 hours (target 95%) | 3 wks / 4 d |
| **4 · Crew time** | Planner confirmation badges + offer age, unanswered nudge, bulk availability requests, planned vs actual, call-time reminders | Median decline to re-offer under 4 business hours | 3 wks / 4 d |
| **5 · Relationships** (own mini-design) | Contacts across clients and venues, venue rooms, OT estimate at booking | A contact opens from a venue and a client with one timeline | 2 wks / 3 d |

**Why 0.5 is not throwaway.** The page, its buckets, its keyboard model and its peek panel are
the deliverable. Phase 1 changes where the rows come from, not what the page is. If a composed
Today does not get opened daily, that is the cheapest possible discovery that phases 2 to 5 are
not worth building.

## 14. Open questions

1. Privacy default for unlinked personal items — private to assignee + admins (proposed) or
   org-visible?
2. Should Triage show only items assigned to me, or also *unassigned* items on projects I
   manage? (Proposed: assigned-to-me only; unassigned stays on the project Work card.)
3. Should the project Work card show system items assigned to *other* people, or only mine
   plus unassigned? (Proposed: everyone's, grouped by stage — it is the job's list, not mine.)
4. Recurring items (phase 2): personal-only, or also org-shared rosters (e.g. a weekly
   "chase balances" owned by whoever holds the `ops` role)?
5. Large-org lists: no virtualisation library exists; cap + server pagination (proposed) or add
   `@tanstack/react-virtual`?
6. Does `work:*` need a separate `work:manage` for editing others' private items?

## 15. Success criteria

- Today opened on ≥ 80% of working days by every PM/ops user within 4 weeks of phase 1.
- ≥ 50% of open work items are system-generated, and ≥ 90% of those resolve without a human
  closing them.
- 95% of `SENT` quotes carry a dated next step within 24 hours (phase 3).
- Median time from crew decline to re-offer under 4 business hours (phase 4).
- Overdue work items per active project trend down week over week for 8 weeks after phase 2.
- Qualitative: the week-long "work from outside Flow" log (§17) shrinks to near zero on a
  repeat run one month after phase 3.

## 16. Dependencies and risks

- **The checklist migration is the only irreversible step left** (§10.4). It runs dry first, is
  idempotent, preserves ids, and executes after the widened schema is live. Rehearse it against
  a copy of production data, not just seeded fixtures.
- **The guard choice is the expensive mistake.** A new read on the bare `requireOrgRead` instead
  of `requireOrgReadFor(ctx, orgId, "work")`, or a write left on `requireService`, classifies the
  operation as agent-unreachable. The reachability floor auto-ratchets **up** and never down, so
  the error surfaces later, after the schema has merged. Get it right in the first commit.
- **`xtenant-bycuid-ratchet` sits at baseline 0.** One new public `by_cuid` read without a
  `require*Org*` call or an inline `organizationId` comparison in the same function body fails CI
  on the first offender.
- **Module names must equal table names** for `xtenantExhaustive` sweep B to seed rows; a new
  module that does not match silently drops out of the cross-tenant sweep rather than failing.
- **Notification volume:** dedupe keys, the one-notification-per-event rule (§10.2) and per-type
  preferences are mandatory from phase 0, or the bell becomes the new chip tray.
- **Timezones:** every day boundary goes through `convex/lib/quoteDates.ts`; a UTC or
  browser-timezone bucket puts an Australian PM's "Today" a day out.
- **No cron dependency.** With §9 derived, `ENABLE_CONVEX_CRONS` is no longer on the phase-1
  critical path. It returns only if a future phase adds a genuinely time-triggered source.
- **Read cost on Today.** Three subscriptions, all indexed, no whole-org collect. The failure
  mode to watch is bucket size, which is capped server-side; there is no virtualisation library
  and this page must not introduce one.
- **No rich text**: descriptions stay markdown-lite textareas with an `@` typeahead.
- **Two registered exceptions expire soon** and both underpin readers this program reads around:
  `reservationConflicts-orgGraph` (2026-10-25) and `overbookingBoard-sale-stock-models`
  (2026-10-26). Neither is created by this work, but phase 2 leans on the board.
- **Crew overhaul (2.1) overlap:** phase 4 is the seam; both docs cross-link.

## 17. The assignment

Two things, before phase 1 is designed in detail:

1. **For one working week, log every piece of work that arrives from outside Flow** — Slack,
   WhatsApp, email, phone, memory — with its source, what it was about, and what you did with it
   (typed it somewhere / did it / forgot it). Bring the log. It sets the order of the system
   sources (§9) and the quick-add grammar (§8.1).
2. **Sit behind the ops lead for one morning while they plan the day, and don't help.** Note
   what they open first, what they write down by hand, and what they ask someone. That is the
   Today page's real spec.

## 18. What I noticed about how you think

- You didn't say "tasks need work", you said they *"feel very half baked and just thrown on the
  side"* — that's a product-owner's read (it's about how it feels in the hand), not a backlog
  item.
- *"RVLT is the everything management software for us"* — you framed this as the company's
  operating system, not a feature. That framing is what makes the spine (not a task app) the
  right answer.
- You picked **both** personal and crew time at equal weight when the safe answer was
  "personal first". Ambition, with a real seam to the crew overhaul to keep it honest.
- You kept *"Flow doesn't email clients"* when a portal was on the table. That's a deliberate
  boundary, and it makes the CRM smaller and truer.

## 19. Reviewer concerns (standing)

- **The sweep-cost concern recorded on 2026-09-15 is resolved, not deferred.** It was the reason
  the engineering review replaced the cron with derived signals (§9, decision R3). Nothing in
  phases 0 to 2 now runs a scheduled recomputation, so the open question "can we afford one
  org-graph load every 15 minutes" no longer needs answering to ship.
- **What remains measurable rather than known:** bucket sizes on Today for a heavy user, and the
  read cost of the three subscriptions against the largest org. Both are phase-1 exit criteria
  and both are cheap to measure, unlike the thing they replaced.
- **`docs/designs/perf-convex-measurement-baseline.md` still has an empty "Before" column.** Any
  claim this program makes about read-cost improvement is unverifiable until someone fills it in.

---

## 20. Engineering review record (2026-09-16)

Run with `/plan-eng-review` against phases 0 and 1. Nine decisions, taken one at a time. Two
codebase audits backed the findings: read-cost of the org-wide readers, and the CI gate surface a
new table or operation must clear.

### 20.1 Decisions

| # | Finding | Decision | Effect |
|---|---|---|---|
| R1 | Convex cannot rename a table and no migration framework is installed, so `workItems` means copy-repoint-delete | **Widen `projectTasks` in place** | Removes the program's only irreversible structural step; ids, audit rows, deep links, saved views and 17 registry ops untouched |
| R2 | `workItemLinks` and the timeline read model have no phase 0/1 consumer | **Both deferred to phase 3** | Two fewer subsystems carried through CI unused; shapes decided with the screen that needs them |
| R3 | The 15-minute sweep would run a quadratic per-project read; prod is already 6.05 GB/month with 77% from one query | **Derive system work, store only a human's decision** | Deletes the cron, dedupe keys, reopen/cancel/cascade rules and the `ENABLE_CONVEX_CRONS` dependency |
| R4 | The dashboard deliberately uses the cheap counts query; only `/overbookings` loads the full board | **Triage carries event-driven signals only** | Keeps the heaviest read off a page held open all day; gear and overbooking keep their existing homes |
| R5 | The warehouse role holds `project:read` only, so ops leads cannot complete their own work | **Add a `work` RBAC resource in phase 0** | Today is usable by both named daily-user groups on day one |
| R6 | `checklist: v.any()` plus `parentId` would be two ways to say one thing | **Migrate the blob to subtask rows** | One validated representation; subtasks gain owners and dates |
| R7 | Status and priority are hand-synced in two files; the plan would make it six | **One shared vocabulary module** | A rename becomes a compile error instead of a runtime rejection |
| R8 | 27 of 31 phase 0/1 code paths had no test, including 3 migration paths and 2 regressions | **Close all 27, including 3 browser tests** | Migration proven before it runs; the permission gap caught by a test, not a user |
| R9 | Six card-level subscriptions walk into open Finding #4 | **Three subscriptions grouped by change rate** | A keystroke re-runs one small query, not the page |
| R10 | The plan's own field research (§17) had not been done, yet phase 0 committed to the migration | **Invert the sequence**: mentions inbox, then a composed Today, then the spine | No irreversible step taken before the evidence; Today reaches users in days |
| R11 | `apiKeys.scopes` is a frozen stored string, so repointing task ops to `work:*` would break every issued key, OAuth grant and cached Mira key | **The `work` resource lands additively** | Task ops accept `work:X` **or** `project:X` during transition; presets widened; no key is invalidated |
| R12 | Every task reader collects with no parent concept (`convex/projectTasks.ts:34`, `:80`, `:178`) | **Reader filters ship and deploy before the backfill runs** | Checklist rows can never surface as top-level tasks in the three UIs |
| R13 | The app shell holds no always-on subscriptions; Today would be the first, on the page nobody closes | **Live only for my own work; signals and agenda on demand** | Reactivity spent where the user is the writer |

### 20.2 What already exists (reused, not rebuilt)

| Need | Existing thing | Verdict |
|---|---|---|
| Task storage, RBAC, rate limiting, audit | `projectTasks` + `projectTasksWrites` (18 tests) | Widened, not replaced |
| Comments, threads, mentions | `commentThreads` / `comments` with `mentionUserIds` | Reused; only the notification write is new |
| Org-timezone day boundaries | `convex/lib/quoteDates.ts`, `convex/lib/orgSettings.ts` | Reused verbatim |
| Derived org-wide signals | `overbookingBoard`, `projectReadiness`, `reservationConflicts` | Left where they are; Triage does not call them (R4) |
| Quote state truth | `effectiveQuoteStatus()` in `convex/lib/quoteState.ts` | Reused; never read the stored column |
| Paginated data migration | `convex/backfillProjectWindow.ts` + driver script + test | Copied as the pattern for R6 |
| Both-runtime shared module | `convex/lib/permissionsCore.ts` | Copied as the pattern for R7 |
| Saved views, tags, drag and drop | `savedTableViews`, free-form `tags`, dnd-kit in the Equipment tab | Reused |
| Email digest + dedupe | 15-minute notification cron + `notificationEmailLogs` | Reused |
| Dead code to revive | `project-board.tsx` (7-column kanban, disabled) | Revived in phase 2 |

### 20.3 NOT in scope

| Deferred | Why |
|---|---|
| Renaming the table to `workItems` | A table name is not a product surface; not worth a copy migration (R1) |
| `workItemLinks`, unified timeline | No phase 0/1 consumer; phase 3 owns both (R2) |
| Any scheduled recomputation | Derived signals make it unnecessary (R3) |
| Gear, overbooking and conflict signals in Triage | They have two homes already, and the read is the most expensive in the app (R4) |
| Outbound client email, portal, payments | Decision D3 stands |
| Auto-scheduling, timers, PM-side time logging | A planner that reshuffles you is noise in this business |
| Rich-text editor, list virtualisation, charting | None exists in the tree; each is its own decision |
| Crew-facing Today, SMS | Decision D1: crew stay on the email and token flow |
| Web push | Phase 2; needs a key pair, a subscriptions table and a service worker |

### 20.4 Failure modes for every new code path

| Path | Realistic production failure | Test? | Handled? | User sees |
|---|---|---|---|---|
| Checklist migration | Re-run duplicates every subtask | Yes (idempotency) | Yes, guard on existing child | Nothing; it no-ops |
| Checklist migration | Partial run leaves half a task migrated | Yes (cursor resume) | Yes, page-at-a-time with both shapes readable | Nothing |
| Mention → notification | Notification insert throws, comment already written | Yes | Yes, same transaction, both roll back | Comment fails with a clear error |
| Triage derive | A referenced project was deleted mid-read | Yes | Yes, signal simply stops computing | Row disappears |
| Triage derive | Snoozed signal reappears early on a timezone edge | Yes (unit) | Yes, org-tz boundary | Row returns a day late at worst |
| `reorderNative` | Two people reorder at once | Yes | Convex transaction ordering | Last write wins, list re-renders |
| Bucket cap | A user with 400 overdue items | Yes | Yes, server cap + count | "312 more" instead of a hang |
| Subtask cascade | Project deleted, children orphaned | Yes (regression) | Yes, cascade sweeps children | Nothing left behind |
| Work assigned to a departed member | Assignee no longer in the org | Yes | Falls back to unassigned on the project card | Item shows as unassigned |
| **Silent-failure check** | None of the above is both untested and unhandled | — | — | — |

### 20.5 Worktree parallelisation

| Step | Modules touched | Depends on |
|---|---|---|
| A1 Vocabulary module + permissions resource | `convex/lib/`, `src/lib/`, `src/components/settings/` | — |
| A2 Schema widen + indexes | `convex/schema.ts`, `scripts/org-export-tables.ts` | — |
| B1 Work operations + guards | `convex/projectTasks*.ts` | A1, A2 |
| B2 Notifications table + bell | `convex/notifications*.ts`, `src/components/layout/` | A2 |
| B3 Checklist migration | `convex/backfill*.ts`, `scripts/` | A2, B1 |
| C1 Today page | `src/app/(app)/today/`, `src/lib/work-*` | B1 |
| C2 Triage derive | `convex/workTriage.ts` | B1, B2 |

```
Lane A: A1 + A2          (parallel with each other, both independent)
            │
Lane B: B1 ─┼─ B2        (B1 and B2 parallel once A lands; B3 after B1)
            │
Lane C: C1 ─┴─ C2        (parallel once B lands)
```

Launch A1 and A2 in parallel worktrees and merge both. Then B1 and B2 in parallel, B3 after B1.
Then C1 and C2 in parallel. **Conflict flag:** A1 and B1 both touch `convex/lib/`, so A1 must
merge before B1 starts rather than running alongside it.

### 20.6 Outside voice (independent agent, no session context)

Codex was unavailable, so the cold read ran as an independent agent with the revised plan and no
conversation history. Four objections, all recorded here because two changed the plan:

1. **"Killing the cron did not remove the read cost, it made it unbounded."** Bounded off-screen
   ticks were replaced by always-open subscriptions over org-wide index ranges, on the page
   people never close. Indexed means cheap per run, not bounded run count. **Accepted in part →
   R13:** reactivity kept only where the user is the writer. The read sets in question are small
   and low-churn, unlike the query that produced the 4.66 GB bill, so this is a posture change
   rather than a reversal.
2. **"Ship Today with no schema change and do the field research first."** **Accepted → R10.**
3. **"Backfill before readers equals visible corruption."** Verified against
   `convex/projectTasks.ts:34`, `:80`, `:178` — every read collects with no parent concept.
   **Accepted → R12.** Both reviewers agree, so this was applied as a correction rather than put
   to a decision.
4. **"The `work` resource is not additive."** Verified: `apiKeys.scopes` is
   `v.optional(v.string())`, frozen at mint and at OAuth consent, and
   `src/lib/api-key-presets.ts:38` hand-maintains the resource list. **Accepted → R11.**

One challenge is **unresolved and cheap to settle**: the outside voice argues the warehouse
permission gap may be theoretical, since an ops lead in a two-user organisation is probably a
`member`, who already holds `project:update`. Count the members per role in production before
phase 1 spends effort on R5. If nobody holds the `warehouse` role, R5 shrinks to a rename.

### 20.6 Completion summary

| Section | Result |
|---|---|
| Step 0 scope challenge | Scope reduced: table copy removed, two subsystems deferred |
| Architecture | 4 issues, all resolved |
| Code quality | 1 issue, resolved |
| Tests | Coverage map produced, 27 gaps identified, all scheduled |
| Performance | 1 issue, resolved |
| Failure modes | 0 critical gaps (no path is both untested and unhandled) |
| Outside voice | Ran (independent agent); 4 objections, 3 accepted, 1 open and cheap to settle |
| Unresolved decisions | One: does anyone actually hold the `warehouse` role in production? |

---

## 21. Design review record (2026-09-16)

Run with `/plan-design-review` against §8.1 and the wireframes, focused on the version that ships
first. The mockup generator is not built in this checkout, so the HTML wireframes are the visual
reference. DESIGN.md was binding throughout.

### 21.1 Ratings

| Pass | Before | After | What moved it |
|---|---|---|---|
| 0 · Overall completeness | 5/10 | 9/10 | The version shipping first now has a design |
| 1 · Information architecture | 4/10 | 9/10 | Work is the anchor, day is context, bucket order inverted |
| 2 · Interaction states | 3/10 | 9/10 | Full state table including staleness and partial load |
| 3 · Journey and emotional arc | 2/10 | 9/10 | Morning arc, all-clear reward, no shaming counts |
| 4 · AI slop risk | 7/10 | 9/10 | Buckets became sections, killing the card mosaic |
| 5 · Design system alignment | 6/10 | 9/10 | Components named, peek container decided, hues assigned |
| 6 · Responsive and accessibility | 3/10 | 8/10 | Touch targets, focus return, live-region policy, bottom nav |
| 7 · Unresolved decisions | — | 0 open | All eight resolved into the plan |

### 21.2 Decisions

| # | Finding | Decision |
|---|---|---|
| D3A | "Read-only" was wrong and would produce a page you cannot use | Phase 0.5 is **composed**: every write that already exists is included. Only new columns are deferred |
| D4A | Two competing organising principles, and inbound work came first | Work list anchors the page, day rail is context, order is Overdue, Today, Triage, Later |
| D5A | On-demand panels made staleness a visible state with no treatment | Quiet "as of" timestamp, refresh on focus, never blanks |
| D6 | A permanent overdue count is a daily reminder of failure | Greeting and date, no counts, Overdue renders only when non-empty, personality drops when it appears |
| D7A | Four bordered buckets is the card mosaic the app rules forbid | Buckets are sections with a labelled rule |
| D8A | Nested menus inside a modal hit the documented pointer-events lock | Peek is a non-modal page-level panel; list stays arrow-navigable |
| D9A | A 12px status circle fails the 44px touch minimum | Small circle, full 44px invisible hit area, no swipe gesture |
| D10A | Today was unreachable on phones: no sidebar and no bottom-nav slot | Today takes the dashboard's bottom-nav slot and becomes the landing page; the dashboard's my-work zone is removed |

### 21.3 What already exists (reused, not rebuilt)

`SectionHeader` for bucket labels, `StatusIndicator` and `intentStyles` for every status colour,
`PersonAvatar` for assignees, `EmptyState` with the spot illustrations and the mascot for the
all-clear, `Skeleton` for loading, `useKeyboardShortcut` for the verb keys, the motion utilities
for row entrance, the `.touch-target` utility for the 44px hit area, the two-column detail layout
for the page shell, and the greeting pattern the dashboard already uses.

### 21.4 NOT in scope

| Deferred | Why |
|---|---|
| Quick-add, snooze, drag-to-schedule, subtasks | Each needs a column that phase 0.5 does not add |
| "Plan my day" ritual | Nothing to plan with until snooze and time-blocking exist |
| Swipe-to-complete on phones | Undiscoverable with no other swipe actions in the app to build on |
| A distinct module hue for Today | It is personal scope, not a module; it keeps the Projects blue that My tasks uses today |
| Density toggle, saved views on Today | Phase 2 concern once the list is long enough to need them |

### 21.5 Follow-on doc changes required in the same PR

DESIGN.md §16 lists the five bottom-nav items and requires any change to be applied to both
`app-sidebar.tsx` and `mobile-nav.tsx`. Decision D10A changes that list, so §16 and its decisions
log need updating alongside the code, and the dashboard layout section needs its "My work" zone
removed.

### 21.6 Approved mockup

| Screen | Path | Direction |
|---|---|---|
| Composed Today (phase 0.5) | `~/.gstack/projects/gearflow/designs/today-20260916/today-composed.html` (+ `.png`) | Work list anchors the page, day and needs-you rails on the right with freshness stamps, buckets as sections, non-modal peek, Today in the phone bar. Rough wireframe: hierarchy and interaction only, DESIGN.md governs every visual. |

The earlier four-board set in `mockups/work-layer-wireframes.html` still describes the project,
client and crew surfaces. Its Today board (board 1) is **superseded** by the above: it shows the
pre-review layout with bordered buckets, Triage first and a header count.
