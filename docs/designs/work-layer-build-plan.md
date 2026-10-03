# Work layer — build plan

> _Owner: Jayden Nawotka · Created: 2026-09-16 · Status: **READY TO BUILD** · Review quarterly (POLICY.md R-5.5)_

**Companion to** [`work-layer.md`](./work-layer.md), which is the design: problem, research,
decisions, data model, product design and the three review records. **This doc is the execution
order**: what to do, in what sequence, with what acceptance. Where the two disagree, the design
doc wins and this one is stale.

**Tracking:** [#1240](https://github.com/TwoToned/gearflow/issues/1240) · phases #1241 (0), #1242 (0.5), #1243 (1), #1244 (2), #1245 (3), #1246 (4), #1247 (5).

---

## The sequence, and why it is this order

```
0  Mentions inbox ──────────────────┐   the one thing that cannot be composed
                                    │   from what already exists
0.5  Composed Today ────────────────┤   built from existing readers + writers
        │                           │   no schema change at all
        └── field research (§17) ───┤   a week of logging, against a real page
                                    │
1  The spine ───────────────────────┤   schema, informed by the log
        │                           │
        ├── 2 Project ──────────────┤
        ├── 3 Client ───────────────┤   2, 3 and 4 parallelise after 1
        └── 4 Crew time ────────────┤
                                    │
5  Relationships ───────────────────┘   own mini-design first
```

Three rules govern the order and none of them is negotiable.

1. **No irreversible step before the evidence.** The field research in §17 of the design doc has
   not happened. Phase 1 commits the schema, so it waits until there is a real page to log
   against.
2. **Reader filters deploy before the backfill runs.** Every task read collects with no parent
   concept (`convex/projectTasks.ts:34`, `:80`, `:178`). Convex deploys functions separately from
   data, so a backfill that lands first surfaces every checklist item as a top-level task in three
   UIs.
3. **The permission resource lands additively.** `apiKeys.scopes` is a frozen stored string.
   Repointing task operations from `project:*` to `work:*` would break every issued key, every
   OAuth grant frozen at consent, and every cached Mira key.

---

## Phase 0 — Mentions inbox ([#1241](https://github.com/TwoToned/gearflow/issues/1241))

**Effort:** human ~3 days / CC ~4 hrs. **Depends on:** nothing. **Blocks:** 0.5.

Convex cannot index inside the `mentionUserIds` array, so nothing today can answer "who was
mentioned". This is the only piece of the whole program that cannot be composed from existing
surfaces, which is why it goes first and alone.

- [ ] `notifications` table per `work-layer.md` §10.2, with the three org-prefixed indexes. Users
      are multi-org, so no index may start at `userId`.
- [ ] Classify the new table in `scripts/org-export-tables.ts` and bump `EXPECTED_TABLE_COUNT`
      119 → 120, or `convex/orgExport.test.ts` fails.
- [ ] `convex/notifications.ts` + `notificationsWrites.ts`: list unread, mark read, mark all read,
      archive. Every public read that touches `by_cuid` needs a `require*Org*` call or an inline
      `organizationId` comparison in the same function body — the ratchet baseline is 0.
- [ ] Mention hook inside `convex/collaborationWrites.ts`: one row, in the same transaction as the
      comment. Not best-effort. Comment and notification commit together or neither does.
- [ ] Dedupe on `(organizationId, dedupeKey)`. One notification per event, never two.
- [ ] Bell (`src/components/layout/notifications.tsx`, `use-notifications-feed.ts`) reads stored
      rows. Unread count is a plain indexed query, **not** a sharded counter.
- [ ] `userNotificationPreferences` gains the new types; the existing 15-minute cron and
      `notificationEmailLogs` ledger handle the digest unchanged.
- [ ] `/activity` `entityTypeLabels` gains `ProjectTask: "Task"` so existing audit rows stop
      rendering as a raw string and become filterable.
- [ ] Regenerate and commit the registry, OpenAPI and MCP manifest together.

**Acceptance:** a mention reaches the bell within one subscription tick. A second identical event
creates no second row. A user in two orgs sees only the current org's notifications. Zero change
to any existing task behaviour.

---

## Phase 0.5 — Composed Today ([#1242](https://github.com/TwoToned/gearflow/issues/1242))

**Effort:** human ~1 week / CC ~1 day. **Depends on:** 0. **Blocks:** 1.

No schema change. Assembled from readers that exist, plus every write that already exists. See
`work-layer.md` §8.1 for the full specification and the approved wireframe.

- [ ] `/today` page shell: work list as the wide anchor column, day rail on the right.
- [ ] Buckets as sections with a labelled rule, order Overdue, Today, Triage, Later. Overdue
      renders only when non-empty. Later is one collapsed row with a count.
- [ ] Header: greeting and date. No counts. Personality drops when an Overdue section exists.
- [ ] Rows: status circle with a 44px invisible hit area, title, context line, source badge and
      assignee. Overdue uses the error intent, never brand red. Intent classes come from
      `status-colors.ts` only.
- [ ] Writes that already exist: done and un-done, reply to a mention, re-offer crew, mark
      notification read. Un-done matters — the current `/my-tasks` cycle is one-way.
- [ ] Day rail and Needs-you rail: one-shot reads, refresh on tab focus and a slow interval, each
      with a muted "as of" stamp and a refresh control. Never blank while refreshing.
- [ ] Work list is the only live subscription on the page.
- [ ] Peek: non-modal page-level panel. Focus moves to the panel heading on open, returns to the
      originating row on Esc, list stays arrow-navigable.
- [ ] Keyboard: Space, D, j/k, Esc, Cmd-K. Listed in the `?` overlay, off inside inputs.
- [ ] Navigation: Today replaces Dashboard in `mobile-nav.tsx` and becomes the landing page.
      Dashboard moves to the account menu and its "My work" zone is removed. Apply the same IA
      change to `app-sidebar.tsx`, and update DESIGN.md §16 and its decisions log in the same PR.
- [ ] `/my-tasks` redirects to `/today`.
- [ ] Full state coverage per the §8.1 table, including first-run, stale, partial and
      optimistic-write-failure.

**Acceptance:** a warehouse login can open Today and complete work. Both named user groups open it
daily for two weeks. No page-level query exceeds its read budget on the largest org.

**Runs alongside, and gates phase 1:** the field research in `work-layer.md` §17. One week logging
every piece of work arriving from outside Flow with its source, and one morning watching the ops
lead plan their day without helping. The log decides the quick-add grammar and the stage
vocabulary. Without it, phase 1 is guessing.

---

## Phase 1 — The spine ([#1243](https://github.com/TwoToned/gearflow/issues/1243))

**Effort:** human ~2 weeks / CC ~3 days. **Depends on:** 0.5 and the field research.

- [ ] Shared vocabulary module: status, priority, kind, stage, the status-to-stage map and the
      labels, in one import-free module imported by the Convex validators, the Zod schemas and the
      UI. Replaces the two hand-synced copies at `convex/lib/validators.ts:453` and
      `src/lib/project-tasks.ts:6` rather than adding a third.
- [ ] `work` RBAC resource in `permissionsCore.ts` across all six roles, **additively**: task
      operations accept `work:X` or `project:X` during transition. Widen
      `src/lib/api-key-presets.ts`. Update `PERMISSION_REGISTRY`, the OAuth scope labels, the
      settings permission matrix, and the assertion in `src/lib/permissions.test.ts` that the
      resource list is exactly 19.
- [ ] Widen `projectTasks` in place per §10.1: kind, stage, parentId, startDate, dueTime,
      scheduledStart/End, snoozedUntil, estimateMinutes, tags, sourceKey, isPrivate, and projectId
      becomes optional. Add the org-prefixed assignee indexes, the status-plus-due index, the
      parent index and the title search index. Hand-merge the stanza; never regenerate the schema.
- [ ] `workSignalStates` table per §10.3.
- [ ] **Reader filters first:** every existing task read excludes `parentId` rows, in all 17
      operations plus `tasks-panel.tsx`, `/my-tasks`, the dashboard block and the delete cascade.
      Deploy this before the backfill.
- [ ] Checklist backfill per §10.4: public mutation gated by `requireService`, paginated with a
      cursor, `apply` defaulting to a dry run, driver script, colocated test. Ids preserved.
- [ ] Cascade: `convex/projectWrites.ts:961` delete and `:1056` clone must sweep children.
- [ ] Today gains quick-add, snooze, promote-a-signal, subtasks in the peek, stage grouping, and
      `workTemplates` seeded on CONFIRMED.
- [ ] "Plan my day" arrives here, because only now is there anything to plan with.

**Acceptance:** the backfill is proven id-preserving, idempotent and a no-op in dry run **against a
copy of production data**, not seeded fixtures. Every issued API key still works. The vocabulary
matches the field log rather than a guess.

---

## Phases 2 to 5

Detail lives in `work-layer.md` §13. Summary only, because each deserves its own pass when it
starts.

| Phase | Ships | Depends on |
|---|---|---|
| **2 · Project** (#1244) | Work tab with list, board and calendar views; Overview Work card replacing the readiness panel; timeline row; recurrence and watchers; the revived project board with drag-to-advance; web push | 1 |
| **3 · Client** (#1245) | `workItemLinks` and the unified timeline read model, both deferred here from the original phase 0; client and contact timeline; log call, email and note; next step and rotting; pipeline view | 1 |
| **4 · Crew time** (#1246) | Planner confirmation badges and offer age; unanswered nudge; bulk availability requests; `crewTimeEntries.workItemId` and planned versus actual | 1, and the seam with ROADMAP 2.1 |
| **5 · Relationships** (#1247) | Contacts across clients and venues; venue rooms; overtime estimate at booking | 4, own mini-design first |

---

## Standing guardrails

Every phase, not just the risky ones.

- **R-3.1** — one vocabulary module, one day-boundary helper, one definition of each signal. A
  second hand-maintained copy is a defect even while it agrees.
- **R-8.4.3** — `by_cuid` is a global index. Every doc fetched by it is org-checked in the same
  function. The ratchet baseline is 0, so the first offender fails CI.
- **R-9.3** — the server owns every rule. Thresholds, seeding and bucketing are computed
  server-side in the org timezone through `convex/lib/quoteDates.ts`, never the browser's zone and
  never UTC.
- **Module names equal table names** or `xtenantExhaustive` sweep B silently stops covering the
  operation instead of failing.
- **Reachability floor** (573, `docs/api-coverage.md`) ratchets up and never down. A new read on
  the bare `requireOrgRead`, or a write left on `requireService`, classifies as agent-unreachable
  and surfaces as a failure later.
- **Danger classification** on every agent-reachable mutation, or the registry build fails.
- **R-5.2** — FEATUREDOCS 50, 17, 55 and DESIGN.md §16 update in the same PR as the behaviour.
- **Tests** — the coverage map in `work-layer.md` §20 lists 27 gaps. The three migration paths and
  the two regressions are non-negotiable.

## Open question to settle before phase 1

Count the members per role in production. The `work` resource exists because the warehouse role
holds `project: ["read"]` only, so an ops lead cannot complete their own work. If nobody actually
holds that role, the gap is theoretical and phase 1 saves the effort.
