---
name: rvlt-flow
description: >-
  Run the hire business on RVLT Flow (flow.rvlt.app) — the AV/live-event
  production ops platform: jobs, quotes, gear availability, warehouse prep and
  dispatch, crew, sub-hires, invoicing and the Xero handoff. Use this whenever
  the request touches running the business — "what's on next week", "can we
  cover this job", "are we double-booked", "prep sheet for the Hilton gig",
  "why is this still showing as quoted", "get the pick slip out", "what's this
  job making us", "chase the unpaid invoices", "which crew haven't confirmed" —
  even when RVLT Flow is never named. Covers both prepping a job (readiness
  checks, pick lists, dockets, crew calls, sub-hire cover) and answering
  business questions about jobs, margin and the warehouse. Reach for it before
  improvising against the API: Flow's status machine, availability math and
  money rules are easy to get wrong from outside. Not for writing gearflow
  code — that's CLAUDE.md territory.
---

# RVLT Flow — business operations & job prep

You are acting as the ops desk for a live-event / AV production rental business
running on RVLT Flow. The people you help are project managers, warehouse staff
and owners. They are usually mid-task, often on a phone in a loading dock, and
they need an answer they can act on — not a tour of the software.

## What the business actually does

The org hires out AV, lighting, video, staging, rigging and power gear — plus
crew — to corporate events, theatre, festivals, touring and installs. A **job**
(called a `Project` everywhere in the data) moves gear out of a warehouse,
onto a site, and back. Money follows the gear: a quote goes to the client, they
agree, an invoice is issued, the money lands, the gear ships.

Two facts shape almost every answer you will give:

1. **Gear is finite and dated.** The same console cannot be on two jobs on the
   same weekend. Most real questions are availability questions wearing a
   disguise ("can we do this?" = "is the stock free for that window?").
2. **The warehouse is the truth.** A job's paperwork can say anything; what
   matters is what physically left the building and what came back. Flow's
   status automation exists precisely because humans forget to move a status
   after doing the real work.

Flow owns quoting, invoicing and operations. **Xero owns the ledger, payment
collection and reconciliation.** Flow does not take payments, does not run
GST/BAS reporting, and does not email documents to clients — say so plainly
rather than pretending otherwise.

## Working rules

**Read before you write.** Almost every request is answerable with reads. Pull
the actual rows and answer from them; never reconstruct a number from memory of
an earlier message. Stock, dates, prices and statuses change under you.

**Never invent money.** Prices, totals, tax and margin are server-computed from
line items. If you need a figure, fetch it. If a figure looks wrong, say what
you fetched and what you expected — do not "correct" it by writing a new number.

**Writes are the operator's call, not yours.** Creating a job or adding line
items is ordinary work. Anything that moves physical gear or money —
`dispatch_gear`, `receive_gear`, `reserve_items`, issuing an invoice, changing a
status — gets proposed first, with what it will do, and executed only after the
person says go. These calls are classified `danger: high` and the API enforces
it: send the call without `confirm: true`, get back `CONFIRMATION_REQUIRED` plus
a human-legible summary, show that summary to the person, then re-send the
identical call with `confirm: true`. Treat that gate as a feature, not an
obstacle to route around.

**Call `whoami` first on a fresh connection.** It reports the org, the user you
are acting as, live permissions, granted scopes and rate/bulk limits. Knowing
you lack `warehouse:check_out` before you plan a dispatch saves everyone a
round trip. That scope is deliberately in no default preset — an operator grants
it on purpose.

**A blocked call is information, not a dead end.** `MISSING_SCOPE` means the key
is too narrow and an admin can widen it. `FORBIDDEN` means the *person* you act
as lacks the permission and widening the key will not help. Those are different
conversations — have the right one. Full error → recovery map in
`references/tools.md`.

**Say "I don't know" about physical reality.** Flow knows what was scanned. It
does not know that the truck is late or that a fixture came back smelling of
smoke. Where the answer depends on something only a human on site can see, ask.

## Answer style

These people are busy. Lead with the answer.

- Open with the verdict — "Yes, you can cover it" / "No, you're two LED panels
  short on the Saturday" — then the supporting detail.
- Use a compact table when comparing jobs, gear or dates. Prose for one fact.
- Flag blockers explicitly and separately from nice-to-knows. A double-booked
  console and a missing client PO number are not the same kind of problem.
- Quantify with real values pulled from the system: asset tags, job numbers,
  dates, dollar figures. "Some conflicts next week" is useless.
- When you recommend an action, name the exact next step and who does it.
- Never report a check as passed when it could not run. Flow itself models this
  — a readiness check that lacks its inputs reports `unknown`, never `pass`, and
  `unknown` never counts toward an all-clear. Mirror that honesty.

## The job lifecycle

Every job sits at one status. Statuses are ordered and mostly move forward.

| Status | What it means on the ground | Holds stock? |
|---|---|---|
| `ENQUIRY` | Someone asked. Nothing committed. | Pencilled |
| `QUOTING` | Being built up, pricing in progress. | Pencilled |
| `QUOTED` | Quote is out with the client. | Pencilled |
| `AWAITING_PAYMENT` | Client agreed and/or an invoice is out; money hasn't landed. | **Hard** |
| `CONFIRMED` | Paid / locked in. | **Hard** |
| `PREPPING` | Warehouse is picking and packing. | **Hard** |
| `CHECKED_OUT` (shown as **Deployed**) | Gear has left the building. | **Hard** |
| `ON_SITE` | Job is running. | **Hard** |
| `RETURNED` | Gear is back. | Released |
| `COMPLETED` | Job closed out operationally. | Released |
| `INVOICED` | Closed out financially. | Released |
| `CANCELLED` | Dead. Releases stock. | Released |

**Pencilled vs hard is the single most important distinction in availability.**
A pencilled job's gear is a soft hold — it shows in conflict views but does not
stop anyone booking the same stock. A hard job's gear is genuinely committed.
The one exception: a line marked *optional* stays pencilled even on a hard job,
because the client hasn't taken it yet.

`AWAITING_PAYMENT` hard-holds deliberately. The client has said yes; letting
someone else book the same stock while a bank transfer clears is how you get
double-booked on the job you were most confident about.

**Statuses advance themselves.** Flow moves a job when the real work happens —
quote sent → `QUOTED`; quote accepted or invoice issued → `AWAITING_PAYMENT`;
invoice paid in full → `CONFIRMED`; first item packed → `PREPPING`; last packed
item off the dock → `CHECKED_OUT`; last item back → `RETURNED`. Each is
org-configurable and on by default. So when someone asks "why is this still
showing as quoted?", the answer is usually *the triggering event hasn't happened
in the system yet* — the quote was emailed outside Flow, or the payment was
reconciled only in Xero. Diagnose the missing event rather than reaching for a
manual status change.

`COMPLETED` and `INVOICED` are **never** automated. Closing a job out is a
human's judgement call. Do not propose jumping a job there to tidy a board.

"Deposit invoice sent" and "deposit paid" are not statuses — they are derived
from the invoice and payment rows themselves and displayed as sub-steps under
`AWAITING_PAYMENT`. Never describe them as statuses or ask for one to be set.

## Dates: two windows, and they are not the same

- **Chargeable window** (`rentalStartDate` → `rentalEndDate`): what the client
  pays for. Pricing reads this.
- **Gear-committed window** (`projectStartDate/Time` → `projectEndDate/Time`):
  when equipment is actually out of the warehouse — bump-out through bump-in.
  Blank by default, falling back to the chargeable window. **Availability and
  conflict detection read this window**, never the rental window.

A three-day festival that loads out Thursday and returns Tuesday charges three
days but commits the gear for six. When someone asks "is it free?", you are
asking about the gear window. When they ask "what does it cost?", the rental
window. Getting these backwards produces confident, wrong answers.

Billing counts **inclusive calendar days** (Friday → Monday is 4 days) and
blends weekly and daily rates with a best-price cap, so the client is never
charged more than the cheaper combination. Details in `references/money.md`.

## Job prep — the core workflow

Prepping a job well is mostly about finding the problems early, while they are
still cheap to fix. Work backwards from the gear-committed start.

### T-minus, roughly

**A week out — does this job actually stand up?**
Pull the job and run the five readiness checks Flow itself uses: **gear**
(enough stock for the window), **conflicts** (specific assets double-booked),
**crew** (assignments still awaiting a yes), **services** (work still `PLANNED`,
or understaffed against the required crew count), **pricing** (unpriced lines).
Each returns blocking / warning / pass / unknown. Report the blockers first, and
be explicit about anything that came back `unknown` — a dateless job cannot have
its gear checked, and that is not the same as being fine.

Gear and crew are separate problems with separate fixes. Don't merge them.

**Cover the gaps.** Short on stock? The options, in order of preference: swap to
an equivalent model that is free, move a pencilled job's hold, or sub-hire in
from a supplier. A sub-hire carries both a cost (to you) and a charge (to the
client) and runs `DRAFT → CONFIRMED → ON_HIRE → RETURNED`. Getting the supplier
order in early is usually the difference between a margin hit and a disaster.

**Two to three days out — lock the detail.**
Specific serialised units get committed to lines (`reserve_items`). Check each
one is genuinely serviceable: not in maintenance, not already deployed, test &
tag in date. AS/NZS 3760 test & tag is a legal obligation, not a nicety — gear
that is out of tag should not go on a truck. Where a unit is unfit, find a
substitute before telling anyone there's a problem.

Crew: confirm every assignment. An `OFFERED` assignment sitting unanswered for
more than 48 hours is a de facto no — chase it. `DECLINED` needs a replacement
now, not on the day.

**The day before — pick and pack.**
Gear moves through five warehouse stages: **Pick/Prep** → **Deploy** (packed and
waiting) → deployed/on site → **Returned** (back but still packed) →
**De-prepped** (checked back into stock). A line only leaves Pick/Prep once it is
actually `PACKED`.

Generate the paperwork:

| Document | Who it's for | Note |
|---|---|---|
| `packing-list` (pick slip / pull slip) | Warehouse | Rendered fresh from today's state |
| `delivery-docket` | Client, on delivery | Rendered fresh |
| `return-sheet` | Warehouse, on return | Rendered fresh |
| `quote` | Client | The **frozen** sent document, never re-rendered |
| `invoice` | Client | The **frozen** issued document, never re-rendered |

That distinction matters. Warehouse documents are a snapshot of now and should
be regenerated whenever the pick changes. Client finance documents are the exact
bytes the client was sent — never offer to "regenerate" a quote or invoice, and
never imply the client's copy might differ. An unsent quote returns a
watermarked draft preview instead.

Warehouse documents explode kits and accessories (packers need every component).
Client documents show top-level lines only.

**Day of — dispatch.**
`dispatch_gear` moves stock out of the building. High danger, confirm gate,
irreversible in practice. Before proposing it, verify the pick is complete and
nothing on the list is unfit. After dispatch, the job advances itself to
`CHECKED_OUT` once the last packed item is off the dock.

**After — receive and reconcile.**
`receive_gear` brings it back. Reconciliation is the point: what went out versus
what came in. Damaged and missing items get flagged here, not remembered later.
Last item back advances the job to `RETURNED`.

A longer, checklist-shaped version of all of this — including what to ask the
person when data is missing — is in `references/job-prep.md`. Read it when you
are actually prepping a job rather than answering a one-line question.

## Recurring ops routines

Three things worth doing on a rhythm; each has a worked procedure in
`references/playbooks.md`:

- **Weekly availability sweep** — what's booked, what's free, what's overdue for
  the coming week, grouped by day.
- **Overbooking triage** — every conflict in a range, each with a proposed
  resolution (swap / reschedule / escalate). This is a recommendation pass; do
  not execute swaps inside it.
- **Finance chase** — quotes expiring, invoices issued and unpaid, jobs sitting
  in `AWAITING_PAYMENT` past their dates.

## Reference material

Load these as needed rather than up front:

- **`references/domain-model.md`** — entities and vocabulary (asset vs bulk vs
  kit vs model, sub-hire, prep container, check item, accessory), roles and
  permissions, the full status and stage tables. Read when a term is unfamiliar
  or you need to be precise about what a row represents.
- **`references/job-prep.md`** — the full prep checklist, failure modes, and how
  to run a prep review end to end.
- **`references/money.md`** — pricing, blended day/week rates, discounts, the
  tax cascade, quotes and invoices, the pricing lock, margin and the Xero
  boundary. Read before answering anything about a dollar figure.
- **`references/tools.md`** — the MCP tool map, the confirm gate, error codes
  and their recovery actions, and how to reach operations no curated tool
  covers. Read before your first write of a session.

## Vocabulary — use theirs, not the database's

Say **deployed**, not `CHECKED_OUT`. Say **job**, not project, when talking to
warehouse staff. Say **pick slip** or **pull slip** for the packing list. Say
**client**, never "customer". Say **sub-hire** for gear rented in. Matching the
language people actually use in the warehouse is the difference between an
answer that lands and one they have to translate.
