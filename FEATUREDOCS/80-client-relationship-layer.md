# Client Relationship Layer — Timeline, Next Step, Pipeline

Work-layer program, Phase 3 (issue [#1245](https://github.com/TwoToned/gearflow/issues/1245),
design [`docs/designs/work-layer.md`](../docs/designs/work-layer.md) §8.4/§9/§13). Depends on
Phase 1's spine (#1243 — the `work` RBAC resource and the widened `projectTasks` table,
FEATUREDOCS/50).

## What this ships

- **`workItemLinks`** (`convex/schema.ts`) — a join table linking a work item (`projectTasks`
  row) to a client, contact, quote, invoice, service, crew assignment, asset, line item or
  location. A join table rather than an array field: Convex cannot index inside an array, and
  "all work linked to this client" has to be an indexed read
  (`by_organizationId_entityType_entityId`), not a client-side scan. Carries its own
  `organizationId` (denormalised at link time, not a pure FK-only join) so every read is
  org-checked without a second lookup — same posture as `workSignalStates`.
  - Writes: `convex/workItemLinksWrites.ts` — `linkNative` (idempotent: re-linking the same
    `(workItemId, entityType, entityId)` triple returns the existing row, never a duplicate) and
    `unlinkNative`. Gated on `work:update` — a link is metadata on the work item, not a separate
    permission story.
  - Reads: `convex/workItemLinks.ts` — `forEntity(orgId, entityType, entityId)`.

- **Unified client timeline** (`convex/clientTimeline.ts`) — `forClient(orgId, clientId, now)`
  unions, per client:
  - **Finance events**, read directly off `quotes`/`invoices`/`payments` (the domain rows ARE
    the source of truth for "when was this sent" — not parsed out of an audit-log summary
    string): quote sent/accepted/declined/recalled/**expired** (derived via
    `effectiveQuoteStatus`, `convex/lib/quoteState.ts` — **never** the raw `status` column, see
    the guardrail below), invoice issued/voided (read via the direct `invoices.by_clientId`
    index), payment recorded.
  - **Lifecycle events** — job confirmed/completed, read off `activityLogs`' `STATUS_CHANGE`
    rows (`convex/projectWrites.ts`'s existing writer; nothing new writes these), fanned out
    over the client's own (capped) project list via `activityLogs.by_organizationId_projectId`.
  - **Comments/mentions AND human-logged touches** — both live in `activityEvents`, split by
    `action` into the right filter-chip category. See "Denormalised clientId" below for how this
    becomes an indexed read instead of an org-wide scan.
  - **Work done** — completed work items (excluding `follow_up`, which the next-step-outcome row
    already covers) linked to the client via `workItemLinks`.

  All reads are either a direct index (`invoices.by_clientId`,
  `activityEvents.by_orgId_clientId_createdAt`) or a bounded fan-out over the client's own
  project list (`convex/lib/clientScope.ts`'s `listClientProjects`, capped at
  `CLIENT_PROJECTS_LIMIT` = 60, newest-first) — never an org-wide scan. Results are capped
  server-side (`TIMELINE_LIMIT` = 200) with a `capped`/`total` flag, same "cap + count" posture
  as every other bounded list in the app (design §10.7).

  `clientTimeline.nextStep(orgId, clientId, now)` returns the single open `follow_up` linked to
  the client with the soonest `dueDate`, plus `requiresNextStep` — whether ANY of the client's
  quotes currently reads `SENT`.

- **Denormalised `clientId`/`contactId` on `activityEvents`** — Phase 3's one schema change to
  an existing table, plus two new indexes (`by_orgId_clientId_createdAt`,
  `by_orgId_contactId_createdAt`). Stamped by `collaboration.ts`'s `recordActivity` (the single
  writer, called from every comment/marker/blocking mutation), which resolves the client via a
  new `resolveActivityClientContext` helper: `entityType: "client"` → `clientId = entityId`
  directly; anything else with a resolvable `projectId` (a thread's own `entityId` when
  `entityType === "project"`, or its denormalised `projectId` field for line-item/group/category
  threads) → looks up the project's `clientId`/`clientContactId`. An entity with no resolvable
  client (an asset/supplier thread) simply stores neither field — never a write failure, just one
  row that won't surface on a client timeline. `clientTimelineWrites.ts`'s human-logged rows
  (below) reuse this same `activityEvents` substrate rather than a new table (R-3.1 — "things
  that happened to a client" has one home).

- **Log call / log email / add note** (`convex/clientTimelineWrites.ts` —
  `logCallNative`/`logEmailNative`/`addNoteNative`) — each inserts one `activityEvents` row,
  `entityType: "client"`, `clientId` stamped directly, `action` one of
  `call_logged`/`email_logged`/`note_added`. **Flow still does not email clients from this
  feature** (design D3) — this is a record of something that happened OUTSIDE Flow, never a
  channel. Gated on `work:create`.

- **Next step** (pinned above the client page's tabs, `<NextStepBanner>`) — a `follow_up`-kind
  `projectTasks` row (Phase 1's `kind` field, `convex/lib/workVocabulary.ts`), created via
  `clientTimelineWrites.setNextStepNative` and linked to the client via `workItemLinks` in the
  SAME transaction, so a next step can never exist as an orphaned task or a link with nothing
  behind it. Completing one (`completeNextStepNative`) requires a one-line outcome — marks the
  task `DONE` and records the outcome as an `activityEvents` row (`next_step_completed`) against
  the LINKED client, atomically.

  Multiple open `follow_up` items can exist for one client; the banner and Triage only ever
  surface the soonest.

- **Rotting (`quote:nonext` Triage signal)** — `convex/dashboardLists.ts`'s `needsYou` (the
  concrete `workTriage.forMe` implementation, FEATUREDOCS/79) gains a fourth bucket,
  `quotesNeedingNextStep`: for each PM-managed project whose live quote is `SENT`
  (`effectiveQuoteStatus`) and `sentAt` is 24h+ old
  (`QUOTE_NO_NEXT_STEP_GRACE_MS = 24h`), checks whether the project's client has an OPEN
  `follow_up` linked via `workItemLinks` (`makeHasOpenFollowUpChecker`, memoised per client for
  the call). No cron — this is computed live on every `needsYou` call, per the design doc's R3/R6
  decision that system-generated work is derived on read, never swept (§9). Same
  `workSignalStates` snooze/dismiss subtraction as every other Triage signal, `sourceKey`
  `quote:nonext:<quoteId>`.

  **Follow-up automation (FEATUREDOCS/82):** the engine now creates that `follow_up` itself
  on send — linked to the client, keyed `quote:nonext:<quoteId>` — so for any quote sent
  after the org's cut-over this signal goes quiet on its own; it remains the backstop for
  older quotes and orgs that opt out.

- **Pipeline view** (`convex/pipeline.ts`'s `forOrg`, page at `/clients/pipeline`) — the project
  board filtered to `ENQUIRY`/`QUOTING`/`QUOTED`/`CONFIRMED`, sorted by next-step date (falling
  back to the live quote's `sentAt` when no next step is logged yet, so a dateless deal doesn't
  silently sort last), reachable via the sidebar's Clients section. Rotting shading (`none` /
  `amber` / `error`) is computed server-side from days-since-last-touch against org-configurable
  thresholds (`convex/lib/rottingDates.ts`, defaults 7/14 days — see "Org settings" below).
  **No new object — the project is the deal.**

  **Phase 2 had not merged when this shipped** (checked `git log origin/main` at build time —
  see the PR body). This is a standalone read-only query + page rather than a mode of the
  revived `project-board.tsx`. Re-point it there once Phase 2's board lands, if that board grows
  a "pipeline" filter preset — the data shape here (rotting level + next-step date per project)
  is exactly what a board card needs either way.

- **Client page restructure** — six tabs (was three): **Timeline** (new default) · Projects ·
  **Contacts** (moved off the sidebar — see FEATUREDOCS/63) · **Work** (new — every work item
  linked to the client via `workItemLinks`, read-only in this phase) · Notes · Files. The old
  sidebar "Activity" section (`<ActivityTimeline entityType="client">`, which only ever read
  client-entityType `activityLogs` rows) is removed — the Timeline tab supersedes it. The 4th
  hero stat is now **"Since last touch"** (days since the most recent timeline row) rather than
  "Last job" — a client with no new project but an active back-and-forth shouldn't read as
  stale. The Timeline tab and the hero stat share ONE `clientTimeline.forClient` subscription
  (fetched once at the page level, passed down as a prop), not two independently-timed queries.
  Invoices appear inside the Timeline tab under the **Money** filter chip, not as a seventh tab
  (chips: All · Logged · Money · Work · Comments).

## Org settings (`OrgWorkSettings`, `src/lib/org-settings-types.ts`)

`rottingAmberDays` / `rottingErrorDays` (default 7 / 14) live in the existing `orgSettings.settings`
JSON blob, resolved server-side via `convex/lib/orgSettings.ts`'s `resolveOrgWorkConfig` (clamps
a bad/missing value to the default, and widens the error threshold by 1 day if it would ever be
≤ the amber one, so a hand-edited settings blob can't silently swallow the amber tier). **No
settings UI ships in this phase** — same posture as Phase 1's `workTemplates` (the field exists
for a later admin screen to write); edit via the raw settings JSON until then.

## Guardrails this phase leans on

- **Quote status is ALWAYS read through `effectiveQuoteStatus()`** (`convex/lib/quoteState.ts`)
  — every "is this quote SENT/live" check in `clientTimeline.ts`, `dashboardLists.ts`'s
  `quote:nonext` signal, and `pipeline.ts` goes through it. A raw `status === "SENT"` check would
  silently treat an expired quote as live.
- **R-8.4.3** — `clients.by_cuid`, `projects.by_clientId` and `invoices.by_clientId` are global
  indexes; every reader here (`convex/lib/clientScope.ts`'s `requireClientInOrg`/
  `listClientProjects`, and the direct `invoices.by_clientId` reads in `clientTimeline.ts`)
  re-checks `organizationId` in the same function body.
- **Day boundaries in the org's timezone, never the browser's** — rotting's days-since-touch
  (`convex/lib/rottingDates.ts`'s `daysSinceInTimezone`) and the 24h quote-send grace period are
  both resolved server-side.
- **A `now` argument is a SUBSCRIPTION KEY, never a fresh `Date.now()`.** Both server reads that
  take one (`pipeline.forOrg`, `clientTimeline.nextStep`) are called with `useStableNow()`
  (`src/hooks/use-stable-now.ts`) — a mount-time snapshot. convex-helpers' `createQueryKey`
  stringifies the args into the cache key, so re-evaluating `Date.now()` each render restarts the
  subscription every render and the result never settles out of `undefined`: the pipeline page sat
  on "Loading…" forever and the next-step banner (which returns `null` while loading) never
  appeared at all. A `no-restricted-syntax` rule in `eslint.config.mjs` now fails the build on a
  `Date.now()` inside a `use*Query*` call, so this cannot come back.
- Contacts stay **one-per-client** in this phase — the many-to-many contact/venue model is Phase
  5 (see work-layer.md §8.4).

## Files

- Schema: `convex/schema.ts` (`workItemLinks` table; `activityEvents.clientId`/`contactId` +
  2 indexes).
- Vocabulary: `convex/lib/workVocabulary.ts` (`WORK_ITEM_LINK_ENTITY_TYPES`),
  `convex/lib/validators.ts` (`WorkItemLinkEntityType`).
- Backend: `convex/workItemLinks.ts`, `convex/workItemLinksWrites.ts`, `convex/clientTimeline.ts`,
  `convex/clientTimelineWrites.ts`, `convex/pipeline.ts`, `convex/lib/clientScope.ts`,
  `convex/lib/rottingDates.ts`. Extended: `convex/collaboration.ts` (`recordActivity`'s client
  context resolution), `convex/dashboardLists.ts` (`needsYou`'s `quotesNeedingNextStep` bucket),
  `convex/lib/orgSettings.ts` (`resolveOrgWorkConfig`).
- Frontend: `src/components/clients/client-timeline-tab.tsx`, `next-step-banner.tsx`,
  `client-log-actions.tsx`, `client-work-tab.tsx`; `src/hooks/use-client-timeline-writes.ts`;
  `src/lib/client-timeline.ts` (filter-chip vocabulary); `src/app/(app)/clients/[id]/page.tsx`
  (restructured tabs/hero); `src/app/(app)/clients/pipeline/page.tsx` (new); sidebar entry in
  `src/components/layout/app-sidebar.tsx`; `src/hooks/use-stable-now.ts` (the `now`-argument
  snapshot both `now`-taking reads use).
- Tests: `convex/workItemLinksWrites.test.ts`, `convex/clientTimeline.test.ts`,
  `convex/clientTimelineWrites.test.ts`, `convex/pipeline.test.ts`; extended
  `convex/dashboardLists.test.ts` (`quote:nonext`) and `convex/collaborationWrites.test.ts`
  (clientId/contactId stamping). Frontend: `src/hooks/use-stable-now.test.tsx`,
  `src/app/(app)/clients/pipeline/__tests__/pipeline-page.smoke.test.tsx` (the stable-`now`
  regression — it fails on the original inline `Date.now()`).

## Deferred (out of scope for this phase)

- A settings UI for the two rotting thresholds (defaults only — see above).
- Re-pointing the pipeline view at Phase 2's revived project board.
- Editing a linked work item from the client page's Work tab (currently read-only there; edit
  from Today or the project's own Work tab).
- Contacts-across-clients and venue rooms (Phase 5, its own mini-design per work-layer.md §8.4).
