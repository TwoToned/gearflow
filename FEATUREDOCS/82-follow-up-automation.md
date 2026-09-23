# Follow-up automation — the follow-up engine

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-23 (review quarterly — POLICY.md R-5.5)_

Design: [`docs/designs/follow-up-automation.md`](../docs/designs/follow-up-automation.md)
(approved 2026-09-23, decisions D1–D7). Builds on the work layer —
[FEATUREDOCS/50](./50-project-tasks.md) (tasks), [79](./79-today.md) /
[81](./81-customizable-dashboard.md) (where work shows), [80](./80-client-relationship-layer.md)
(next step, `quote:nonext`, client timeline).

## What it does (phase 1: quotes)

Every quote that is **SENT** (and sent after the org's cut-over) gets exactly one open,
dated, owned follow-up task. Flow creates it, moves it, and closes it:

| Rung | Due | Title |
|---|---|---|
| 1 | send + 2 business days | Follow up on quote `260901 v1` |
| 2 | "no reply" + 5 business days | Second follow-up on quote … |
| 3 | "no reply" + 5 business days | Decide on quote …: won, lost, extend or park? |
| 0 (housekeeping) | today | Record the outcome of quote … (the job went ahead, or the event started, while the quote is still marked sent) |

Every due date is clamped to the loop's **deadline** — the earlier of *event start −
`decisionLeadDays` (14)* and *`validUntil` − 2 days*. When that deadline is under a
week away the item is **urgent** (priority HIGH, a `soon` badge, one business day between
rungs). An expired quote jumps straight to the decision rung, due today.

The follow-up closes itself: quote **accepted** / **declined** → DONE; **recalled** or the
**project cancelled** → CANCELLED. A re-send of a new version within 5 business days of the
loop's last activity continues the ladder on the new quote; a later one starts a fresh loop.

Invoices (phase 2) are **not** automated yet — they wait on the Xero payment sync (design
D1: payments are reconciled in Xero, so Flow can't yet tell a paid invoice from an unpaid one).

## How the pieces fit

| Piece | Where | Notes |
|---|---|---|
| The rule (pure) | `convex/lib/followUpRules.ts` — `planQuoteLoop(facts)` | No DB access. Given one project's quote, status, event date, settings and every automated row, returns which rows to close and what the one open row should be. 22 unit tests in `convex/followUpRules.test.ts`. |
| The reconciler | `convex/lib/followUpReconcile.ts` — `reconcileFollowUps(ctx, { orgId, projectId, now })` | Loads the facts, applies the plan. Idempotent. Owner chain: quote sender → `projects.projectManagerId` → earliest `projectManagers` → an org owner, each checked against live membership. Links each row to the client and the quote (`workItemLinks`). Integration tests in `convex/followUpReconcile.test.ts`. |
| Write-path hooks | `quotesWrites` send / recall / accept / decline, `projectWrites.updateStatusNative` | Called ONCE at the end of the mutation, after its writes landed (same discipline as `maybeAutoAdvanceProjectStatus`). |
| Human edits | `projectTasksWrites` update / delete / bulk update / bulk delete, `clientTimelineWrites.completeNextStepNative` | `automationForHumanChange` locks a field a human edited (`lockedFields`: `dueDate`/`title`/`assignee` — never written by the engine again). Ticking an automated row DONE on rung 1–2 records `no_reply` (the next rung opens); on the decision/housekeeping rung it records `decided` (the loop ends). Deleting an automated row is a **soft** close (`CANCELLED`, resolution `deleted`) — the tombstone stops that rung coming back. |
| Outcomes | `projectTasksWrites.recordFollowUpOutcomeNative` | `no_reply` (optionally with the next date) or `parked` (moves + locks the due date, sets `snoozedUntil`). Writes a `next_step_completed` row on the client timeline. **Won / lost are not here** — they go through `quotesWrites.markAcceptedNative` / `markDeclinedNative` (`invoice:publish`, danger `high`), which close the loop themselves. |
| Hourly tick | `convex/followUpTick.ts` (`tick` → one `reconcileOrg` per org), `convex/crons.ts` | For what changes with time alone (expiry, a deadline coming inside a week, an event starting). Gated on its **own** flag `ENABLE_FOLLOW_UP_CRON`, not `ENABLE_CONVEX_CRONS` (which would also switch on dormancy archiving and the email backlog). |
| Settings | `OrgSettings.followUps` (`src/lib/org-settings-types.ts`), resolved by `resolveOrgFollowUpConfig` (`convex/lib/orgSettings.ts`) | `quotesEnabled` (absent = on), `firstFollowUpBusinessDays` (2), `nextFollowUpBusinessDays` (5), `decisionLeadDays` (14), `cutoverAt` (default 2026-09-23 00:00 AEST — nothing sent earlier is ever chased). No settings UI yet (phase 3); edit the settings JSON. |
| Business days | `addBusinessDaysInTimezone` in `convex/lib/quoteDates.ts` + its `src/lib/quote-validity.ts` mirror | Weekends skipped in the org timezone; public holidays are not (v1). |
| UI | `FollowUpBadges` (`auto`, `soon`), `FollowUpPanel` in Today's peek (why line; **No reply yet**, **Park until…**, **Won or lost** → the job's Finance tab), badges on the project Work rail | The work list widget is now in `DEFAULT_DASHBOARD_LAYOUT` (FEATUREDOCS/81) so follow-ups have a home on the landing page. |

## Data

`projectTasks.automation` (optional; its presence is what makes a row automated):
`ruleKey` (`"quote"`), `subjectId` (current quote), `rung`, `loopStartAt` (groups a loop's
rungs), `urgent`, `why`, `lockedFields`, `resolution`, `resolvedBy` (`"system"` or a user id),
`nextDate`. Automated rows are `kind: "follow_up"`, `stage: "quote"`, and carry
`sourceKey: "quote:nonext:<quoteId>"` — the same key as the derived `quote:nonext` signal, so:

- a signal someone already **promoted** by hand is **adopted** by the engine (found via
  `workSignalStates.by_organizationId_sourceKey` → `promotedWorkItemId`), never duplicated;
- promoting a signal when the engine already has a row returns that row;
- the `quote:nonext` needs-you signal goes quiet on its own, because the auto row is an open
  `follow_up` linked to the client.

## Guardrails

- Quote status is read through `effectiveQuoteStatus()`, never the stored column.
- Nothing is chased on a `CANCELLED` project, or for a quote sent before `cutoverAt` (the
  42-job invoicing backlog in production must never become tasks).
- Every read is bounded (`.take` / `collectCapped`); `by_cuid` reads are org-checked.
- Don't add a second writer of follow-up rows. A new rule (invoices, phase 2) goes into
  `followUpRules.ts` + `reconcileFollowUps`, not into a call site.

## Not built yet

- Morning brief email and urgent push (design §8.6) — phase 1b / phase 3.
- Invoice chase + invoice-not-raised rules and the Xero payment sync (phase 2).
- `/settings/automation` UI (phase 3).
- Existing saved dashboard boards are not rewritten to add the work list — "Add widget" or
  "Reset to default" brings it in.
