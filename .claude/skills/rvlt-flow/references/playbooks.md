# Ops playbooks — recurring routines

Worked procedures for the things worth doing on a rhythm. Each is a *read and
recommend* pass unless it says otherwise — none of them should execute writes
without the operator saying go.

## Weekly availability sweep

Answers: what's on, what's free, what's already a problem.

1. `check_availability` for the 7-day window (epoch milliseconds).
2. `list_overbookings` for the same window.
3. `get_warehouse_status` for anything already overdue back.
4. `list_projects` filtered to the window if you need job context the
   availability data doesn't carry.

Report grouped **by day**, because that is how the week is actually worked:

```
WEEK OF <date>

MON <date>
  Out:      <jobs deploying>
  Back:     <jobs returning>
  Conflicts: <any>

TUE …

STANDING ISSUES
  Overdue:   <what should already be back, and from which job>
  Conflicts: <count> — see triage below
  Short:     <models with demand over effective stock>
```

Call out the days where gear goes out and comes back on the same day — those are
the ones where the turnaround is tight and a late return breaks the next job.

## Overbooking triage

Answers: which conflicts are real, and what to do about each.

1. `list_overbookings` for the range.
2. For each conflict, find substitutes — `search_assets` for free units of an
   equivalent model, or `call_operation` on `reservationConflicts.swapCandidates`
   for the same line.
3. Classify every conflict into one of three outcomes:
   - **Swap** — a free equivalent exists. Name the substitute unit.
   - **Reschedule** — the windows can be separated. Name which job moves and by
     how much.
   - **Escalate** — the two jobs genuinely compete. Name both jobs, both clients,
     and what each stands to lose.
4. Do **not** execute swaps. This is a recommendation pass; the decision about
   which client gets the gear is commercial, not operational.

Check the pencilled/hard status of each side before you call something a
conflict. Two pencilled jobs competing is a note. A pencilled job competing with
a confirmed one is nearly always resolvable in the confirmed job's favour. Two
hard jobs competing is a real problem and needs a human now.

## Finance chase

Answers: what money is sitting still.

1. **Quotes expiring** — a quote is `EXPIRED` when its valid-until has passed,
   computed on read. Surface anything `SENT` and expiring within the next few
   days *before* it lapses, because a lapsed quote means re-quoting at today's
   availability.
2. **Invoices issued and unpaid** — payment status is derived from payment rows.
   Group by age and name the client.
3. **Jobs parked in `AWAITING_PAYMENT`** — especially any whose gear window has
   already started. That is gear hard-held against money that hasn't landed.

Before reporting a job as "stuck unpaid", check whether the org records payments
in Flow at all. Many reconcile in Xero only, in which case the payment trigger
never fires and the job moves forward on physical work instead. That is normal,
not a fault — say so rather than raising a false alarm.

## Job readiness sweep

Answers: which of the upcoming jobs are not ready.

1. `list_projects` for jobs whose gear window starts in the next 7–10 days.
2. For each, run the five readiness checks (see `job-prep.md`).
3. Report as a single table, worst first:

```
JOB              OUT      BLOCKING  WARN  UNCHECKED  WORST ITEM
GF-2026-0142     Thu      2         1     0          Console double-booked
GF-2026-0138     Sat      0         3     1          3 crew unconfirmed
```

Then expand only the jobs with blocking items. Nobody needs the detail on the
jobs that are fine.

## Utilisation and margin questions

Common shapes, and where the answer lives:

- **"What's this job making us?"** — `get_project_financials`. Remember sub-hire
  cost versus charge, and that a no-financials key returns zeros.
- **"What's sitting idle?"** — cross-reference `search_assets` against
  `check_availability` for a window. Effective stock, not total.
- **"Which gear earns?"** — needs asset-level revenue attribution; reach for
  `list_operations` rather than assuming a curated tool covers it.
- **"Are we over-hiring?"** — recurring sub-hires of the same model are a buy
  signal. Worth surfacing unprompted when you notice it in a triage pass.

## Post-job close-out

After `RETURNED`, before a human closes the job:

1. Reconcile — what went out versus what came back. Anything missing or damaged
   should already have a check item recorded on the return; if it doesn't, that
   is the gap to flag.
2. Sub-hires returned to their suppliers (`ON_HIRE` → `RETURNED`).
3. Costs captured — crew hours, sub-hire invoices, transport.
4. Invoice raised if it hasn't been.

Then stop. `COMPLETED` and `INVOICED` are human decisions and are never
automated. Present the checklist; let someone close it out.
