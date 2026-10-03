# Job prep — the full playbook

Use this when you are actually preparing a job, reviewing someone else's prep,
or answering "is this job ready?". For a one-line availability question you do
not need this file.

The goal of prep is to surface problems while they are still cheap. A missing
fixture found on Tuesday is a phone call. The same fixture found at 6am on the
dock is a sub-hire at whatever price you can get, or a job that goes out short.

## The shape of a prep review

Work backwards from the **gear-committed start** (`projectStartDate`), not the
rental start and not the event date. That is the moment the truck needs loading.

### Step 0 — establish the ground truth

Pull the job. You need, at minimum:

- Both date windows, and whether the gear window is set or falling back.
- Status, and therefore whether its stock holds are pencilled or hard.
- Client, venue, site contact.
- The full line-item list including groups, kits, accessories, sub-hires and
  non-equipment lines.
- Whether pricing is locked.

If the gear window is blank, say so. It means availability is being computed
against the chargeable window, which understates the commitment for any job with
a bump-in the day before.

### Step 1 — the five readiness checks

These are the checks Flow's own readiness checklist runs. Each returns
**blocking**, **warning**, **pass** or **unknown**.

| Check | Fails when | Typical fix |
|---|---|---|
| **Gear** | Not enough effective stock for the window | Swap model, move a pencilled hold, sub-hire |
| **Conflicts** | Specific assets double-booked | Swap to a free unit, or reschedule |
| **Crew** | Assignments still awaiting a yes | Chase, or reassign |
| **Services** | Work still `PLANNED`, or staffed below required count | Confirm the service, assign more crew |
| **Pricing** | Lines with no price | Price them, or confirm they are deliberately $0 |

**`unknown` is not a pass.** A job with no dates cannot have its gear checked —
report "not checked" and why, never an all-clear. An `unknown` never counts
toward "everything's fine".

Report blocking items first, warnings second, and keep the two visually
separate. A double-booked console and an unpriced $0 freight line are not
comparable problems.

### Step 2 — cover the gaps

When gear is short, the options in order of preference:

1. **Swap to an equivalent model that is free.** Cheapest fix, no money moves.
   Check the substitute is genuinely equivalent for the application — an SM58
   and an SM57 are not interchangeable on a vocal.
2. **Release a pencilled hold.** A job at `ENQUIRY`/`QUOTING`/`QUOTED` is only
   softly holding stock. Taking it is a commercial decision — surface it to a
   human with both jobs named, never decide it yourself.
3. **Sub-hire in.** Works, costs money. Flag the margin impact: a sub-hire has a
   cost to you and a charge to the client, and those are different numbers.
   Get the supplier order in early — `DRAFT → CONFIRMED` needs the job attached.

Never propose "just send it short" as an option. If the job genuinely cannot be
covered, say that plainly and let a human decide what the client is told.

### Step 3 — commit specific units

Two or three days out, model-and-quantity bookings become named serial
reservations (`reserve_items`). For each serialised unit, verify:

- **Status is `AVAILABLE`.** Not `IN_MAINTENANCE`, not already `CHECKED_OUT` on
  another job, not `RESERVED` elsewhere.
- **Test & tag is in date** for the whole gear window, not just today. A tag
  expiring mid-job is a problem you find now or on site.
- **No scheduled maintenance** overlaps the window.
- **Condition** is fit for the client. A unit marked `POOR` going to a flagship
  corporate client is a conversation worth having.

Where a unit fails, find a substitute *before* reporting the problem. "Console
AV-CON-003 is out of tag; AV-CON-007 is free and tagged to March" is an answer.
"One of the consoles has a problem" is not.

### Step 4 — crew

Every assignment should be `ACCEPTED` before the day. Specifically:

- `DECLINED` → needs a replacement now. Name who declined and what the role was.
- `OFFERED` for more than 48 hours → treat as a probable no. Chase it.
- Services below `crewCountRequired` → understaffed, regardless of what the
  assignments say.
- Services still `PLANNED` → the work itself hasn't been confirmed, which is a
  different problem from nobody having accepted it.

For a `WET_HIRE` job, crew is not a footnote — it is half the deliverable.

### Step 5 — pick, pack, paperwork

Gear moves Pick/Prep → Deploy → out. A line leaves Pick/Prep only once it is
actually `PACKED`. Prep containers ("Case 3", "Rack A") organise the pick — use
them in your reporting so the warehouse can find things.

Regenerate the warehouse documents once the pick is settled:

- **`packing-list`** (pick slip / pull slip) — what to pull, organised for the
  warehouse. Kits and accessories exploded.
- **`delivery-docket`** — client-facing confirmation of what was delivered.
- **`return-sheet`** — the checklist for processing the return, with condition
  columns.

All three render fresh from the job's state at the moment you ask, so a document
generated before a late change is stale. Regenerate rather than patching by
hand.

**Never offer to regenerate a quote or an invoice.** Those are stored bytes — the
exact document the client received. There is deliberately no regeneration path,
because a route that can regenerate is a route that can hand the client a
different document under the same name. An unsent quote returns a watermarked
DRAFT PREVIEW; an unissued invoice simply does not exist yet.

### Step 6 — dispatch

`dispatch_gear` is high danger and confirm-gated, and for good reason: it is the
moment the business commits. Before proposing it, confirm:

- Everything on the pick is `PACKED`.
- No unfit units (maintenance, out of tag) remain on the list.
- Sub-hired gear has physically arrived.
- Crew for the bump-out are confirmed.
- The delivery docket exists.

Then show the person what the dispatch will do and let them say go.

After the last packed item leaves, the job advances itself to `CHECKED_OUT`.

### Step 7 — return and reconcile

`receive_gear` brings it back. The value here is the reconciliation: what went
out versus what came back. Damage and shortfalls get recorded at the moment
someone can still see them — via check items on the return, not as a note to
chase later.

Last outstanding item back advances the job to `RETURNED`. From there,
`COMPLETED` and `INVOICED` are human decisions; never propose automating them.

## Failure modes worth knowing

**Reading the wrong date window.** Availability uses the gear-committed window;
pricing uses the chargeable window. Mixing them produces confident wrong
answers in both directions.

**Trusting total stock.** Always effective stock. A model with ten units, three
in maintenance, has seven — and the difference is exactly the units you would
have promised and then not been able to send.

**Treating a status as the source of truth for physical reality.** A job showing
`CONFIRMED` may already have half its gear picked. Check the line-level stage,
not just the job status.

**Assuming an unmoved status means nothing happened.** Status automation fires on
events *inside Flow*. A quote emailed outside the app, or a payment reconciled
only in Xero, leaves the job sitting where it was. Diagnose the missing event
rather than manually shunting the status.

**Merging gear and crew readiness.** They fail for different reasons and get
fixed by different people. Keep them as separate lines in your report.

**Silently passing an unrunnable check.** If you could not check something, say
you could not check it.

**Forgetting non-equipment lines.** Labour, transport, services and MISC lines
never move through the warehouse and sit at `CONFIRMED` for the life of the job.
Do not flag them as "not prepped".

**Losing the accessories.** Default accessories auto-attach and travel with their
parent. They appear on warehouse documents (packers need them) and not on client
documents (the parent line is the charge). A pick that drops them ships a
fixture with no clamp.

## Reporting a prep review

A useful format:

```
JOB — <number> <name> · <client> · <gear window>
Status: <status>   Readiness: <n> blocking, <n> warnings, <n> unchecked

BLOCKING
- <what> — <why it blocks> → <the fix, and who does it>

WARNINGS
- <what> → <suggested action>

NOT CHECKED
- <what> — <why it could not be checked>

READY
- <the checks that genuinely passed, one line total>
```

Lead with the count. A PM scanning this on a phone should know in two seconds
whether to worry.
