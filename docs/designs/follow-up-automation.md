# Follow-up automation — the follow-up engine

> _Owner: Jayden Nawotka · Created: 2026-09-23 · Status: **DRAFT** (office-hours, decisions D1–D6) · Review quarterly (POLICY.md R-5.5)_

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
| Pipeline rotting (amber 7 / error 14 days since client touch) | `pipeline.forOrg`, `rottingDates.ts` | Idle days only; blind to the event date (§5, eureka) |
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

So urgency here is two-dimensional:

```
decideBy = eventStart − decisionLeadDays        (default 14; the job needs to be secure by then)
runway   = decideBy − now

             runway > 21d        7–21d             < 7d / past
silent  ┌──────────────────┬─────────────────┬──────────────────┐
≤ 2bd   │ nothing          │ nothing         │ follow up today  │
2–7d    │ follow-up #1     │ follow-up #1    │ URGENT (push)    │
> 7d    │ follow-up #2     │ follow-up #2 ↑  │ URGENT (push)    │
        └──────────────────┴─────────────────┴──────────────────┘
```

The follow-up ladder compresses as `decideBy` approaches, and every rung lands before
`min(decideBy, validUntil − 2d)`.

## 5. Decisions (this session)

| # | Question | Decision | Consequence |
|---|---|---|---|
| D1 | Where do invoices and payments live? | **Flow raises invoices; payments are reconciled in Xero** | Invoice rules are blocked on a Xero payment-status sync (phase 2). Invoice rules apply only to invoices issued in Flow (≥ cut-over), never the 42-job backlog |
| D2 | Should automation contact clients? | **Internal only** | "Flow never emails clients" (work-layer D3) stands. Chase items carry paste-ready text. Client-side invoice reminders are Xero's job |
| D3 | Delivery | **Morning brief email + dashboard "My work" + push for urgent only** | No bell traffic for auto items. Push needs a sender (phase 3) |
| D4 | Real pain | **Quotes going quiet; late/unpaid invoices** | Build order: quotes, then invoices. Prep and relationship rules later |
| D5 | Premises (§6) | **Agreed** | — |
| D6 | Approach | **B — follow-up engine**, shipped quotes-first | §8 |

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
4. **Escalate, then stop.** Two follow-ups (2 bd, then 7–10 d, compressed near the event), then
   a forced decision. No infinite nagging.
5. **No chasing without truth.** Invoice rules wait for the Xero payment sync and start at a
   cut-over date.
6. **Batch by default.** Silent at creation; surfaces when due, in the brief and the widget.
   Push only when runway is short, capped at 2/day/person.
7. **One daily run + reconcile-on-write**, not a 15-minute sweep. The inputs are open quotes and
   unpaid invoices — small, status-indexed sets — not the quadratic readiness read that
   work-layer R3 rejected.

## 7. Approaches considered

| | A — Quote follow-ups only | **B — Follow-up engine (chosen)** | C — Next-step invariant only |
|---|---|---|---|
| Summary | On send, create a follow-up; close it on accept/decline/new version. Widget + brief | One rule table + reconciler; event-aware ladder; outcome capture; Xero payment sync; invoice rules; brief; urgent push; settings | Stage transitions propose a next step; completing one requires the next or a close-out |
| Effort | S (human ~1.5 wk / CC ~1–2 d) | L (human ~4–5 wk / CC ~5–7 d), phased | M (human ~2 wk / CC ~2–3 d) |
| Risk | Low | Med | Low |
| Pros | Fastest; fixes pain #1 | Both pains; one place for rules; self-healing; future rules are rows, not plumbing | Tiny surface; very explainable |
| Cons | No invoices; close-hooks scattered per mutation; not event-aware | Needs a reliable daily scheduler; most moving parts | Humans pick dates; weak escalation; still needs Xero sync |
| Reuses | `projectTasks`, `workItemLinks`, `WorkComposer` | A + `projectAutoStatus` rule-table pattern, `notification-email-sender` + dedupe log, `pushSubscriptions`, `xero-client`, `orgSettings` | A + next-step banner |

B is A plus C's invariant plus the plumbing both lack. A's close-hooks-per-mutation is exactly
the drift CLAUDE.md warns about for status automation ("add a TRIGGER, never a second patch site").

## 8. Design

### 8.1 The rule table — `convex/lib/followUpRules.ts`

Same shape and discipline as `AUTO_STATUS_RULES` (FEATUREDOCS/76): a table, one reconciler,
called once at the end of a mutation, never in a loop.

```ts
type FollowUpRule = {
  key: "quote_followup" | "quote_expiry_decision" | "invoice_chase" | "invoice_not_raised" /* … */;
  settingKey: FollowUpSettingKey;           // absent = ON (same convention as AUTO_STATUS_KEYS)
  subject: "quote" | "invoice" | "project";
  // Pure: given the subject's current facts + org settings + now, what SHOULD exist?
  desired(facts, settings, now): null | {
    step: number;                            // 1, 2, … ; drives copy + priority
    dueDate: number; dueTime?: string;       // org-tz, business days
    urgency: "normal" | "high" | "urgent";   // urgent ⇒ push-eligible
    title: string; why: string; resolvesWhen: string;
    chaseText?: string;                      // paste-ready (D2)
  };
  owner(facts): OwnerChain;                  // sender → project PM → earliest projectManagers → org owner
};
```

`desired()` is pure and unit-tested against a table of fixtures — including the production cases
in §2 (8-day runway, confirmed-tomorrow, expired-on-cancelled).

### 8.2 The reconciler — `reconcileFollowUps(ctx, { projectId }, now)`

Desired state (rules × facts) vs. actual state (open rows whose `sourceKey` starts `auto:`) →
create / update (due, step, copy, priority) / close. Idempotent; identity is
`sourceKey = auto:<ruleKey>:<subjectId>`, so there is never a second open row for one thing.

Called:
- **On write**, once at the end of: quote send / accept / decline / recall / new version
  (`quotesWrites`), invoice issue / void / credit and payment record / void (`invoicesWrites`,
  `paymentsWrites`), project status change (`updateStatusNative`,
  `maybeAutoAdvanceProjectStatus`), and the Xero payment sync.
- **Daily**, per org at 06:30 org-tz: reconcile every project with a SENT quote or an unpaid
  Flow invoice (status-indexed, capped scans — the `financeOrg` bundle's read shape), then build
  the brief and the urgent pushes. The daily run is also the backstop that heals anything a
  missed write path left behind.

Lifecycle guards live in the facts, not in each rule: nothing is chased on a `CANCELLED`
project, and a quote whose job went ahead without acceptance (`CONFIRMED`+ with no accepted
revision) yields at most one "record the outcome" housekeeping item, never a chase.

### 8.3 v1 rules

| Rule | Opens when | Ladder (defaults, settings-tunable) | Closes when |
|---|---|---|---|
| **Quote follow-up** | a revision becomes the live SENT quote | #1 at send + 2 bd; #2 at #1 + 5 bd; both clamped before `min(decideBy, validUntil − 2d)`; runway < 7d ⇒ daily + `urgent` | accepted / declined / recalled / superseded (new rung-1 for the new version) / project cancelled |
| **Quote decision** | ladder exhausted, or `validUntil` within 2 d, or expired with no outcome | one item: "Won, lost, extend or park?" | any outcome recorded |
| **Invoice chase** *(phase 2)* | Flow invoice ISSUED, unpaid per Xero sync, past due | due + 1 bd; + 7 d; + 14 d (call); + 30 d decision (plan / write-off). Deposit with event ≤ 7 d ⇒ `urgent` ("gear is held, deposit unpaid") | PAID (Flow or Xero), VOID, credited |
| **Invoice not raised** *(phase 2)* | project RETURNED/COMPLETED ≥ cut-over, no ISSUED non-credit invoice | returned + 2 bd | invoice issued / project cancelled |

Human outcome on a follow-up (premise 3) writes an `activityEvents` row on the client timeline
(the existing `next_step_completed` substrate) and moves the ladder: *no reply* advances a rung,
*won* opens the existing accept flow, *lost* opens the decline flow with a reason, *park* sets
`snoozedUntil` and pauses the ladder until then.

### 8.4 Data — additive only

- `projectTasks`: reuse `kind: "follow_up"`, `sourceKey`, `snoozedUntil`, `priority`. Add
  `automation: v.optional(v.object({ ruleKey, subjectType, subjectId, step, resolvedBy?,
  resolution? }))` — `resolvedBy: "system" | userId` is what measures the ≥ 90 % auto-resolve
  target. FEATUREDOCS/50's "sourceKey is only set by promotion" line is already untrue
  (templates set it) and gets corrected.
- `workItemLinks`: each auto item links to its client **and** its quote/invoice (existing
  entity types), so the client page and the pipeline see it with no new read.
- Org settings: `OrgSettings.followUps` in the existing JSON blob, resolved server-side like
  `resolveOrgWorkConfig` (clamped, absent = default). Key registry on both sides with a parity
  test, like `AUTO_STATUS_KEYS`.
- `cutoverAt` per org: rules ignore subjects created before automation was switched on. The
  backlog is shown **once** as a clean-up list (bulk "invoiced in Xero" / dismiss), never as tasks.

### 8.5 Xero payment sync (phase 2 prerequisite)

A daily (and on-demand "Refresh from Xero") Convex action per connected org: fetch the Xero
invoices Flow pushed that are not yet PAID (by stored Xero InvoiceID, batched), and write each
Xero-side payment as a `payments` row with `source: "xero"` + the Xero PaymentID for idempotency
— merged with, never overwriting, Flow-recorded payments (FEATUREDOCS/66's own deferred-item
spec). `paymentsWrites`' existing `PAYMENT_SETTLED` automation then fires unchanged. Webhooks
(Xero `INVOICE` events) are a later latency improvement, not a requirement.

### 8.6 Delivery

- **Morning brief** (email, 07:00 org-tz, business days, per user): *Chase today* (ordered by
  urgency), *Decisions needed*, *Payments overdue* (phase 2), *Coming up* on Mondays (R9).
  Top 5 per section + "and N more". **Not sent when empty**; Monday always sends. Built on
  `notification-email-sender.ts` with dedupe key `brief:<userId>:<yyyy-mm-dd>`; gated on
  `invoice:read` for money lines (the #1225 audience rule).
- **Dashboard:** `todayWorkList` joins `DEFAULT_DASHBOARD_LAYOUT` at the top; existing saved
  layouts get it inserted once. Auto rows carry the `auto` badge, the *why* line, and one-click
  outcomes.
- **Push (phase 3):** web-push sender over the existing `pushSubscriptions`; only `urgent`
  items; ≤ 2 per person per day; quiet hours 19:00–07:00 org-tz; deep link to the item. iOS
  requires the installed PWA — say so in the settings toggle.
- No bell traffic for auto items (D3). The derived `needsYou` rail keeps its non-follow-up
  signals; `quote:nonext` retires once every SENT quote carries an auto follow-up.

### 8.7 Trust surfaces (R11)

- Every auto item: *why* ("v2 sent 15 Sep · no reply logged") + *resolves when* ("client
  accepts or declines") + *Change timing* → settings.
- **Coverage line** on the pipeline page: "Watching 3 quotes · 1 invoice · all have a next step".
- `/settings/automation`: rules grouped *Quotes · Money · Delivery (later)*, each with a toggle,
  its offsets, and its last-30-day health (created / auto-resolved / completed / parked). A rule
  parked or dismissed > 50 % of the time shows a "timing may be off" hint.
- Product events to PostHog (cuid-only props, per `docs/pii-inventory.md`):
  `follow_up_created|resolved|completed|parked`, `brief_sent|opened`, `push_sent|opened`.

## 9. Phasing

| Phase | Ships | Exit criteria | Effort |
|---|---|---|---|
| **0 · Plumbing that already hurts** | `todayWorkList` in the default dashboard; confirm the notification cron actually runs in prod (external cron or `ENABLE_CONVEX_CRONS`) | Widget visible to both users; a test brief email lands | ½ d / 2 h |
| **1 · Quotes** | Rule table + reconciler; quote follow-up + decision rules; outcome capture; morning brief; `cutoverAt`; settings JSON (no UI yet) | Every SENT quote has an auto follow-up within one write; zero auto items on cancelled/finished jobs; first briefs land | 1.5 wk / 2–3 d |
| **2 · Money** | Xero payment sync; invoice chase + invoice-not-raised rules; backlog clean-up list | Xero-paid invoice closes its chase within one daily run; zero chases on paid invoices over 2 weeks | 1.5 wk / 2 d |
| **3 · Reach** | Push sender (urgent only); `/settings/automation` UI with rule health | Urgent push ≤ 2/day; settings round-trip | 1 wk / 1–2 d |
| **Later** | Delivery rules (templates for more statuses, auto-resolving checklist items), anniversary rebooking (repeat clients' annual shows), Mira-drafted chase text, p85-calibrated thresholds | — | — |

## 10. Not building

- Client-facing email of any kind (D2). A free-form rule builder (research: presets + toggles
  beat builders for noise). Auto-scheduling. A bell entry per auto item. Chasing anything Flow
  cannot verify. SMS.

## 11. Success criteria

- **Silent expiry rate** (quotes that expire with no recorded outcome): baseline 2 of 2 lost
  quotes → < 10 %.
- Median send → first follow-up ≤ 2 business days (baseline: none logged).
- 100 % of SENT quotes and unpaid Flow invoices carry a dated next step (by construction); < 10 %
  of them overdue at any time.
- ≥ 90 % of auto items resolved by the system, not a human close (work-layer §15 target).
- Park + dismiss rate < 20 % per rule (noise ceiling).
- Phase 2: days-past-due on Flow invoices trends down month over month.

## 12. Open questions

1. `decisionLeadDays` default (14): right for dry hire and small jobs, maybe short for jobs with
   sub-hires or crew. Derive per job from sub-hire presence later?
2. Owner for invoice chases: the PM, or a finance role holder? (Proposed: PM, overridable per org.)
3. Business days: org timezone weekends only, or add AU public holidays (state-specific)?
4. Should parking a quote also release held gear? (Proposed: no — separate, explicit action.)
5. Recalibration: switch ladder offsets to the org's own p50/p85 send→decision times once
   n ≥ 30 sent quotes.

## 13. Risks

- **The scheduler is the single point of failure.** If the daily run doesn't fire, items still
  open on write but nothing escalates and no brief goes out. Phase 0 proves it runs; the brief
  itself is the heartbeat (a missing Monday brief is noticed).
- **Xero rate limits** (60/min, 5,000/day per tenant) — batch by InvoiceID; only unpaid invoices.
- **Backfill flood** — prevented by `cutoverAt` (§8.4). Getting this wrong recreates alarm
  fatigue on day one.
- **Convex rules** (CLAUDE.md): `ConvexError` only; `requireOrgReadFor` with a resource;
  `agentOps` with danger classes on every new operation; org-check every `by_cuid` read
  (ratchet at 0); regenerate registry / OpenAPI / MCP together; `orgExport` table count if a
  table is added (none planned).

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
