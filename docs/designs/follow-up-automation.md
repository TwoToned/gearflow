# Follow-up automation — the follow-up engine

> _Owner: Jayden Nawotka · Created: 2026-09-23 · Status: **APPROVED** 2026-09-23 (office-hours, decisions D1–D7) · Review quarterly (POLICY.md R-5.5)_

**Mode:** intrapreneurship (RVLT Flow is the company's own operating system and a sold product).
**Stage:** has users. **Builds on:** [`work-layer.md`](./work-layer.md) and
[`work-layer-v2-integration.md`](./work-layer-v2-integration.md) — read §9 of the first before this.
**Binding:** [`POLICY.md`](../../POLICY.md), [`DESIGN.md`](../../DESIGN.md).
**Companion docs:** FEATUREDOCS [17](../../FEATUREDOCS/17-notifications.md),
[50](../../FEATUREDOCS/50-project-tasks.md), [66](../../FEATUREDOCS/66-finance-quotes-invoices-xero.md),
[76](../../FEATUREDOCS/76-project-status-automation.md), [77](../../FEATUREDOCS/77-money-phase-lifecycle.md),
[79](../../FEATUREDOCS/79-today.md), [80](../../FEATUREDOCS/80-client-relationship-layer.md),
[81](../../FEATUREDOCS/81-customizable-dashboard.md).

---

## 1. Problem

The request, in the owner's words: *"when sending a quote, add a task to follow up with client,
add a task about it being overdue etc. same with invoices, or like automated follow up reminders
based on the timeline of the job (e.g. if we have a job that's been in the pipeline for months
with no movement)."*

And from the QOL sweep a week earlier: *"A sent quote nobody chased is the most expensive silent
failure in the product."*

Stated precisely: **Flow computes most of the signals already, but none of them becomes a dated,
owned piece of work that reaches the right person at the right time and closes itself when the
world moves on.**

## 2. Evidence — production, read-only, 2026-09-23

| Finding | Number |
|---|---|
| Open pipeline jobs with a next step logged | **0 of 7** — the manual next-step feature (#1245) is unused |
| Oldest open quote | v7, **28 days** out, no follow-up logged, expires in 1 day |
| Unconfirmed quote closest to its event | sent 7 days ago, **event in 8 days**. Today's only push (`quote_expiring`, 7 days before `validUntil`) fires **a week after the event starts** |
| Confirmed job starting tomorrow | shown as rotting **error** (189 days since client touch) — a false alarm |
| Quotes that ended with an explicit decline | **0**. Lost quotes go silent and expire (2 so far, one on a cancelled job) |
| Send → accept (n=3) | same day, same day, 2.5 days |
| Job created → event start (n=40) | median 34 days, p15 **8 days**, 11 of 40 booked < 14 days out |
| Invoice terms | typically 14 days; Flow invoicing began 2026-08-04 |
| Finished jobs with no Flow invoice | **42 (~$76k)** — pre-cut-over history, invoiced in Xero |
| Payment truth | invoices are raised in Flow, **paid/reconciled in Xero**; Flow has no Xero payment poll (FEATUREDOCS/66 "Deferred") |

Caveat: quoting in Flow is two months old (8 quoted jobs, 3 acceptances, 7 invoices). Every
default below is a starting guess to be recalibrated at ~30 sent quotes (§12).

## 3. What exists today

| Piece | Where | Gap |
|---|---|---|
| `quote:nonext` signal — quote SENT 24h+, client has no open `follow_up` | `dashboardLists.needsYou` (derived) | Asks a human to create the follow-up; nobody does. Lives in a widget not on the default dashboard |
| `quote:expiring` signal + `quote_expiring` bell/email | `needsYou`, `getNotifications()` | Anchored to **expiry**, not to **send** — fires 23 days after a 30-day quote goes out |
| Pipeline rotting (amber 7 / error 14 days since client touch) | `pipeline.forOrg`, `rottingDates.ts` | Idle days only; blind to the event date (§4.1) |
| Work templates seeded on `CONFIRMED` | `workTemplateSeeding.ts` | Only one trigger; nothing resolves them automatically; no admin UI |
| `/finance` chase board (quotes out, expiring, uninvoiced, deposit due, outstanding) | `financeOrg.bundle` | Pull-only; carries the 42-job backlog as noise; "outstanding" is wrong for Xero-paid invoices |
| Snooze / dismiss / promote of derived signals | `workSignalStates` | Works; stays |
| Stored `notifications`, email digest cron + dedupe log, push subscriptions | FEATUREDOCS/17, 50 | Only `mentioned` is ever emitted; push has no sender |
| Personal work list | `TodayWorkListWidget` | Not in `DEFAULT_DASHBOARD_LAYOUT`; `/today` is hidden (D10C) |

Net: the signals exist, scattered across five surfaces, all pull, most off-screen by default.

## 4. Research — what the evidence says to build

Four research passes (notification/interruption science, behavioural science of reminders,
follow-up timing evidence, automation UX in CRM/work tools). The rules that shape the design:

| # | Finding | Source | Design rule |
|---|---|---|---|
| R1 | Most clinical alarms are non-actionable, and staff learn to ignore all of them (alarm fatigue); CDS alert override rates run ~49–96% | Joint Commission Sentinel Event Alert 50 (2013); van der Sijs et al., *JAMIA* 2006 | **Every automated item must be actionable and true.** A rule that can produce false items (e.g. chasing a Xero-paid invoice) does not ship until its truth source exists |
| R2 | "Every page should be actionable"; alert on symptoms, auto-resolve, dedupe | Ewaschuk, *My Philosophy on Alerting* / Google SRE book ch. 6 | One open item per thing; items **resolve themselves** when the condition clears |
| R3 | Interrupted work is completed faster but at higher stress/cost | Mark, Gudith & Klocke, CHI 2008 | No notification at creation; interrupt only for same-day urgency |
| R4 | Batching notifications ~3×/day improved well-being and attention vs. real-time | Fitz et al., *Computers in Human Behavior* 2019 | **Morning brief** is the primary channel; push is the exception |
| R5 | Repeated identical warnings habituate within a few exposures (fMRI); varied ("polymorphic") warnings resist it | Anderson et al., CHI 2015 / *JAIS* 2016 | Escalation **changes** the item (copy, priority, action), it does not repeat it; each rung is capped |
| R6 | If-then plans ("when X, I will do Y") roughly double follow-through (d ≈ 0.65) | Gollwitzer & Sheeran, *Adv. Exp. Soc. Psych.* 2006 (meta-analysis, 94 studies) | Items name **one action, one object, one date** ("Call about 260801 v7 — expires Thu") |
| R7 | Making a concrete plan for an unfinished goal removes its intrusive pull (Zeigarnik) | Masicampo & Baumeister, *JPSP* 2011 | Completing a follow-up asks for the **next date** — an open loop never exists without one |
| R8 | Reminders work by making a goal top-of-mind; specific reminders beat generic; effects fade with repetition | Karlan, McConnell, Mullainathan & Zinman, *Management Science* 2016 | Specific copy; a finite ladder, then a forced decision |
| R9 | Temporal landmarks (Mondays, month starts) raise goal pursuit | Dai, Milkman & Riis, *Management Science* 2014 | Monday brief carries the week ahead |
| R10 | Diffusion of responsibility: shared ownership lowers the chance anyone acts | Darley & Latané, *JPSP* 1968; social loafing (Latané et al. 1979) | **One named owner** per item, with a fallback chain; never "the team" |
| R11 | Automation invites complacency and out-of-the-loop errors | Parasuraman & Manzey, *Human Factors* 2010; Bainbridge, *Automatica* 1983 | Show **why** each item exists and **what Flow is watching**; never silently drop coverage |
| R12 | Defaults are sticky | Johnson & Goldstein, *Science* 2003 | Core rules ship **on**; advanced rules off; every rule has a visible toggle |
| R13 | Contacting a lead within an hour made qualification ~7× likelier than after an hour; reply probability decays fast after the first day or two | Oldroyd, McElheran & Elkington, *HBR* 2011; Kooti et al., WWW 2015 | First follow-up at **2 business days**, not at expiry |
| R14 | Social-norm and specific payment messages raise on-time payment | Hallsworth, List, Metcalfe & Vlaev, *J. Public Econ.* 2017 | Chase text (pasted by the operator, D2) states the amount, the due date and the ask |
| R15 | Work-item **age** against the item's own history (e.g. 85th percentile cycle time) is a better "this is stuck" signal than a fixed number | Vacanti, *Actionable Agile Metrics* 2015; Pipedrive "rotting" | Staleness thresholds are **per stage**, later calibrated on the org's own p85 |
| R16 | CRM practice: every deal must carry a scheduled next activity; sequences auto-stop on reply | Pipedrive activity-based selling; HubSpot sequences/tasks; Jobber quote follow-ups | The **next-step invariant** (§6.1) |
| R17 | Snooze is used heavily; deferred items that return at a chosen time are acted on more than ones left in place | Weber et al., "Snooze!", MobileHCI 2018 | Snooze to a date; "park until" replaces dismiss for open loops |

Where the research is thin (vendor claims like "80% of sales need five follow-ups") it is not used.

### 4.1 The rule no CRM gets right for this business (eureka)

CRMs measure staleness as *days since last activity*, because a generic B2B deal has no hard
date. **An event-hire job has an immovable date.** Idle time only matters relative to the runway
left. Production proves it: the rotting board shows a confirmed job starting tomorrow as red
(189 idle days) and an unconfirmed quote whose event is 8 days away as amber.

So the follow-up ladder is anchored to the **send date** but **clamped by the runway**:

```
decideBy = eventStart − decisionLeadDays     (default 14; the job must be secure by then)
deadline = min(decideBy, validUntil − 2d)

rung 1 : send + 2 bd
rung 2 : rung 1 + 5 bd
rung 3 : the decision ("won, lost, extend or park?")
every rung is clamped to ≤ deadline; if deadline − now < 7d, remaining rungs are daily
and the item is push-eligible ("urgent")
```

That single rule gives the right answer on all three production cases: the quote with an
8-day runway goes urgent now; the quote 170 days out gets two gentle rungs and a decision
before its validity lapses; the confirmed job starting tomorrow gets nothing (it has no open
quote loop — readiness is a different concern). A richer runway × silence matrix is not needed
for v1.

## 5. Decisions (this session)

| # | Question | Decision | Consequence |
|---|---|---|---|
| D1 | Where do invoices and payments live? | **Flow raises invoices; payments are reconciled in Xero** | Invoice rules are blocked on a Xero payment-status sync (phase 2). Invoice rules apply only to invoices issued in Flow (≥ cut-over), never the 42-job backlog |
| D2 | Should automation contact clients? | **Internal only** | "Flow never emails clients" (work-layer D3) stands. Chase items carry paste-ready text. Client-side invoice reminders are Xero's job |
| D3 | Delivery | **Morning brief email + dashboard "My work" + push for urgent only** | No bell traffic for auto items. Push needs a sender (phase 3) |
| D4 | Real pain | **Quotes going quiet; late/unpaid invoices** | Build order: quotes, then invoices. Prep and relationship rules later |
| D5 | Premises (§6) | **Agreed** | — |
| D6 | Approach | **B — follow-up engine**, shipped quotes-first | §8 |
| D7 | **Supersedes work-layer R3 for follow-ups** (spec review) | Follow-ups are **stored** rows kept in sync by a reconciler; a **scheduled** run exists | See §5.1 |

### 5.1 Why this supersedes work-layer R3 (for follow-ups only)

R3 (work-layer.md §9) chose *derive on read, store only a human's decision, no cron*. It deleted
the sweep, dedupe keys, reopen/cancel rules and the `ENABLE_CONVEX_CRONS` dependency. This design
brings back stored rows, one hourly scheduled tick, close rules and the cron dependency — deliberately,
for three reasons R3 could not satisfy:

1. **The owner asked for tasks** — assignable, snoozable, visible on the job's Work list and the
   owner's work list. A derived signal is none of these until a human promotes it, and in
   production nobody does (0 of 7 jobs have a next step).
2. **D3 requires push and email.** A derived signal cannot notify anyone: something has to
   evaluate it on a schedule. R3's design had no answer for "tell me at 7am".
3. **The read R3 feared is not this read.** R3 was driven by `projectReadiness`' quadratic
   org-history scan. The reconciler reads one project's quotes, invoices and open auto rows; the
   hourly tick reads status-indexed, capped sets of SENT quotes and ISSUED invoices (the
   `financeOrg` bundle's shape), once an hour.

What R3 still governs: every *other* derived signal (crew declined/stale, readiness, overbookings)
stays derived. And R3's own escape hatch is honoured — an auto row **reuses the signal's
sourceKey**, so a promoted signal and an auto row are the same row (§8.2).

## 6. Premises (agreed)

1. **Build on the work layer.** Auto items are real `projectTasks` rows (`kind: follow_up`),
   linked through `workItemLinks`, on existing surfaces. No new object.
2. **The next-step invariant.** Every open commercial loop — a SENT quote, an unpaid Flow
   invoice — has exactly one open, dated, owned next step. The engine creates it, moves it, and
   closes it. "Stale" is simply "next step overdue"; there is no separate idle detector.
3. **Self-resolving.** Accepted / declined / recalled / superseded quote, paid / voided / credited
   invoice, cancelled project → the item closes with a system note. A human completing one is
   asked *what happened*: **no reply → next on [date]**, **won**, **lost (reason)**, **parked
   until [date]**.
4. **Escalate, then stop.** Two follow-ups (send + 2 bd, then + 5 bd, clamped near the event),
   then a forced decision. No infinite nagging.
5. **No chasing without truth.** Invoice rules wait for the Xero payment sync and start at a
   cut-over date.
6. **Batch by default.** Silent at creation; surfaces when due, in the brief and the widget.
   Push only when runway is short, capped at 2/day/person.
7. **One scheduled run + reconcile-on-write**, not a 15-minute sweep (§5.1).

## 7. Approaches considered

| | A — Quote follow-ups only | **B — Follow-up engine (chosen)** | C — Next-step invariant only |
|---|---|---|---|
| Summary | On send, create a follow-up; close it on accept/decline/new version. Widget + brief | One rule table + reconciler; event-clamped ladder; outcome capture; Xero payment sync; invoice rules; brief; urgent push; settings | Stage transitions propose a next step; completing one requires the next or a close-out |
| Effort | S (human ~1.5 wk / CC ~1–2 d) | L (human ~5 wk / CC ~6–8 d), phased | M (human ~2 wk / CC ~2–3 d) |
| Risk | Low | Med | Low |
| Pros | Fastest; fixes pain #1 | Both pains; one place for rules; self-healing; future rules are rows, not plumbing | Tiny surface; very explainable |
| Cons | No invoices; close-hooks scattered per mutation; not event-aware | Needs a scheduler actually running in prod; most moving parts | Humans pick dates; weak escalation; still needs Xero sync |
| Reuses | `projectTasks`, `workItemLinks`, `WorkComposer` | A + `projectAutoStatus` rule-table pattern, the cron → Next route hop, `notification-email-sender` + `notificationEmailLogs`, `pushSubscriptions`, `src/server/xero.ts`, `orgSettings` | A + next-step banner |

B is A plus C's invariant plus the plumbing both lack. A's close-hooks-per-mutation is exactly
the drift CLAUDE.md warns about for status automation ("add a TRIGGER, never a second patch site").

## 8. Design

### 8.1 The rule table — `convex/lib/followUpRules.ts`

Same shape and discipline as `AUTO_STATUS_RULES` (FEATUREDOCS/76): a table, one reconciler,
called once at the end of a mutation, never in a loop. **One rule per loop, one key per loop**:
the decision is the last rung of the follow-up rule, not a second rule, so a quote can never
carry two open items.

```ts
type FollowUpRule = {
  key: "quote" | "invoice" | "invoice_not_raised";
  settingKey: FollowUpSettingKey;       // absent = ON (same convention as AUTO_STATUS_KEYS)
  // Pure: given one project's facts + org settings + now, what SHOULD exist for this loop?
  desired(facts: ProjectFollowUpFacts, settings, now): null | {
    subjectId: string;                   // quoteId / invoiceId / projectId
    rung: number;                        // 1, 2, … last = decision
    dueDate: number;                     // org-tz midnight, business days (weekends only in v1)
    priority: "NORMAL" | "HIGH";         // the existing WORK_ITEM_PRIORITIES
    urgent: boolean;                     // push-eligible; stored in automation.urgent, not priority
    title: string; why: string; resolvesWhen: string;
    chaseText?: string;                  // paste-ready (D2); uses amount still owed
  };
};

type ProjectFollowUpFacts = {
  project: { id, status, clientId, eventStart?, managerUserIds[] };  // from projectManagers
  liveQuote?: { id, version, effectiveStatus, sentAt, sentById?, validUntil? };  // ONLY the live
                                         // revision opens a loop; other SENT revisions are ignored
  invoices: { id, kind, status, dueDate, total, amountPaid, paymentStatus, xeroInvoiceId? }[];
  autoRows: ProjectTaskDoc[];            // open AND closed rows with automation set, this project
                                         // (outcome, nextDate, anchorAt live on the row itself)
  promoted: Map<sourceKey, taskId>;      // workSignalStates.by_organizationId_sourceKey → promotedWorkItemId
  cutoverAt: number; orgTimezone: string; activeMemberIds: Set<string>;
};
```

`desired()` is pure and unit-tested against fixtures, including the production cases in §2
(8-day runway, confirmed-tomorrow, expired-on-cancelled, v7 recalled-and-resent).

**Owner chain:** quote `sentById` → first `projectManagers` row → org owner — each checked
against **live** org membership; a departed owner falls through. Never unassigned (v2 rule:
"no work item may exist that no surface will show").

### 8.2 The reconciler — `reconcileFollowUps(ctx, projectId, now)`

A plain helper (not a public function) in `convex/lib/followUpReconcile.ts`. Desired state vs.
actual state (this project's open rows with `automation` set — a per-project read, so no new
`sourceKey` index is needed) → create / update / close.

**Identity reuses the signal keys** so R3's promote path and the engine converge on one row:
`quote:nonext:<quoteId>` for the quote loop, `invoice:chase:<invoiceId>`,
`invoice:unraised:<projectId>`. If a human already promoted the signal, the reconciler adopts
that row instead of creating a second — found through `workSignalStates.by_organizationId_sourceKey`
→ `promotedWorkItemId` (a promoted row has no `automation` and may have no `projectId`, so the
per-project scan alone would miss it). On adoption it gains `automation`, `kind: follow_up` and
the `projectId`. The reverse holds too: `promoteSignalNative` checks for an open auto row with
that loop and returns it instead of inserting, so two users promoting the same signal get one
row. Lookup key on a new version: the reconciler searches by `automation.loopKey`, and the
derived `quote:nonext` signal is suppressed for any quote whose project has an open quote loop.

**Loop identity across versions.** The key names the loop, not the revision: it is minted from
the first live quote id of the loop and stored in `automation.loopKey`; a new live version
inherits the open row (its `automation.subjectId` moves to the new quote id). `anchorAt` (when
the current ladder started) and `rung` live on the row, so the resend rule below never needs
`sentAt` history (which `quotesWrites` overwrites on every resend).

**Human edits win.** The reconciler only writes fields it owns and a human hasn't touched:
`automation.lockedFields` records `dueDate` / `assignee` / `title` once a human edits them, and
those are never overwritten. **Every close or edit of an auto row goes through the reconciler** — the outcome menu, the
plain DONE toggle (`updateNative`), `completeNextStepNative`, `deleteNative`, and the bulk paths
`bulkUpdateNative` / `bulkDeleteNative` (reconcile once per distinct project after the loop).
`updateNative` and `bulkUpdateNative` stamp `lockedFields`; both delete paths **soft-delete**
auto rows instead of `ctx.db.delete`. A plain DONE with no
outcome is recorded as `outcome: "no_reply"` (advance a rung). A delete is a **soft** close:
`status: CANCELLED`, `automation.resolution: "deleted"` — the tombstone that stops that rung
returning. **Parking has one representation:** `automation.outcome: "parked"` +
`snoozedUntil` on the row. `workSignalStates` gains no new state.

Guards, in the facts not in each rule: nothing on a `CANCELLED` project; nothing for subjects
created before `cutoverAt`; a quote whose job went ahead (`CONFIRMED`+) without acceptance, or
whose event has started while still SENT, yields one "record the outcome" item and no chase; a
project with no event date uses `validUntil − 2d` as its deadline.

**Resends:** a new version or a recall→resend restarts the ladder at rung 1 (resetting
`anchorAt`) **only if** `anchorAt` is ≥ 5 bd ago; otherwise the ladder continues where it was (the v7 case: six
resends must not mean six fresh 2-day grace periods).

Called:
- **On write**, once at the end of: quote send / accept / decline / recall / new version
  (`quotesWrites`), invoice issue / void / credit (`invoicesWrites`), payment record / void
  (`paymentsWrites`), project status change (`updateStatusNative`,
  `maybeAutoAdvanceProjectStatus`), project date change, the outcome mutation (§8.3), and the
  Xero payment sync.
- **Scheduled**: an **hourly** Convex cron → `internal.followUps.tick` (internal **action**) which
  runs the reconcile as internal mutations and makes the HTTP hops itself (a mutation cannot).
  `invokeCronRoute` gains a `flag` parameter so the follow-up hops honour `ENABLE_FOLLOW_UP_CRON`
  instead of `ENABLE_CONVEX_CRONS`; new routes `/api/cron/follow-up-brief` and
  `/api/cron/xero-payments`. The tick that selects orgs whose local time just crossed 06:30 (org timezone; **the org timezone via the
  existing `resolveOrg*Config` helpers — no new default: phase 0 sets the prod org's timezone,
  and an org without one is skipped by the tick and flagged in settings, rather than silently
  changing every UTC-defaulted date stamp), reconciles every project with a SENT quote
  or an unpaid Flow invoice (status-indexed, capped scans), and records which urgent items need
  a push. Delivery (brief, push) is then triggered through the existing cron → Next route hop
  (§8.6), because recipients and roles live in Postgres.

### 8.3 v1 rules

| Rule | Opens when | Ladder (defaults, settings-tunable) | Closes when |
|---|---|---|---|
| **Quote** | a revision becomes the live SENT quote (live `sentAt` ≥ cutover) | 1: send + 2 bd · 2: + 5 bd · 3: decision "Won, lost, extend or park?" — all ≤ deadline; deadline < 7 d away ⇒ daily, `urgent` | accepted / declined / recalled-not-resent / project cancelled; superseded ⇒ continues on the new version (resend rule above) |
| **Invoice** *(phase 2)* | Flow invoice ISSUED (≥ cutover), not PAID, past due | 1: due + 1 bd · 2: + 7 d · 3: + 14 d "call" · 4: + 30 d decision (plan / write-off). DEPOSIT with event ≤ 7 d ⇒ `urgent` ("gear is held, deposit unpaid"). Chase text uses **amount still owed** | PAID, VOID, or fully credited (a partial credit keeps it open with the new balance) |
| **Invoice not raised** *(phase 2)* | project RETURNED/COMPLETED ≥ cutover, no ISSUED non-credit invoice, not fully invoiced by deposit | returned + 2 bd | invoice issued / project cancelled |

A deposit and a balance invoice are separate loops (separate invoice ids) and can both be open;
the brief lists the deposit first. **Orgs without Xero connected:** invoice rules run on
Flow-recorded payments only and the settings page says so.

**Outcome capture:** `followUpsWrites.recordOutcomeNative({ taskId, outcome, nextDate?,
reason? })` (browser-direct; gated like task updates via `projectTasksWrites`' `requireWorkOrProjectOrgUpdate`,
exported; danger `medium`) handles only `no_reply` and `parked`. **Won and lost are not outcomes of
this mutation:** the outcome menu calls the existing `markAcceptedNative` / `markDeclinedNative`
(`invoice:publish`, danger `high`, so agents and Mira need `confirm`), passing `reason` to decline;
those mutations already end in the reconciler call. No privileged-args row — the dispatcher's
escalation only matches `allow|force|…` names, and splitting is simpler than bending it. It writes the `next_step_completed` timeline
row and calls the reconciler: *no reply* advances a rung (or to `nextDate`), *parked* sets
`snoozedUntil` and pauses the ladder. UI: the outcome menu on the row's circle in the work list
and the project rail (`WorkRow` extraction, v2 §5 change 9).

### 8.4 Data — additive fields (no new tables)

- `projectTasks`: reuse `kind: "follow_up"`, `sourceKey`, `snoozedUntil`, `priority`. Add
  `automation: v.optional(v.object({ ruleKey, loopKey, subjectId, rung, anchorAt, urgent,
  lockedFields: v.array(v.string()), outcome: v.optional(v.union("no_reply", "won", "lost",
  "parked")), nextDate: v.optional(v.number()), resolvedBy: v.optional(v.string()),
  resolution: v.optional(v.string()) }))` — structured outcomes live on the row, so the facts
  never parse free-text timeline rows. `resolvedBy: "system" | userId` measures the ≥ 90 %
  auto-resolve target. `status` uses the existing CANCELLED for soft-deleted/superseded rows. FEATUREDOCS/50's
  "sourceKey is only set by promotion" line and the `schema.ts` comment are stale (templates set
  it) and get corrected.
- `payments` (phase 2): add `source: v.optional(v.union(v.literal("flow"), v.literal("xero")))`
  (absent = flow) and `externalPaymentId: v.optional(v.string())` with index
  `by_organizationId_externalPaymentId` for idempotency; `recordedById` becomes optional for
  `source: "xero"` rows (display "Xero"); `method` gains `XERO`.
- `workItemLinks`: each auto item links to its client **and** its quote/invoice (existing
  entity types), so the client page and the pipeline see it with no new read.
- Org settings: `OrgSettings.followUps` (`enabled` per rule, offsets, `decisionLeadDays`,
  `cutoverAt`) in the existing JSON blob, resolved server-side like `resolveOrgWorkConfig`
  (clamped, absent = default). Key registry on both sides with a parity test, like
  `AUTO_STATUS_KEYS`. **`cutoverAt` is stamped the first time a rule is enabled for an org**
  (for existing orgs: at deploy of phase 1). A quote loop is in scope if its **live revision's
  `sentAt` ≥ cutoverAt** — so a pre-cutover quote resent afterwards is chased; an invoice if its
  `issuedAt` ≥ cutoverAt; invoice-not-raised if the project reached RETURNED ≥ cutoverAt.
- New business-day helper in `convex/lib/quoteDates.ts` (weekends only in v1, org timezone).

### 8.5 Xero payment sync (phase 2 prerequisite)

The Xero client and token vault live in `src/` (`src/server/xero.ts`, `src/lib/xero-client.ts`),
which Convex cannot import. So the sync is a **Next route** (`/api/cron/xero-payments`,
`CRON_SECRET`-authed), triggered by the hourly cron hop and by an on-demand "Refresh from Xero"
button. It fetches the org's Flow-pushed invoices that are not PAID (batched by `xeroInvoiceId`,
well inside 60 req/min) and reads **invoice-level truth** — `Status`, `AmountDue`,
`AmountPaid`, `AmountCredited` — not just Payments, because voids, credit-note allocations,
overpayments and edits made in Xero never appear as Payments. For each Xero payment it calls a
`requireService` Convex mutation `paymentsWrites.recordFromXeroNative` (a Next route cannot call
an internal mutation) that upserts on `externalPaymentId`; Xero's `AmountCredited` and `AmountDue` are stored on the invoice (`xeroAmountCredited`,
`xeroAmountDue`), and `recomputeInvoicePaymentState` treats `amountPaid + credited ≥ total` as
settled — so the facts, the chase text (amount still owed) and `paymentStatus` all agree, and a
Xero-side credit can't be re-opened by the next tick. A Xero VOID marks the Flow invoice's
`xeroStatus` and closes the loop. Token refresh: `getFreshAccessToken` rotates the refresh token
without a lock (`src/server/xero.ts`), so **`getFreshAccessToken` itself** takes a per-org lease (a Convex row with an expiry) — every
caller (push, contact search, reference refresh, sync) is covered. Settlement runs as a
defined **system actor** (`{ kind: "system", name: "Xero sync" }`), which
`maybeAutoAdvanceProjectStatus` needs — merged with, never
overwriting, Flow-recorded payments (FEATUREDOCS/66's deferred spec). **The settlement logic
(`paymentStatus` recompute + `PAYMENT_SETTLED` auto-status + reconciler call) is extracted out
of `recordNative` into a shared helper** both paths call; it does not "fire unchanged" today,
because it lives inside a user-gated mutation. Xero webhooks are a later latency improvement.

### 8.6 Delivery

- **Morning brief** (email, ~07:00 org-tz, business days, per user per org): *Chase today*
  (ordered by deadline), *Decisions needed*, *Payments overdue* (phase 2). Top 5 per section +
  "and N more". **Not sent when empty.** Path: the existing `notification-email-sender.ts` in
  Next (it owns recipients and roles in Postgres), invoked by the cron hop; it reads each user's
  open auto items from Convex. Dedupe key **`brief:<orgId>:<userId>:<yyyy-mm-dd>`** in
  `notificationEmailLogs`. Money lines gated on `invoice:read` (the #1225 audience rule).
- **Dashboard:** `todayWorkList` joins `DEFAULT_DASHBOARD_LAYOUT` at the top; existing saved
  layouts get it inserted once. Auto rows carry the `auto` badge, the *why* line, and the
  outcome menu.
- **Push (phase 3):** web-push sender over `pushSubscriptions`; only `automation.urgent` items;
  ≤ 2 per person per day; quiet hours 19:00–07:00 org-tz; deep link. iOS needs the installed
  PWA — the toggle says so. A sender library needs an R-6.3 justification.
- No bell traffic for auto items (D3). The derived `needsYou` rail keeps its other signals;
  its `quote:nonext` row disappears naturally once the auto row with the same key exists.

### 8.7 Trust surfaces (R11)

- Every auto item shows *why* ("v2 sent 15 Sep · no reply logged"), *resolves when* ("client
  accepts or declines") and *Change timing* → settings. (Phase 1.)
- `/settings/automation` UI with per-rule toggles and offsets. (Phase 3.)
- Later, not v1: per-rule health stats, a pipeline coverage line, product analytics events.

## 9. Phasing

| Phase | Ships | Exit criteria | Effort |
|---|---|---|---|
| **0 · Plumbing** | `todayWorkList` in the default dashboard (+ one-time insert into saved layouts); **give the follow-up tick its own flag (`ENABLE_FOLLOW_UP_CRON`)** rather than flipping the global
`ENABLE_CONVEX_CRONS`, which also switches on org-dormancy archiving, the 15-min notification
emails (first-run backlog), PM generation and log purge; set `CONVEX_CRON_TARGET_URL` +
`CRON_SECRET` and prove one tick; set the prod org's timezone | Widget visible to both users; the existing `runNotificationEmails` job fires once on prod under a temporary flag with a
  dry-run target, proving the cron → Next hop (the follow-up tick itself ships in phase 1) | ½ d / 2 h |
| **1 · Quotes** | Rule table + reconciler + hourly tick; quote rule with decision rung; outcome capture; business-day helper; morning brief; `cutoverAt`; settings JSON (no UI) | Every new SENT quote has an auto item after one write; zero items on cancelled/finished jobs or pre-cutover quotes; first briefs land | 1.5 wk / 3 d |
| **2 · Money** | Xero payment sync route + `payments` fields + shared settlement helper; invoice + invoice-not-raised rules; one-time backlog clean-up list | A Xero-paid invoice closes its chase within one tick; zero chases on paid invoices over 2 weeks | 1.5 wk / 2–3 d |
| **3 · Reach** | Push sender (urgent only); `/settings/automation` UI | Urgent push ≤ 2/day; settings round-trip | 1 wk / 1–2 d |
| **Later** | Delivery rules (templates for more statuses, auto-resolving checklists), anniversary rebooking, Mira-drafted chase text, p85-calibrated offsets, rule health, public holidays | — | — |

**Same-PR docs (R-5.2):** FEATUREDOCS 50 (automation field, sourceKey note), 17 (brief type),
66 (Xero payment sync, phase 2), 79/81 (default layout), 80 (`quote:nonext` convergence), a new
FEATUREDOCS/82 for the engine; CLAUDE.md gains a short "follow-ups: add a RULE, never a second
task writer" note next to the auto-status one. Registry / OpenAPI / MCP regenerated for
`recordOutcomeNative`.

### 9.1 Build status (2026-09-23)

| Phase | State |
|---|---|
| 0 · Plumbing | **Done in code:** `todayWorkList` in `DEFAULT_DASHBOARD_LAYOUT`. **Deviation:** existing saved boards are not rewritten (no per-user migration for two users; "Add widget" / "Reset to default"). **Ops, not code:** set `ENABLE_FOLLOW_UP_CRON=true` on prod Convex and set the prod org's timezone. |
| 1 · Quotes | **Built:** rule + reconciler + write-path hooks + human-edit policy + `recordFollowUpOutcomeNative` + hourly tick + settings JSON + UI (badges, why line, no reply / park / won-or-lost). **Not yet:** the morning brief email (needs the cron → Next hop and a new email template). |
| 2 · Money | Not started (Xero payment sync first). |
| 3 · Reach | Not started. |

FEATUREDOCS/82 is the as-built reference.

## 10. Not building

Client-facing email of any kind (D2). A free-form rule builder (presets + toggles beat builders
for noise). Auto-scheduling. A bell entry per auto item. Chasing anything Flow cannot verify. SMS.

## 11. Success criteria

- **Silent expiry rate** (quotes that expire with no recorded outcome): baseline 2 of 2 lost
  quotes → < 10 %.
- Median send → first follow-up ≤ 2 business days (baseline: none logged).
- 100 % of SENT quotes and unpaid Flow invoices carry a dated next step (by construction); < 10 %
  of them overdue at any time.
- ≥ 90 % of auto items resolved by the system, not a human close (work-layer §15 target).
- Park + delete rate < 20 % (noise ceiling; `automation.outcome = parked` + `resolution = deleted`).
- Phase 2: days-past-due on Flow invoices trends down month over month.

## 12. Open questions

1. `decisionLeadDays` default (14): right for dry hire; short for jobs with sub-hires or crew?
2. Invoice chase owner: the PM, or a finance role holder? (Proposed: PM, overridable per org.)
3. Should parking a quote also release held gear? (Proposed: no — separate, explicit action.)
4. Recalibrate offsets to the org's own p50/p85 send → decision time once n ≥ 30 sent quotes.

Closed by review: business days are **weekends only** in v1 (public holidays later).

## 13. Risks

- **The scheduler is a single point of failure.** Items still open on write without it, but
  nothing escalates and no brief goes out. Phase 0 proves the cron runs; the tick writes a
  heartbeat row, and the settings page shows "last run" (the brief can't be the heartbeat —
  it isn't sent when empty).
- **Xero rate limits** (60/min, 5,000/day per tenant) — batch by InvoiceID; unpaid only.
- **Backfill flood** — prevented by `cutoverAt`. Getting it wrong recreates alarm fatigue on day one.
- **Reconciler vs. humans** — `lockedFields` + parked-on-delete; covered by tests that edit,
  reassign and delete auto rows and then run the tick twice.
- **Convex rules** (CLAUDE.md): `ConvexError` only; `requireOrgReadFor` with a resource;
  `agentOps` on every new operation; org-check every `by_cuid` read (ratchet at 0); regenerate
  registry / OpenAPI / MCP together.

## 14. The assignment

Before phase 1 starts: **for the next two weeks, every time you follow up on a quote or chase a
payment, note the date, the job, how you did it (call / email / text), and what happened.** It
sets the real ladder offsets and tells us whether "no reply → next rung" is the common case —
right now there are three data points.

## 15. What I noticed

- You didn't ask for reminders, you asked for *tasks* — work that sits somewhere, owned. That
  instinct is why this is an engine that writes rows, not another chip.
- Asked where money lives, you answered *"Flow invoices, Xero payments"* — the one answer that
  makes invoice chasing a data problem before it's a UX problem. It moved the Xero sync to the
  front of phase 2.
- You picked *internal only* when full automation was on the menu. Same boundary you held a week
  ago (work-layer D3), and it keeps every false positive in-house.

## 16. Review record

Round 3: 7/10, 8 findings, all applied — won/lost moved to the existing accept/decline
mutations (no privileged-args bending); bulk paths reconcile + soft-delete + lock fields; tick is
an action with its own-flag hops; no timezone default change; Xero credit stored and used in
the paymentStatus recompute; token lease inside `getFreshAccessToken`; promote adopts; internal
contradictions fixed. Review loop capped at 3 rounds.

Round 2: 6/10, 10 findings, all applied — outcome RBAC + confirm escalation for won/lost;
follow-up cron gets its own flag; promoted-signal adoption via `workSignalStates`; every close
goes through the reconciler with structured outcomes on the row; `loopKey`/`anchorAt` instead
of `sendCount`; only the live revision opens a loop; one parking representation; one timezone
resolver; Xero invoice-level truth, token lease, service mutation, system actor; cutover on
`sentAt`.

Round 1 (independent agent, code-verified): 5/10, 22 findings. Applied:
R3 superseded explicitly (§5.1) with sourceKey reuse; `payments` fields + shared settlement
helper; urgency vs. priority; one ladder timing; phase-0 exit fixed; owner chain; hourly
org-tz cron with a default timezone; brief via the Next hop; Xero sync as a Next route;
business-day helper; human-edit policy; one rule per loop; multi-org dedupe key; resend,
date-move, dateless, departed-owner, partial-payment, partial-credit, deposit/balance, no-Xero
and event-started cases; phase-1 clarity (tick, facts, cutover, outcome mutation, agentOps,
docs); scope trimmed (matrix → clamped ladder; health/coverage/analytics moved later).
