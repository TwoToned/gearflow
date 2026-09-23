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

## Invoices (phase 2)

Payments are reconciled in Xero (design D1), so the invoice rules rest on the **Xero payment
sync** (below), which keeps `invoices.paymentStatus` true. Two loops, both in
`convex/lib/followUpInvoiceRules.ts` (pure, `convex/followUpInvoiceRules.test.ts`):

| Loop | Starts | Rungs | Closes |
|---|---|---|---|
| **Invoice chase** (`ruleKey: "invoice"`, `sourceKey: invoice:chase:<invoiceId>`) | An ISSUED, non-credit invoice issued after the cut-over, one business day past its due date | 1 Chase payment (due + 1 business day) · 2 Second chase (due + 7 d) · 3 **Call the client** (+ 14 d) · 4 **Decide**: payment plan, write-off or keep chasing (+ 30 d). Each opens on a no-reply; one logged after its scheduled day makes the next rung due the next business day | PAID (Flow or Xero) → DONE `paid`; voided (Flow, or Xero VOIDED/DELETED) or fully credited → CANCELLED `voided` |
| **Invoice not raised** (`ruleKey: "invoice_unraised"`, `sourceKey: invoice:unraised:<projectId>`) | A job with a non-zero total that went RETURNED/COMPLETED after the cut-over with no issued invoice | One item, "Raise the invoice for 260901", due 2 business days after the job ended — once per job, ever | An invoice issued → DONE `invoiced` |

A **DEPOSIT** whose event is under a week away is urgent — the gear is held against money that
hasn't landed. Owed amounts subtract Flow and Xero credits. Invoice rows are `stage: "close"`.
Hooks: `invoicesWrites` issue / void / create credit / delete draft, `paymentsWrites` record /
void (`settleInvoicePaymentState` = recompute → `PAYMENT_SETTLED` auto-status → reconcile), and
the hourly tick (issued unpaid invoices + jobs that ended since the cut-over).

### Xero payment sync

Read-only, invoice-level: for every Flow invoice pushed to Xero and not yet settled, read
`Status` / `AmountPaid` / `AmountCredited` / `AmountDue` (`fetchXeroInvoiceStates`, batches of
40, `summaryOnly=true`) — never just Payments, since voids, credit-note allocations and
overpayments made in Xero never appear as one. Stored on the invoice as `xeroStatus`,
`xeroAmountPaid`, `xeroAmountCredited`, `xeroAmountDue`, `xeroCheckedAt`;
`recomputeInvoicePaymentState` reads **max(Flow paid, Xero paid)** so a payment recorded in both
counts once. Runs from the notification cron (`src/server/xero-payment-sync.ts`, at most hourly
per org via `xeroIntegrations.paymentsSyncedAt`) and on demand from **Settings → Xero →
Payments → Check now**. Token refresh is serialised by a lease on `xeroIntegrations`
(`tokenLeaseHolder`/`tokenLeaseUntil`, `src/lib/xero-token.ts`) so the sync and an invoice push
can't both spend the same rotating refresh token.

## How the pieces fit

| Piece | Where | Notes |
|---|---|---|
| The rule (pure) | `convex/lib/followUpRules.ts` — `planQuoteLoop(facts)` | No DB access. Given one project's quote, status, event date, settings and every automated row, returns which rows to close and what the one open row should be. 22 unit tests in `convex/followUpRules.test.ts`. |
| The reconciler | `convex/lib/followUpReconcile.ts` — `reconcileFollowUps(ctx, { orgId, projectId, now })` | Loads the facts, applies the plan. Idempotent. Owner chain: quote sender → `projects.projectManagerId` → earliest `projectManagers` → an org owner, each checked against live membership. Links each row to the client and the quote (`workItemLinks`). Integration tests in `convex/followUpReconcile.test.ts`. |
| Write-path hooks | `quotesWrites` send / recall / accept / decline, `projectWrites.updateStatusNative` | Called ONCE at the end of the mutation, after its writes landed (same discipline as `maybeAutoAdvanceProjectStatus`). |
| Human edits | `projectTasksWrites` update / delete / bulk update / bulk delete, `clientTimelineWrites.completeNextStepNative` | `automationForHumanChange` locks a field a human edited (`lockedFields`: `dueDate`/`title`/`assignee` — never written by the engine again). Ticking an automated row DONE on rung 1–2 records `no_reply` (the next rung opens); on the decision/housekeeping rung it records `decided` (the loop ends). Deleting an automated row is a **soft** close (`CANCELLED`, resolution `deleted`) — the tombstone stops that rung coming back. |
| Outcomes | `projectTasksWrites.recordFollowUpOutcomeNative` | `no_reply` (optionally with the next date) or `parked` (moves + locks the due date, sets `snoozedUntil`). Writes a `next_step_completed` row on the client timeline. **Won / lost are not here** — they go through `quotesWrites.markAcceptedNative` / `markDeclinedNative` (`invoice:publish`, danger `high`), which close the loop themselves. |
| Hourly tick | `convex/followUpTick.ts` (`tick` → one `reconcileOrg` per org), `convex/crons.ts` | For what changes with time alone (expiry, a deadline coming inside a week, an event starting). Gated on its **own** flag `ENABLE_FOLLOW_UP_CRON`, not `ENABLE_CONVEX_CRONS` (which would also switch on dormancy archiving and the email backlog). |
| Settings | `OrgSettings.followUps` (`src/lib/org-settings-types.ts`), resolved by `resolveOrgFollowUpConfig` (`convex/lib/orgSettings.ts`), validated on save by `followUpSettingsSchema` | `quotesEnabled` / `invoicesEnabled` (absent = on), `firstFollowUpBusinessDays` (2), `nextFollowUpBusinessDays` (5), `decisionLeadDays` (14), `cutoverAt` (default 2026-09-23 00:00 AEST — nothing sent earlier is ever chased; not editable in the UI). Edited in **Settings → Follow-ups** (`FollowUpSettingsPanel`); bounds are `FOLLOW_UP_BOUNDS`, shared by the form, the schema and the resolver. |
| Morning brief | `src/server/follow-up-brief.ts`, pure half `src/lib/follow-up-brief.ts`, query `followUpTick.briefForOrg` | One email per person per business day from 07:00 org time, only when something is due for them; skipped for orgs with no timezone. Per-user opt-out `followUpBrief` on `/account/notifications`. Dedupe `follow-up-brief:<org>:<user>:<date>` on `notificationEmailLogs`. |
| Urgent push | `src/server/follow-up-push.ts`, `convex/followUpPush.ts`, sender `src/lib/web-push.ts` | Only **urgent** follow-ups buzz a phone. `claimPush` rations in one transaction: one push per follow-up rung, at most 2 per person per local day; never 19:00–07:00 org time. Sent to every device in `pushSubscriptions`; a 404/410 deletes that subscription. Inert unless `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` are set. The sender is `node:crypto` (RFC 8291 `aes128gcm` + RFC 8292 VAPID), pinned by a test to RFC 8291 Appendix A — no `web-push` dependency. |
| Business days | `addBusinessDaysInTimezone` in `convex/lib/quoteDates.ts` + its `src/lib/quote-validity.ts` mirror | Weekends skipped in the org timezone; public holidays are not (v1). |
| UI | `FollowUpBadges` (`auto`, `soon`), `FollowUpPanel` in Today's peek (why line; **No reply yet**, **Park until…**, **Won or lost** → the job's Finance tab), badges on the project Work rail | The work list widget is now in `DEFAULT_DASHBOARD_LAYOUT` (FEATUREDOCS/81) so follow-ups have a home on the landing page. |

## Data

`projectTasks.automation` (optional; its presence is what makes a row automated):
`ruleKey` (`"quote"` | `"invoice"` | `"invoice_unraised"`), `subjectId` (current quote / the invoice / the project), `rung`, `loopStartAt` (groups a loop's
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
- Don't add a second writer of follow-up rows. A new rule goes into a pure `plan*` function
  (`followUpRules.ts` / `followUpInvoiceRules.ts`) + a `LoopSpec` in `reconcileFollowUps`, not
  into a call site.
- Flow never contacts the client (design D2) — every channel here is internal.

## Not built yet

- Pipeline-staleness rules (a job sitting in the pipeline with no movement) — design §10.
- Public holidays in business-day arithmetic.
- A "last run" heartbeat for the hourly tick in the settings UI (the Xero payment check shows
  its own last-checked time).
- Existing saved dashboard boards are not rewritten to add the work list — "Add widget" or
  "Reset to default" brings it in.
