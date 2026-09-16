# Work layer — tasks, project management, client relationships, time

> _Owner: Jayden Nawotka · Created: 2026-09-15 · Status: **APPROVED** 2026-09-16 (office-hours, decisions D1–D5) · Review quarterly (POLICY.md R-5.5)_

**Mode:** intrapreneurship / startup (RVLT Flow is the company's own operating system and a
sold product). **Stage:** has users (the company runs on it daily at flow.rvlt.app).
**Binding constraint:** [`DESIGN.md`](../../DESIGN.md). **Governing policy:** [`POLICY.md`](../../POLICY.md).
**Wireframes:** [`mockups/work-layer-wireframes.html`](./mockups/work-layer-wireframes.html)
(intentionally rough — hierarchy and interaction shape only; DESIGN.md governs visuals).
**Review status:** three adversarial cold-read passes (independent reviewer, no session
context): 16 → 14 → 7 findings, all applied. The one standing concern is recorded in §19.
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

### 8.1 Today (`/today`, replaces `/my-tasks`)

Wireframe board 1.

- **Header:** "Today · Tuesday 15 September · 4 on the floor · 3 to triage". Actions: *Plan my
  day* (opens the This week bucket expanded for dragging into Today), *New* (`C`).
- **Quick-add bar** (`Q` focuses it from anywhere on the page): live token parsing, chips
  rendered as the user types, tokens stripped from the title. Grammar v1: dates/times in plain
  English (`fri 2pm`, `tomorrow`, `in 3 days`, `mon 06:30`); `@Project name` (fuzzy, existing
  `globalSearch` project index); a contact or client name resolves to a link chip; `!high` /
  `!low`; `est 45m`. (`every mon` joins the grammar in phase 2 with recurrence.) `Enter`
  creates; `⇧Enter` creates and opens the peek.
- **Left column — Agenda.** A day column from the agenda engine (§10.4): my crew shifts,
  services on projects I manage or am assigned to, calls (work items with a time), time-blocked
  work items, project windows as all-day bands. Drag a work item from the right onto the column
  to set `scheduledStart/End`; drag it back to clear. **No auto-scheduling.** "Now" line.
- **Right column — My work.** Buckets in this order: **Triage** (inbound: mentions, declined /
  unanswered crew offers, quotes about to expire with no next step, any new system item),
  **Overdue**, **Today**, **This week** (collapsed by default), **Later**, **Someday** (parked,
  no date, visually dimmed). Start-dated items stay hidden until their start date (Things
  rule). Snoozed items reappear at `snoozedUntil`. **Every day boundary** (Today, Overdue,
  start-date reveal, the `≤ 3d` / `≥ 7d` / "day before" rules in §9) is computed in the **org
  timezone** from org settings through the existing `quoteDates` helper — never the browser's
  zone and never UTC. A user linked to a crew record (`crewMembers.userId`) sees items assigned
  to that crew record in their Today, exactly as `myOpenTasks` does now.
- **Row anatomy:** status circle (click cycles, `D` marks done, un-done allowed), title,
  context line (project or client · stage · due), right-side meta (estimate chip, source badge
  `auto` / `mention` / `template`, assignee avatar). Overdue uses the error intent
  (`bg-out-soft text-t-out`), never brand red (§1 red disambiguation). Left-edge red bar on
  hover, no full-row tint.
- **Triage row actions** are contextual one-liners: *Re-offer*, *Reply*, *Make task*, *Set
  next step*, *Snooze*. Deciding is one keystroke; an item leaves Triage the moment it is
  assigned, dated, snoozed or done.
- **Peek** (`Space`, `Esc` closes, `↵` opens the full page at `/work/[id]`): title, context,
  properties (status, assignee, start · due, linked entities as chips, source, estimate ·
  logged), subtasks (inline add, one level), comments (existing thread panel, inline `@`
  typeahead — upgrade from the current dropdown picker), activity. Everything editable inline;
  no modal.
- **Keyboard:** `C` new · `Q` quick-add · `Space` peek · `D` done · `S` snooze (menu:
  tomorrow / next week / pick) · `A` assign · `P` priority · `T` move to Today · `↑↓ j k`
  navigate · `⌘K` anything. All single-key shortcuts obey DESIGN.md §4 (off inside inputs and
  dialogs; listed in the `?` overlay).
- **States:** empty Today (Kalam caption + mascot allowed: "Nothing on you today. The crew's
  jealous."); empty Triage (plain: "Nothing to triage"); loading skeletons match row shapes;
  error = left-bar notice with retry; viewer role sees read-only circles (as today).
- **Mobile:** single column, buckets stacked, agenda collapsed to a "Next up" strip; bottom
  sheet for peek. Today is *not* added to the 5-item bottom nav (DESIGN.md §16) — it is
  reachable from the dashboard "My work" zone and the sidebar.

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

## 9. System-generated work

Each source has a **dedupe key**, a **create condition**, a **resolve condition**, a default
**assignee rule** and a **stage**.

**How they are created and resolved.** Two mechanisms, never a third:
- **Write-time hooks** inside the mutations that already exist (status transitions, offer
  responses, comment writes, quote send/accept, invoice issue): immediate, no cron needed.
- **A scheduled sweep** for the *time-based* conditions only (expiring, unanswered, overdue,
  no-next-step, readiness re-evaluation): a Convex cron every **15 minutes** (the existing
  cadence), bounded **per source** (see "Per-source bounds" below) with a per-tick cap and a
  cursor so one tick never scans the whole org. The sweep runs as an **internal function**
  (crons carry no identity, so it cannot call the public auth-guarded queries) and calls the
  shared pure helpers those queries wrap. All Convex crons are **dormant until
  `ENABLE_CONVEX_CRONS === "true"`** on the deployment (`convex/scheduledJobs.ts`); flipping
  it on prod is a phase-1 exit criterion. Until then the hook-driven sources work and the
  time-based ones simply don't fire.

**Dedupe and lifecycle rules.** `by_organizationId_sourceKey` is a non-unique index, so the
rules below are enforced in the writer, not by the index:
- At most **one open** item per `sourceKey`. If the condition recurs after an auto-resolve, the
  **most recent row is reopened** (status back to `todo`, `autoResolvedAt` cleared, an activity
  row "reopened: condition recurred"), so a flapping check leaves one row with a history, not
  a pile.
- Resolved items flip to `done` with `autoResolvedAt`; they are **never hard-deleted**.
- A human may assign, snooze or add subtasks to a system item. A human may also **cancel** one
  ("won't fix"): it stays `cancelled` and the sweep will not reopen it until the condition has
  *cleared and recurred* — cancel is "mute this occurrence", not "delete". Delete is not
  offered on system items; the ⋯ menu says why.
- **Cascade:** when the source entity is deleted or archived (project, assignment, quote), its
  open system items are cancelled with reason `source_removed` inside the same mutation.
- **Readiness bound:** gear / crew / services / pricing come from the shared helpers behind
  `projectReadiness.forProject` (`computeProject*Readiness`, `readPricingReadiness` — bounded
  range scans per project), called from the internal sweep, never through the public query.
  **Conflicts are the exception:** `reservationConflicts.projectConflicts` loads the whole org
  graph (`loadOrgGraph()`, five org-wide collects — the registered R-8.3.3 "one-shot reads
  only" exception), so it must **not** be called per project. The sweep loads that graph
  **once per tick** and derives every active project's conflict check from the one load; if
  the perf baseline (`perf-convex-measurement-baseline.md`) shows even one load per 15 min is
  too heavy on the largest org, conflicts drop to hook-driven only (on line-item and date
  writes) — a phase-1 measurement, not an assumption.
- **Per-source bounds:** the sweep is bounded *per source* over that source's own indexed
  candidate set, not per project: `SENT` quotes by `validUntil`, `OFFERED` assignments by
  `offeredAt`, open work by `by_organizationId_status_dueDate` (covers project-less personal
  items), overdue invoices by due date, maintenance records by
  `by_organizationId_status_scheduledDate`, and active non-template projects (status not in
  COMPLETED / INVOICED / CANCELLED) for readiness and overbooking only. Each set has a
  per-tick cap and a cursor.
- **Cancelled rows still track the condition:** when a cancelled system item's condition
  clears, the sweep stamps `autoResolvedAt` and leaves `status: "cancelled"`; a later
  recurrence therefore reopens it. Without that stamp "cleared and recurred" is undetectable.

**Assignee rules** (the only three): `pm` = `projects.projectManagerId`, else the earliest
`projectManagers` row, else unassigned; `ops` = the org's ops lead (`workDefaults.opsLeadUserId`,
a new Settings → Project defaults field), else unassigned; `user` = a specific user id. An
unassigned item shows in the project Work card only.

| Source | Key | Creates when | Resolves when | Assignee | Stage | Phase |
|---|---|---|---|---|---|---|
| Readiness: gear / crew / services / pricing / conflicts | `readiness:<check>:<projectId>` | check is `blocking` or `warning` (existing `project-readiness-checks.ts`, unchanged) | check passes | pm | prep | 1 |
| Mention | `mention:<commentId>:<userId>` | a comment mentions the user | user replies, resolves, or dismisses | user (the mentioned user) | — | 1 |
| Crew declined | `crew:declined:<assignmentId>` | assignment → `DECLINED` | assignment cancelled or the service reaches `crewCountRequired` | pm | prep | 1 |
| Quote expiring | `quote:expiring:<quoteId>` | `SENT` and `validUntil − now ≤ 3d` | not `SENT` | pm | quote | 1 |
| Overbooking | `overbook:<projectId>:<modelId>` | `overbookingBoard` hard or pencilled overage | resolved | pm | prep | 2 |
| Overdue return | `return:overdue:<projectId>` | existing derived notification condition | checked in | ops | return | 2 |
| Sub-hire overdue | `subhire:overdue:<subHireId>` | existing condition | returned | ops | return | 2 |
| Maintenance due | `maint:due:<maintenanceRecordId>` | existing per-record condition (`scheduledDate` past, not completed) | record completed / cancelled | ops | — | 2 |
| Quote out, no next step | `quote:nonext:<quoteId>` | `SENT ≥ 24h` and no open `follow_up` linked to the client | a next step exists or quote leaves `SENT` | pm | quote | 3 |
| Invoice overdue | `invoice:overdue:<invoiceId>` | balance past due | paid / voided | pm | close | 3 |
| Crew unanswered | `crew:unanswered:<assignmentId>` | `OFFERED ≥ 48h` | responded | pm | prep | 4 |

Three of the nine derived `AppNotification` types in `src/server/notifications.ts`
(`overdue_return`, `overdue_maintenance`, `pending_offers`) map onto rows above; the other six
(invitations, join requests, timesheets, flagged assets, incidents, upcoming projects) stay
derived and org-wide. Division of labour from phase 0 on: the derived counts keep feeding the
dashboard **"Needs attention" chip tray** (unchanged); the **bell** switches to stored per-user
rows (§10.2); the *actionable* per-person copy of each condition becomes a work item. **One
rule for volume:** creating or reassigning a work item — human or system — emits exactly one
notification to its assignee, typed `assigned` (or `mentioned` for a `mention:*` item, so a
mention is one item and one notification, never two). A system item is never *also* mirrored
as a notification of its own type.

## 10. Data model and architecture

Everything below follows the Convex rules in CLAUDE.md: `ConvexError` only, `requireOrgReadFor`
with a resource on every new read, colocated `agentOps` with danger classes, browser-direct
`*Native` mutations mirror their Zod bounds server-side (`fieldGuards.ts`), every doc fetched by
a global index is org-checked (the `by_cuid` ratchet), `assertBulkSizeOk` on bulk ops, and the
registry / OpenAPI / MCP manifest regenerated and committed with the change.

### 10.1 `workItems` (extends and renames `projectTasks`)

```ts
workItems: defineTable({
  id: v.string(), organizationId: v.string(),
  kind: v.union(v.literal("task"), v.literal("follow_up"), v.literal("system")),
  title: v.string(), description: v.optional(v.string()),          // markdown-lite, no editor lib
  status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done"), v.literal("cancelled")),
  priority: v.optional(enums.ProjectTaskPriority),                 // unchanged LOW/NORMAL/HIGH
  projectId: v.optional(v.string()),                               // was required
  stage: v.optional(v.union(v.literal("quote"), v.literal("prep"), v.literal("load_in"), v.literal("show"), v.literal("return"), v.literal("close"))),
  parentId: v.optional(v.string()),                                // one level
  assigneeUserId: v.optional(v.string()), assigneeCrewId: v.optional(v.string()), // XOR (kept)
  startDate: v.optional(v.number()),                               // epoch ms at org-tz midnight
  dueDate: v.optional(v.number()), dueTime: v.optional(v.string()), // dueTime = "HH:mm" in the org tz
  scheduledStart: v.optional(v.number()), scheduledEnd: v.optional(v.number()),
  snoozedUntil: v.optional(v.number()),
  estimateMinutes: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),                           // FEATUREDOCS/26 shape, free-form
  sourceKey: v.optional(v.string()), sourceType: v.optional(v.string()), autoResolvedAt: v.optional(v.number()),
  sortOrder: v.optional(v.number()),
  isPrivate: v.optional(v.boolean()),                              // default rule is open question 1 (§14)
  createdById: v.optional(v.string()), completedAt: v.optional(v.number()),
  createdAt: v.optional(v.number()), updatedAt: v.optional(v.number()),
  // Added in the phase that ships them (widen then, not now):
  //   templateId (phase 1), recurrence + watcherUserIds (phase 2)
})
  .index("by_cuid", ["id"])
  .index("by_organizationId", ["organizationId"])
  .index("by_organizationId_projectId", ["organizationId", "projectId"])
  .index("by_organizationId_sourceKey", ["organizationId", "sourceKey"])
  .index("by_organizationId_kind_status", ["organizationId", "kind", "status"])   // the sweep's "open system items" read
  .index("by_organizationId_assigneeUserId_status", ["organizationId", "assigneeUserId", "status"])  // org-prefixed: users are multi-org, no global assignee index (R-8.4.3)
  .index("by_organizationId_assigneeCrewId_status", ["organizationId", "assigneeCrewId", "status"])
  .index("by_organizationId_status_dueDate", ["organizationId", "status", "dueDate"])
  .index("by_parentId", ["parentId"])
  .searchIndex("search_title", { searchField: "title", filterFields: ["organizationId"] }),

workItemLinks: defineTable({
  id: v.string(), organizationId: v.string(), workItemId: v.string(),
  entityType: v.string(),   // client | contact | quote | invoice | service | crewAssignment | asset | lineItem | location
  entityId: v.string(), createdAt: v.optional(v.number()),
})
  .index("by_cuid", ["id"])
  .index("by_workItemId", ["workItemId"])
  .index("by_organizationId_entity", ["organizationId", "entityType", "entityId"]),

workTemplates: defineTable({ id, organizationId, onStatus: enums.ProjectStatus, title, stage, offsetDays, offsetFrom: "trigger" | "start" | "end", assigneeRule: "pm" | "ops" | userId, priority?, sortOrder, isActive })
  // offsetFrom "trigger" = days after the status transition ("+1d"); "start"/"end" = relative to the project window ("event −5d")
  .index("by_cuid", ["id"]).index("by_organizationId_onStatus", ["organizationId", "onStatus"]),
```

- Links live in a join table because Convex cannot index inside an array and "all work for
  this client" must be an indexed read (R-8.3 read amplification, `perf-convex-efficiency`).
- **Stage default from lifecycle status** (one table, in a plain `src/lib` module shared by
  Zod, Convex and UI — R-3.1):

  | Project status | Default stage |
  |---|---|
  | ENQUIRY, QUOTING, QUOTED | `quote` |
  | CONFIRMED, PREPPING | `prep` |
  | CHECKED_OUT | `load_in` |
  | ON_SITE | `show` |
  | RETURNED | `return` |
  | COMPLETED, INVOICED | `close` |
  | CANCELLED | no default (existing stage kept) |

- **Migration** (widen → migrate → narrow, `convex-migration-helper`): add the new table, copy
  every `projectTasks` row **preserving its cuid `id`** (audit rows, deep links and
  `savedTableViews` keep working; `entityType: "ProjectTask"` audit rows are labelled alongside
  the new `WorkItem` label on `/activity`), with `kind: "task"` and `stage` from the table
  above. Each checklist entry `{ id, text, done }` becomes a child row: `id` preserved, `title =
  text`, `status = done ? "done" : "todo"`, `completedAt = parent.updatedAt` when done, no
  assignee or dates, `sortOrder` = array index. Point reads/writes at `workItems`, keep
  `projectTasks` read-only for one release, then drop. The Convex schema is hand-merged, never
  regenerated (CLAUDE.md). The registry regen must keep the agent-reachable count at or above
  the **reachability floor (573, `docs/api-coverage.md`)**: the new `workItems` ops replace the
  17 `projectTasks` ops one-for-one or better, or the floor is lowered in a visible diff.
- **Privacy (proposed, open question 1):** an item with no `projectId` and no links defaults to
  `isPrivate` (visible to its assignee and org admins only). Anything linked to a project or
  client is org-visible under normal RBAC.

### 10.2 `notifications` (stored, per user)

```ts
notifications: defineTable({
  id: v.string(), organizationId: v.string(), userId: v.string(),
  type: v.string(),          // assigned | mentioned | due_soon | overdue | comment_reply | work_resolved  (system conditions arrive as `assigned`, §9)
  entityType: v.string(), entityId: v.string(),
  title: v.string(), body: v.optional(v.string()), href: v.string(),
  dedupeKey: v.string(), readAt: v.optional(v.number()), archivedAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_cuid", ["id"])
  .index("by_organizationId_userId_readAt", ["organizationId", "userId", "readAt"])   // users are multi-org: every read is org-scoped
  .index("by_organizationId_userId_createdAt", ["organizationId", "userId", "createdAt"])
  .index("by_organizationId_dedupeKey", ["organizationId", "dedupeKey"]),
```

- The bell reads stored rows (unread count is a sharded counter per (org, user), like
  `dashboardCounters`). The nine derived org-wide types keep feeding the dashboard chip tray
  only (§9).
- `userNotificationPreferences` gains the new types. The email digest reuses the existing cron
  and the `notificationEmailLogs` dedupe ledger (not the generic `sentEmails` idempotency
  table). **PWA web push is phase 2** (nothing exists today; needs a VAPID key pair, a
  `pushSubscriptions` table and a service-worker handler).
- Retention: archived rows pruned after 90 days by the existing prune pass pattern.

### 10.3 Unified timeline (read model first, writers second)

Phase 0 ships `timeline.forEntity(entityType, entityId)` — a read model that unions
`activityEvents`, `activityLogs`, `comments`, work-item events and finance events for a client
or contact, sorted, capped and org-checked. It needs `activityEvents` to carry denormalised
`clientId` / `contactId` (an index, not a scan). Phase 3 consolidates writers: `activityEvents`
becomes the one human-facing feed; `activityLogs` stays the audit trail (R-8.9). The `/activity`
page gets its missing `WorkItem` label in phase 0.

### 10.4 Agenda engine

`src/lib/agenda.ts` (pure) normalises shifts, services, project windows, work blocks and
follow-ups into `AgendaItem { id, kind, start, end, allDay, title, href, status, actorIds }`;
`convex/agenda.ts` serves a person's or a project's items for a range. One `<AgendaGrid>`
(day / week / month, `date-fns`, no FullCalendar) is introduced by Today and then adopted by
the project timeline row view, the crew planner and the Schedule page one at a time. The four
existing calendars are retired as they are replaced, never rewritten in one go.

### 10.5 Permissions and API surface

- New RBAC resource **`work`** in `permissionsCore.RESOURCES` with an explicit per-role grant
  (the `warehouse` built-in role holds `project: ["read"]` only today, so "same as
  `project:update`" would lock the ops lead — a D1 daily user and the §9 assignee for returns —
  out of their own work):

  | Role (`rolePermissions` keys) | `work` |
  |---|---|
  | owner, admin, manager | read, create, update, delete |
  | member | read, create, update |
  | warehouse | read, create, update |
  | viewer | read |

  (`crew` is a *resource*, not a role; a crew-linked user is a member or warehouse account
  and reads their own items through `requireSelfScope`.)

  Personal-scope reads (my Today) use `requireSelfScope`; project- and org-scoped reads use
  `requireOrgReadFor(ctx, orgId, "work")`. OAuth scope narrowing picks the resource up from
  `RESOURCES` automatically. Editing another person's *private* item needs `work:delete`-tier
  roles (open question 6).
- `agentOps`: create/update/complete = `medium`, delete + bulk delete = `high` (confirm gate),
  `list_my_work` = `low`. No new privileged args.
- Webhook events `work.created`, `work.completed`, `work.auto_resolved`.
- FEATUREDOCS: 50 is rewritten as the work-layer doc; 17, 55, 63, 31, 69 updated in the same
  PRs as the code (R-5.2); ARCHITECTURE.md row updated.

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

## 13. Phasing (approach B)

Each phase ships behind its own PR set, updates its FEATUREDOCS, and is usable on its own.
Effort is dual-scale: human team / Claude Code.

| Phase | Ships | Exit criteria | Effort |
|---|---|---|---|
| **0 · Spine** | `workItems` + `workItemLinks` + migration (ids preserved); `notifications` table + bell reads it; mention → notification; `work` resource + grant table; registry/OpenAPI/MCP regenerated (reachability floor held); `/activity` labels; timeline read model v1; org-tz day-boundary helper | All 18 dedicated task tests (plus `review2Bulk`) green on the new table; a mention shows in the bell within one subscription tick; xtenant exhaustive sweep passes for every new op | 2 wks / 3 d |
| **1 · Today** | `/today` (buckets, Triage, peek with subtasks + comments, keyboard verbs, quick-add grammar v1, agenda column v1 = shifts + services + blocks); phase-1 sources from §9 (readiness ×5 via the shared helpers from an internal sweep, conflicts from one org-graph load per tick, mention, crew declined, quote expiring); `workTemplates` v1 (adds `templateId`) seeded on `CONFIRMED`; `/my-tasks` redirects | `ENABLE_CONVEX_CRONS` on in prod; PMs open Today daily (PostHog); zero mentions lost; templates seed idempotently; one sweep tick measured under every per-source cap **and** the single conflicts graph load measured against the perf baseline on the largest org | 3 wks / 4 d |
| **2 · Project** | Work tab (list/board/calendar, filters, `reorderNative` DnD), Overview Work card **replacing** the readiness panel (no coexistence), phase-2 sources (overbooking, overdue return, sub-hire overdue, maintenance due) + the `ops` assignee setting, timeline row view, recurrence + watchers (fields and `every mon` grammar added now), board revived at `/projects?view=board` with drag-to-advance | Readiness panel deleted with no lost check; board drop honours locks | 3 wks / 4 d |
| **3 · Client** | Client + contact timeline (writers consolidated), Log call/email/note, Next step + rotting, phase-3 sources (`quote:nonext`, invoice overdue), Pipeline view, Work-by-client | Every SENT quote has a dated next step within 24h (target 95%) | 3 wks / 4 d |
| **4 · Crew time** | Planner badges + offer age, `crew:unanswered` source + 24h nudge, bulk availability requests, `crewTimeEntries.workItemId` + planned vs actual (derived), call-time reminder emails | Median decline → re-offer < 4 business hours; planner shows a confirmation state on 100% of shifts | 3 wks / 4 d |
| **5 · Relationships** (own mini-design before build) | `contactLinks` (a contact across clients and venues), venue rooms, OT estimate at booking (needs 2.1's rate rules) | A contact can be opened from a venue and a client and show one timeline | 2 wks / 3 d |
| **Continuous** | Mira/MCP curated tools, ⌘K commands, search index, iCal "my work" feed, PostHog events, PWA push (after phase 1), docs | — | in-phase |

Phase 4 is the seam with ROADMAP 2.1 (crew & services overhaul): 2.1 owns services, rates and
the offer flow; this program owns the planner's confirmation/availability layer and the shared
agenda engine. If 2.1 starts first, phase 4 rebases onto it.

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

- **Migration of `projectTasks`** is the only irreversible step; it is widen → migrate →
  narrow with the old table kept read-only for one release.
- **POLICY.md gates that will bite:** DRY (one `stage` union in a plain `src/lib` module shared
  by Zod, Convex and UI — R-3.1); server authority on every rule (rotting, thresholds, seeding —
  R-9.3); Zod on every body (R-8.2.3); the `by_cuid` ratchet on every new read; danger classes
  on every new mutation; docs in the same PR (R-5.2).
- **Notification volume:** dedupe keys, the one-`assigned`-per-item rule (§9) and per-type
  preferences are mandatory from phase 0, or the inbox becomes the new "Needs attention" chip
  tray.
- **Crons are off by default** (`ENABLE_CONVEX_CRONS`, `convex/scheduledJobs.ts`); every
  time-based source depends on that flag being on in prod. Hook-driven sources do not.
- **Timezones:** every day boundary goes through the org-tz helper; a UTC or browser-tz
  bucket would put an Australian PM's "Today" a day out.
- **Reachability floor** (`docs/api-coverage.md`, 573): replacing the 17 `projectTasks` ops
  must not drop the agent-reachable count silently.
- **Four calendars → one engine** is incremental by design; never a big-bang rewrite.
- **No rich text**: descriptions are markdown-lite textareas with `@` typeahead; a real editor
  is a separate decision.
- **Crew overhaul (2.1) overlap:** phase 4 is explicitly the seam; both docs must cross-link.

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

- **Sweep read cost is a measurement, not a design fact.** The third review pass established
  that the conflicts check depends on a whole-org graph load. §9 now limits it to one load per
  tick with a fallback to hook-driven only, but whether even that is affordable on the largest
  org is unknown until phase 1 measures it against
  [`perf-convex-measurement-baseline.md`](./perf-convex-measurement-baseline.md). Treat it as
  a phase-1 gate, and do not let readiness sources slip into calling public queries from the
  cron.
