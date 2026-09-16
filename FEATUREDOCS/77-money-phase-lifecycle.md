# The Money Phase — `AWAITING_PAYMENT` (#1236)

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-15 (review quarterly — POLICY.md R-5.5)_

## What this is

The lifecycle used to jump straight from **Quoted** to **Confirmed**, which
skipped the part of the job where most of the waiting actually happens:

```
client reaches out → we quote → we wait for approval
    → deposit invoice or full invoice → once paid, job confirmed
    → prep → on site → return → invoice the remainder
```

`AWAITING_PAYMENT` is that missing phase: **the client has agreed and/or an
invoice is out, but the money hasn't landed and the job isn't ours to prep yet.**

| | Before | After |
|---|---|---|
| Stepper | Enquiry · Quote · Confirmed · Prep · On site · Return · Completed | Enquiry · Quote · **Awaiting payment** · Confirmed · Prep · On site · Return · Completed |
| Accepting a quote | *offered* CONFIRMED | advances to **AWAITING_PAYMENT** |
| Recording a payment | nothing | advances to **CONFIRMED** when the invoice settles in full |
| Board | no column for "waiting on money" | its own column, `warn` hue |

## ONE status, THREE derived sub-steps

The obvious design is three statuses — *accepted*, *deposit invoice sent*,
*deposit paid*. **That would be a defect.** Every one of those facts already
lives on a row that owns it:

| Sub-step | Where the truth lives |
|---|---|
| Accepted | `quotes.status === "ACCEPTED"`, read through `effectiveQuoteStatus` |
| Invoice sent | an `invoices` row at `status: "ISSUED"` |
| Paid | `invoices.paymentStatus`, itself derived from `payments` by `paymentsWrites` |

Copying any of them onto `projects.status` creates a second source of truth for
whether the client's money has landed, and the two WILL disagree — a voided
payment, a credit note, a reissued invoice. Same reasoning as the discount
percentage and the category rollup subtotal (CLAUDE.md, R-3.1).

So there is **one status**, and `src/lib/project-payment-progress.ts` computes
the three sub-steps on read. `<PaymentProgressStrip>` renders them directly
under the lifecycle stepper — and **only** while the project is at
`AWAITING_PAYMENT`. On any other status it is premature or history, and the
Finance tab already owns the full ledger. It answers one question — "what are
we waiting for?" — and disappears once it has been answered.

```
Enquiry ─── Quote ─── ● Awaiting payment ─── Confirmed ─── Prep ─── …
                      │
   ✓ Quote accepted  v2 · 21 Jul     ✓ Invoice sent  INV-0042 · $1,650
   ⟳ Paid  $1,650 outstanding
```

Exactly one step is ever `current` — the first that hasn't happened. A job
invoiced with no acceptance step shows `accepted` as still current and
`invoiced` as done, which is honest about what was skipped rather than
pretending the sequence was followed.

## The three automation rules

Added to the #1160 rule table (`convex/lib/projectAutoStatus.ts`), so they
inherit forward-only-from-an-explicit-set, the org opt-out, and the audited
`STATUS_CHANGE` row:

| Trigger | Fires in | From | To |
|---|---|---|---|
| `QUOTE_ACCEPTED` | `quotesWrites.markAcceptedNative` | `ENQUIRY`/`QUOTING`/`QUOTED` | `AWAITING_PAYMENT` |
| `INVOICE_ISSUED` | `invoicesWrites.issueNative` | `ENQUIRY`/`QUOTING`/`QUOTED` | `AWAITING_PAYMENT` |
| `PAYMENT_SETTLED` | `paymentsWrites.recordNative` | `AWAITING_PAYMENT` | `CONFIRMED` |

`PREP_STARTED` and `ALL_CHECKED_OUT` also take `AWAITING_PAYMENT` as a `from` —
physical work is the second way out of the money phase, for orgs that never
record a payment in Flow. See FEATUREDOCS/76.

**Two doors, one room.** Accepting and invoicing both open the money phase,
because some jobs go straight to a full invoice with no accept step. Whichever
happens first moves the job; the second is then a no-op, because the `from` set
no longer matches. A balance invoice raised later on an `ON_SITE` job likewise
moves nothing.

**Only a FULL settlement confirms.** `recordNative` fires `PAYMENT_SETTLED`
only when the recomputed `paymentStatus` is `PAID`. A partial payment leaves the
job exactly where it was.

**A CREDIT note never confirms, and never invoices.** `createCreditNative`
stores a credit's `total` as `-original.total`, so *any* positive amount recorded
against one satisfies `amountPaid >= total` and reads as `PAID`. Both
`recordNative` and `issueNative` skip the automation for `kind === "CREDIT"`:
money moving on a credit is a refund going out, the opposite of the client paying.
The same negative total is why `computePaymentProgress` excludes credits from the
"Invoice sent" step and from `allSettled`, while still folding their value into
`invoicedTotal` as the reduction it is.

**Voiding the settling payment undoes the confirm.** `paymentsWrites.voidNative`
calls `revertAutoAdvanceByTrigger`, which reverses the move only when it is still
the project's most recent status change — a later manual decision is never stamped
over — and only when no other non-CREDIT invoice on the project is still `PAID`.
Without it a mis-keyed payment confirmed a job permanently: the void unwound the
money, but `PAYMENT_SETTLED`'s `from` set no longer matched, so re-recording the
payment correctly was a no-op.

### Why CONFIRMED is now automatable, and what that cost

FEATUREDOCS/76 rule 2 said the automation may never advance *into* CONFIRMED,
because that transition snapshots the project and gates on an accepted quote.
This is the one deliberate relaxation: **in this business, payment IS the
confirmation.** Refusing to automate it would leave the app's most meaningful
status permanently behind the facts.

It is safe because `maybeAutoAdvanceProjectStatus` now reproduces both
ceremonies rather than skipping them:

1. **The accepted-quote gate** (#986 decision 3) is re-checked in
   `conditionMet`. No accepted revision ⇒ **no auto-advance**. The manual path
   can override that with a justification from a narrow audience; this path has
   nobody to collect one from, so it **fails closed** and leaves the job at
   `AWAITING_PAYMENT` for a human.
2. **The whole-project snapshot** — `crossesIntoSnapshotStatus` is checked in
   the shared module exactly as it is in `updateStatusNative`, so an automatic
   confirm is as recoverable as a manual one. This also means the pre-#1236
   `ALL_RETURNED`/`PREP_STARTED` rules now snapshot correctly if a future rule
   ever crosses one of those boundaries.

What it does **not** reproduce is the overbooking-impact dialog — a client-side
advisory that never blocked a confirm anyway ("This is a heads-up, not a block").

`convex/projectAutoStatus.test.ts` pins `PAYMENT_SETTLED` as the *only* rule
that may reach CONFIRMED, so a second one can't inherit the exception by
accident.

## Where the new status sits in the existing sets

Adding a status means answering "does it belong?" for every set that partitions
the lifecycle. These are the decisions, not accidents:

| Set | In? | Why |
|---|---|---|
| `HARD_PROJECT_STATUSES` (availability, both copies) | **Yes** | The gear is held. Letting someone else book the same stock while a bank transfer clears is how you double-book the one job you were most sure of. |
| `projects.pricingLocked` | **Not status-driven** | See below — superseded by the #1230 merge. |
| `STATUS_ORDER` (`projectLocks.ts`) | Yes, between `QUOTED` and `CONFIRMED` | Forward-move and revert detection. |
| `UPCOMING_STATUSES` (dashboard) | Yes | An agreed job is absolutely upcoming. |
| `activeStatuses` (`src/server/projects.ts`) | Yes | That list means "not dead" — it starts at `ENQUIRY`. |
| `NEVER_COUNTED_STATUSES` (ROI) | **Yes** | Pipeline, not revenue. The org's own model says the job isn't on until the money lands, so counting it as booked earnings would inflate the fleet's numbers with jobs that may never pay. It joins `BOOKED_STATUSES` the moment payment confirms it. |
| `ACTIVE_PROJECT_STATUSES` (dashboard counters, sharded counters) | **Yes** | The job is agreed and its gear is held. No backfill is needed: no row has ever sat at this status, so every project reaching it does so through a patch that bumps the counters with both the old and the new status. |
| `WAREHOUSE_STATUSES` (both copies) + `warehouse-display`'s active/prepping sets | **Yes** | The gear is held from the moment the job is agreed, so it has to be pickable. Leaving it out stranded every org that reconciles payments in Xero: the job entered the money phase and vanished from the only screen that could move it on. |
| Upcoming-project notifications (`notifications.ts`, `notification-email-sender.ts`) | **Yes** | A job starting in 72 hours needs its warning whether or not the money has landed. |
| `CONFIRMED_OR_LATER_STATUSES` (`financeOrg`) | No | It means literally at-or-after CONFIRMED. |

### Why the lock is not status-driven (superseded by #1230's merge)

**This section originally described the OLD 4-tier `LockTier` system**
(`ENQUIRY`/`QUOTING`/`QUOTED`/`AWAITING_PAYMENT` → `OPEN`, `CONFIRMED`+ →
`FINANCE_LOCKED`, etc.), which "Project versioning v2" Phase 4 (#1230) deletes
outright — see FEATUREDOCS/78's Phase 4 section. It is kept here, corrected,
because the REASONING still matters even though the mechanism it reasoned
about is gone.

The instinct is the same one that motivated this section originally: a job
whose client has agreed surely shouldn't be repriced. Under the surviving
model that instinct is expressed by ONE field, `projects.pricingLocked`
(`convex/lib/projectLocks.ts`), which is **not** derived from status at all —
it's an explicit boolean raised by specific events:

- `quotesWrites.sendNative` raises it the moment a **live-version** quote goes
  out (D55) — this is the direct successor to the old quote-sent escalation.
- A manual `CONFIRMED` status transition (`updateStatusNative`) also raises it.
- **`maybeAutoAdvanceProjectStatus`** (`convex/lib/projectAutoStatus.ts`)
  additionally raises it, defensively, the moment a job FIRST reaches
  `AWAITING_PAYMENT` or `CONFIRMED` by *any* trigger — closing the exact gap
  this section used to describe as deliberately out of scope (see below):
  an invoice-first job with no quote ever sent, and accepting a NON-live
  quote whose version was never locked at send time, both now lock pricing
  the moment they land the job at `AWAITING_PAYMENT`.

`newVersionNative` ("cutting a new version is the unlock", #985 decision 2)
stays reachable regardless of any of this, because Phase 4 never gates it on
`pricingLocked` in the first place — cutting a version doesn't touch a single
`LOCKED_*_FIELDS` field, so there is nothing for the flag to block. The
deadlock the old tier system had to design around (a status-locked
`AWAITING_PAYMENT` making re-quoting unreachable without an unlock session)
cannot recur: there is no unlock-session mechanism left to need, and the flag
only ever gates a direct money-field edit against the LIVE version, never a
new version being cut.

Note the deliberate divergence that remains between the two same-named
`isConfirmedOrLater` helpers: `availabilityCore.ts`'s (is the gig locked in for
**stock** purposes?) answers **true** for `AWAITING_PAYMENT`, and
`projectLocks.ts`'s (a pure pipeline-position helper, unrelated to pricing
locking post-Phase-4) answers **false**. They ask different questions and have
always been separate functions; #1236 is the first status where their answers
differ.

## Migration

`ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT' BEFORE 'CONFIRMED'`
(`20260915120000_project_status_awaiting_payment`).

The Postgres type is an **orphan**: no Prisma model has referenced it since the
Phase 3 native decommission moved `Project` to Convex. It is kept only so
`src/generated/prisma/enums.ts` keeps exporting the TS union that
`src/server/projects.ts` types its active-status list against. The migration is
safe inside Prisma's transaction (PG 12+) because the new value is added but
never *used* in the same transaction.

### The manual route in

`AWAITING_PAYMENT` is a first-class option everywhere a project status is
picked — the detail page's `allStatuses`, the project table's `filterOptions`,
the wizard's `STATUS_OPTIONS`, the board column, and the warehouse landing's
`statusLabels`. Automation is a convenience, never the only way in or out: a
status the automation can reach but a human cannot set by hand is a trap.

**No data backfill.** No existing row can be `AWAITING_PAYMENT`, and no existing
project needs to become one — jobs already past the money phase are already
CONFIRMED or later, and jobs before it are still at QUOTED. The phase fills
itself as new work flows through.

## Deliberately out of scope

- ~~**An `INVOICE_ISSUED` lock-tier input.**~~ **Closed by the #1230 merge**
  (see above) — `maybeAutoAdvanceProjectStatus` now raises `pricingLocked`
  defensively the moment `INVOICE_ISSUED` (or `QUOTE_ACCEPTED`) first lands a
  job at `AWAITING_PAYMENT`, so an invoice issued on a job with no quote
  behind it no longer leaves pricing open. This did not need its own
  sanctioned exit (void and reissue) the way the old tier system would have —
  `unlockPricingNative` (D42) already is one, generically, for any locked
  project regardless of how it got locked.
- **Splitting into `ACCEPTED` + `AWAITING_PAYMENT`.** Considered and rejected:
  the second is fully derivable from the invoice row, and two statuses is a
  second pass through ~30 files to buy a board distinction the strip already
  makes.
- **An "unpaid job starts in 3 days" notification.** Genuinely useful, and the
  `upcoming_project` notification (CONFIRMED/PREPPING within 3 days) is the
  natural home. Out of scope here so the lifecycle change stays one change.
- **Auto-advancing to `INVOICED`.** Closing a job out stays a human's call —
  FEATUREDOCS/76 rule 2 is otherwise unchanged.

## Related

- [76 — Project Status Automation](./76-project-status-automation.md) — the rule
  table these three triggers join.
- [66 — Finance, Quotes & Invoices](./66-finance-quotes-invoices-xero.md) — the
  quote, invoice and payment rows every sub-step is derived from.
- [62 — Project Lifecycle Locks](./62-project-lifecycle-locks.md) — the tier
  model, and why this status sits at `OPEN`.
