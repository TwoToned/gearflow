# The Money Phase — `AWAITING_PAYMENT` (#1228)

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

**Two doors, one room.** Accepting and invoicing both open the money phase,
because some jobs go straight to a full invoice with no accept step. Whichever
happens first moves the job; the second is then a no-op, because the `from` set
no longer matches. A balance invoice raised later on an `ON_SITE` job likewise
moves nothing.

**Only a FULL settlement confirms.** `recordNative` fires `PAYMENT_SETTLED`
only when the recomputed `paymentStatus` is `PAID`. A partial payment leaves the
job exactly where it was.

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
   confirm is as recoverable as a manual one. This also means the pre-#1228
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
| `lockTierForStatus` | **No — stays `OPEN`** | See below. |
| `STATUS_ORDER` (`projectLocks.ts`) | Yes, between `QUOTED` and `CONFIRMED` | Forward-move and revert detection. |
| `UPCOMING_STATUSES` (dashboard) | Yes | An agreed job is absolutely upcoming. |
| `activeStatuses` (`src/server/projects.ts`) | Yes | That list means "not dead" — it starts at `ENQUIRY`. |
| `NEVER_COUNTED_STATUSES` (ROI) | **Yes** | Pipeline, not revenue. The org's own model says the job isn't on until the money lands, so counting it as booked earnings would inflate the fleet's numbers with jobs that may never pay. It joins `BOOKED_STATUSES` the moment payment confirms it. |
| `ACTIVE_PROJECT_STATUSES` (dashboard counters, sharded counters) | No | "Active" there means work in flight, which starts at CONFIRMED. |
| `WAREHOUSE_STATUSES` | No | Nothing to prep until it's confirmed. |
| `CONFIRMED_OR_LATER_STATUSES` (`financeOrg`) | No | It means literally at-or-after CONFIRMED. |

### Why the lock tier stays OPEN

The instinct is the opposite: a job whose client has agreed surely shouldn't be
repriced. **The lock that expresses that is already there** — #988's
`quoteState` input escalates any project holding a `SENT` or `ACCEPTED` revision
to `FINANCE_LOCKED` regardless of status.

Giving `AWAITING_PAYMENT` its own status-driven `FINANCE_LOCKED` tier *on top*
of that breaks #985 decision 2 — *"cutting a new version is the unlock"* —
because `newVersionNative`'s `bypassQuoteLock` resolves the tier from **status
alone**. A status-locked `AWAITING_PAYMENT` makes the sanctioned exit
unreachable: a client asking for a change after approving could no longer be
re-quoted without an unlock session.

This is not hypothetical. It is exactly what `quotesWrites.test.ts`'s
"supersedes an ACCEPTED revision" case caught when the tier was first set to
`FINANCE_LOCKED` during this change.

Note the deliberate divergence this creates between the two same-named
`isConfirmedOrLater` helpers: `availabilityCore.ts`'s (is the gig locked in for
**stock** purposes?) answers **true** for `AWAITING_PAYMENT`, and
`projectLocks.ts`'s (is the **money** locked by status?) answers **false**. They
ask different questions and have always been separate functions; #1228 is the
first status where their answers differ.

## Migration

`ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT' BEFORE 'CONFIRMED'`
(`20260915120000_project_status_awaiting_payment`).

The Postgres type is an **orphan**: no Prisma model has referenced it since the
Phase 3 native decommission moved `Project` to Convex. It is kept only so
`src/generated/prisma/enums.ts` keeps exporting the TS union that
`src/server/projects.ts` types its active-status list against. The migration is
safe inside Prisma's transaction (PG 12+) because the new value is added but
never *used* in the same transaction.

**No data backfill.** No existing row can be `AWAITING_PAYMENT`, and no existing
project needs to become one — jobs already past the money phase are already
CONFIRMED or later, and jobs before it are still at QUOTED. The phase fills
itself as new work flows through.

## Deliberately out of scope

- **An `INVOICE_ISSUED` lock-tier input.** An invoice issued on a job with no
  quote behind it still locks nothing. That gap is **pre-existing** — an ISSUED
  invoice has never been an input to `resolveLockTier` — and closing it needs
  its own sanctioned exit (void and reissue) to avoid the exact deadlock
  described above. It belongs in `resolveLockTier` as a third input, not
  smuggled in as a status tier.
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
