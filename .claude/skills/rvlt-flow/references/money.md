# Money — pricing, tax, quotes, invoices, margin

Read this before answering anything with a dollar figure in it. The arithmetic
has specific rules, and several of them are counter-intuitive in ways that
produce confidently wrong answers.

## The governing principle

**Every monetary figure is computed by the server from line items.** No amount
originates from a client, a form, or your own arithmetic. When you need a
number, fetch it. When a number looks wrong, report what you fetched and what
you expected — do not write a corrected figure.

## Rental pricing

### Chargeable days

Billing counts **inclusive calendar days**: Friday to Monday is 4 days, not 3.
A job with no dates counts as 1 day.

This is the **chargeable window** (`rentalStartDate` → `rentalEndDate`), which
is usually shorter than the gear-committed window. The client pays for the hire
period; the warehouse loses the gear for longer.

### Blended day/week rates with a best-price cap

A model carries a daily rate and (optionally) a weekly rate. The charge is
computed by splitting the total days into whole weeks plus remainder days,
pricing each at its own rate — then **capping at the cheaper of the blended
figure and the alternatives**, so a client is never charged more than the best
combination available to them.

Practical consequence: a 9-day hire may cost less than you would get by
multiplying the daily rate by 9, and the jump from 6 days to 7 is often not a
seventh of a week. If someone questions a total, walk the breakdown (weeks,
days, which rates applied) rather than recomputing from the day rate.

With no weekly rate configured, it is simply daily × days.

### Discounts — the amount is stored, the percentage is not

A line or group discount is always stored as a **resolved flat dollar amount**.
Every downstream calculation — line total, allocation, invoicing — reads that
dollar figure and nothing else.

A separate field records only *how the operator typed it* (`$` or `%`), so a
document can print "−15%" instead of "−$150.00". The percentage itself is never
stored; it is recomputed from the dollar amount against the row's own gross at
render time.

Why this matters to you: if a unit price changes after a percentage discount was
entered, **the dollar discount does not move**. The printed percentage will
recompute against the new gross. That is deliberate — the alternative lets a
document contradict itself — but it means "I gave them 15% off" and "the
discount line says 15%" can drift apart after a reprice. If a client queries a
discount after a price change, check the stored amount, not the printed percent.

## Tax

Resolution is a cascade, most specific wins:

```
client.taxExempt  →  hard zero for the whole job, short-circuits everything
    else:  line.taxRate  ??  project.taxRate  ??  org.defaultTaxRate  ??  0
```

The resulting tax status is a tri-state:

- **`EXEMPT`** — the client's exemption flag fired. Carries a reason (e.g. a
  government purchase order number). Nothing else is consulted.
- **`UNSET`** — no rate is configured anywhere in the cascade. Tax is zero, but
  this is "nobody has set this up", not "deliberately zero-rated". Worth
  flagging if you see it on a real job.
- **`COMPUTED`** — a real resolved rate, including a deliberate explicit 0%.

Groups and services have no rate of their own and fall through to the project or
org rate. `SALE` lines get the per-line rate like equipment lines.

There is no hardcoded GST fallback. If nobody has configured a rate, tax is zero
and the status says `UNSET` — do not assume 10%.

## Quotes

A **quote revision** freezes the project's server-computed pricing into an
immutable row at the moment it is sent. Quotes are versioned: v2 is a new
revision, not an edit of v1.

**Quote status is partly derived.** `EXPIRED` is computed on read from the
valid-until date against now, and is never stored. A quote whose stored status
reads `SENT` but whose validity has lapsed is expired. Always reason about the
*effective* status — treating a lapsed quote as live is the classic mistake
here, and it leads to telling a client a price that no longer stands.

A sent quote's dates are stamped at send time and never recomputed. Re-opening a
quote does not extend how long it is valid.

**Sending a quote raises the pricing lock** and advances the job to `QUOTED`.

## Invoices

Kinds: `FULL`, `DEPOSIT`, `BALANCE`, `CREDIT`.

Created as `DRAFT` and **unnumbered** — the invoice number is assigned only at
issue, which is the one numbering moment. Once `ISSUED`, an invoice is
immutable. A correction is a **void and reissue**, or a `CREDIT` invoice. There
is no editing an issued invoice, and you should never propose one.

**Payment status is derived** (`UNPAID` / `PARTIALLY_PAID` / `PAID`) from the
invoice's own non-voided payment rows. A payment recorded in error is **voided,
never deleted**, so the audit trail keeps the record; voiding recomputes the
parent invoice in the same breath.

Issuing an invoice advances the job to `AWAITING_PAYMENT`. A payment that
settles an invoice **in full** advances it to `CONFIRMED` — in this business
payment *is* the confirmation.

## The pricing lock

A job's live version can be **pricing-locked**, which rejects edits to money
fields: project tax rate and discount percent; line unit price, discount,
duration and tax rate; group price, discount and rental period; service cost and
billable flags; crew rate overrides and estimated hours.

The lock is raised when a quote goes out on the live version, and defensively on
first reaching `AWAITING_PAYMENT` or `CONFIRMED` — including for jobs that
skipped quoting and went straight to an invoice. A revert never clears it.

Structure is never locked. Adding, removing and rearranging lines stays open;
only *money* on the live version is gated. A non-live saved version is fully
writable.

Clearing the lock is a deliberate act available to an admin, owner, manager or
the job's own PM. Via the API it is `danger: high` and needs `confirm: true`.
If you hit `PRICING_LOCKED`, do not look for a workaround — surface it, name who
can clear it, and let them decide whether repricing an agreed job is the right
move.

## Client-facing documents are stored bytes

A sent quote PDF and an issued invoice PDF are rendered **once** and the bytes
attached to the row. Downloads stream those exact bytes. There is deliberately
no regeneration path anywhere, because a route that can regenerate is a route
that can hand a client a different document under the same name.

A recalled, superseded or voided document keeps its file — the client may still
be holding that copy.

Never tell someone you can regenerate a quote or invoice, and never imply the
client's copy might differ from what the system shows.

## Margin and cost

A job's cost side comes from several places:

- **Sub-hires** — cost to you versus charge to the client, per item or per
  order. The most common source of margin surprise.
- **Crew** — a crew-attached service's cost derives from the crew rate table;
  a crew-less service's cost is typed. Rate overrides per assignment.
- **Sale lines** — unit cost resolves down a chain: the asset's purchase price,
  then the model's default purchase price, then the bulk per-unit price, then
  replacement cost. The first *positive* value wins — a null or zero is skipped,
  never treated as a real $0 cost.

Financial visibility follows the person's role. An API key can additionally be
created with a **no-financials** flag that redacts cost and margin regardless of
role — the model's own sell rates stay visible, because an agent needs them to
quote. A read whose entire payload is financial returns an all-zero shape rather
than a partial redaction. If figures come back as zeros across the board,
suspect the flag before you suspect the data.

## The Xero boundary

**Flow owns quote and invoice generation. Xero owns the ledger, payment
collection and reconciliation.**

Flow pushes issued invoices to Xero as drafts, with account codes and tax types
resolved and frozen per line at push time — so editing a model or category
mapping later never retroactively changes an issued invoice's coding.

Flow does **not**: take payments, run GST/BAS reporting, or email documents to
clients. If someone asks for any of those, say where they actually live rather
than improvising.

This creates one recurring diagnostic: a client pays, the payment is reconciled
in Xero, and no payment row is ever written in Flow — so the job never advances
past `AWAITING_PAYMENT` on payment. It will still move forward when physical
work starts (both warehouse triggers accept `AWAITING_PAYMENT` as a starting
point, precisely so the money phase is not a one-way door for orgs that
reconcile in Xero). When a job looks stuck in the money phase, check whether the
org records payments in Flow at all before concluding something is broken.
