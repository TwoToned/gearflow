# Project Status Automation (#1160)

> _Owner: Jayden Nawotka · Last reviewed: 2026-09-15 (review quarterly — POLICY.md R-5.5)_

## What this is

A job's status used to be a field somebody had to remember to change. A quote went
out and the job sat at `ENQUIRY`; gear left the building and the board still said
`CONFIRMED`. The board was therefore only as accurate as the last person who
thought about it — which on a busy week is "not".

This makes the status a **consequence of the work**, not a separate chore. Four
moments now advance it on their own:

| Trigger | Fires when | From | To |
|---|---|---|---|
| `QUOTE_SENT` | a quote revision is sent to the client | `ENQUIRY` / `QUOTING` | `QUOTED` |
| `PREP_STARTED` | the warehouse packs the first item | `CONFIRMED` | `PREPPING` |
| `ALL_CHECKED_OUT` | nothing is left packed on the dock | `CONFIRMED` / `PREPPING` | `CHECKED_OUT` |
| `ALL_RETURNED` | the last outstanding item is checked back in | `CHECKED_OUT` / `ON_SITE` | `RETURNED` |

`ALL_RETURNED` is not new behaviour — the returns station shipped with its own
private `maybeAutoAdvanceProject`. It is now the same rule as the other three
rather than a second copy (R-3.1), and it applies to the project-scoped check-in
too, which it previously did not (see "What changed for check-in" below).

## Where it lives

```
convex/lib/projectAutoStatus.ts    — the rule table + the ONE advance function + the revert
convex/lib/orgSettings.ts          — resolveAutoStatusEnabled (the org opt-out, read in-mutation)
src/lib/project-status-automation.ts — the shared vocabulary: switch keys, labels, toast copy
src/components/settings/status-automation-settings.tsx — the four switches
convex/projectAutoStatus.test.ts   — rule-table invariants + every trigger against a seeded DB
```

Call sites (each calls `maybeAutoAdvanceProjectStatus` ONCE, at the end of the
mutation that did the real work):

| Trigger | Mutations |
|---|---|
| `QUOTE_SENT` | `quotesWrites.sendNative` |
| `PREP_STARTED` | `checkRecordOps.{prepItem,prepItems,prepKitChildren,prepKitsBatch}`, `checkRecordWrites.completeCheckAndPack` |
| `ALL_CHECKED_OUT` | `warehouseWrites.{checkOutItems,checkOutKit,checkOutKitsBatch}` |
| `ALL_RETURNED` | `warehouseWrites.{checkInItems,checkInKit,checkInKitsBatch}`, `returnsWrites.{returnScanNative,returnBulkNative,returnBatchNative}` |

## The three properties that make it safe to run unattended

1. **Forward-only, from an explicit set.** Each rule declares the exact statuses
   it may move a job OUT of. A `CANCELLED`, `COMPLETED` or `INVOICED` job is never
   reopened by a warehouse scan; a job already past the target never goes
   backwards; re-firing a trigger is a no-op because the `from` set no longer
   matches (which is what makes "the second item prepped" free).
   `convex/projectAutoStatus.test.ts` asserts this over the whole table rather
   than per rule, so a new trigger inherits the guarantee.

2. **It never crosses INTO a snapshotting or hard-locking tier.** The two
   transitions `projectWrites.updateStatusNative` treats as ceremonies —
   entering `CONFIRMED` (whole-project snapshot + the accepted-quote gate + the
   overbooking-impact dialog) and entering `COMPLETED`/`INVOICED` (`HARD_LOCKED`
   + snapshot) — are deliberately **not** automated. Accepting a quote still only
   *offers* `CONFIRMED` (`markAcceptedNative`'s `offerStatusChange`): confirming a
   job commits stock and money, so it stays a human's click. A table-level test
   fails the build if a future rule targets one of those three.

3. **It patches the project directly, on the authority of the gate the calling
   mutation already passed.** Routing through `updateStatusNative` would re-gate on
   `project:update`, which a dedicated `warehouse` role does **not** have (it has
   `check_in`/`check_out` and only `project:read`) — so the side effect would
   silently fail for exactly the role the warehouse stations are built for. This
   is the reasoning the returns station already shipped with; the shared module
   inherits it, and reproduces everything `updateStatusNative` does around the
   patch: `bumpProjectCounters`, the `autoCommitOpenSession` invariant ("an unlock
   session never silently spans a status change" — the old returns copy skipped
   this), and a lock-tier-annotated `STATUS_CHANGE` audit row.

## Why "all deployed" is measured in PACKED lines, not EQUIPMENT lines

`anyPackedWaiting` asks "is any line still sitting packed on the dock?" —
`prepStatus === "PACKED"` and status not `CHECKED_OUT`/`RETURNED`/`CANCELLED`. It
is the server-side twin of `isInPreppedStage`
(`src/components/warehouse/warehouse-types.ts`) reduced to its core.

The obvious alternative — "is every `EQUIPMENT` line `CHECKED_OUT`?" — is wrong in
a way that only shows up in production: a services line, a labour line, a sale
line, a sub-hire going direct to site and a never-prepped optional all sit at
`CONFIRMED` forever and would hold the job at `PREPPING` permanently. Keying off
`prepStatus` sidesteps the whole taxonomy question, because **only gear that was
physically picked is ever `PACKED`**.

Two shapes of waiting line exist and both are checked: a unit-backed line rolls
up to `PREPPED` (`deriveOrderLineStatus`), while the direct kit-prep path patches
the line row to `CONFIRMED` + `PACKED`. Both are indexed range scans on
`by_projectId_status`, never a whole-project collect.

The advance also requires at least one `CHECKED_OUT` line, so a job whose gear was
never prepped doesn't "finish" deploying the moment someone looks at it.

## The org opt-out

`OrgSettings.projectStatusAutomation` — four optional booleans, **absent = ON**.
Every pre-#1160 org gets the automation with no backfill, and the stored blob only
ever records an explicit opt-OUT (turning a switch back on DELETES the key, so the
default has exactly one representation).

The convex/src boundary has no shared module, so the key list exists on both sides
and `convex/projectAutoStatus.test.ts` asserts parity — adding a trigger on one
side without the other fails the suite (R-3.1).

Settings live under **Settings → General → Status automation**, rendered as a list
of rules ("Quote sent → Quoted") rather than a list of toggles, so the screen
explains the behaviour instead of assuming the reader knows it.

## What the user sees

Status must never change under someone silently, so every automatic move is
announced where the person who caused it is looking:

- **Send quote dialog** — the handover panel says "Job moved to Quoted" as a
  statement of fact (`send-quote-status-notice.tsx`). When the org has opted out,
  the same slot falls back to the pre-#1160 passive offer ("This job is at
  Quoting. Move it to Quoted? **Move**"). The offer is now the opt-out path, not
  the normal one — `sendNative` returns `autoStatusChange` when it acted and
  `offerStatusChange` only when it didn't, so the two are never both set.
- **Warehouse + returns station** — a toast ("Job moved to Deployed — nothing left
  on the dock"). Fired in the HOOKS (`use-warehouse-writes`, `use-returns`,
  `use-check-record-writes`), once, rather than at each call site: the automation
  is a property of the mutation, not of the button that happened to call it.
  `autoStatus` is only ever non-null on the ONE call that actually crossed the
  boundary, so a 40-item deploy toasts at most once.
- **Activity log** — a `STATUS_CHANGE` row with `metadata.autoAdvanceTrigger`, so
  "who moved this job?" is answerable and the automation is filterable.

**Known gap:** the four service-context prep mutations
(`checkRecordOps.prep*`, driven by the server actions in
`src/server/check-records.ts`) advance the status server-side but return shapes
the direct-prep call sites don't read, so those paths show the move through the
warehouse page's live project header rather than a toast. The check-driven prep
(`completeCheckAndPack`, browser-direct) does toast. Closing this means plumbing
`autoStatus` out through four server actions whose return shapes differ (one
returns an array), which is why it was left out of this change rather than done
half-way.

## Reverting

`revertAutoAdvance` (same module) undoes ONE automatic move from its own audit
row, and `agentRevert.revertAgentWindow` calls it: reversing an agent's deploy
without the status would leave a job at Deployed with nothing deployed. Two
guards make it safe:

- It only ever undoes an **automatic** move. A deliberate `updateStatusNative`
  call carries no `autoAdvanceTrigger`, and reverting one has its own audience +
  justification rules (#792) this path does not re-implement.
- It refuses if the project has moved on since (`statusTo` is no longer current) —
  whatever is there now is someone's later decision, and stamping an older value
  over it would be silent data loss, not a revert.

## What changed for check-in

`warehouseWrites.checkInItems` / `checkInKit` / `checkInKitsBatch` now auto-advance
too. Before this, only the org-wide returns station did, so the same physical act
— the last case coming back — closed the job out or didn't, depending purely on
which screen the operator happened to use.

## Deliberately out of scope

- **`ON_SITE`.** There is no event that means "the gear reached the venue".
  Inferring it from the project's start date would be guessing, and `ON_SITE` is
  the boundary into the `JUSTIFY` lock tier (#793) — the wrong place to guess. The
  lifecycle stepper already labels `CHECKED_OUT` and `ON_SITE` as one "On site"
  stage, so the automation reaching `CHECKED_OUT` moves the stepper anyway.
- **`CONFIRMED` / `COMPLETED` / `INVOICED`** — see property 2 above.
- **De-prep / undeploy / unreturn.** Reversing gear does NOT reverse the status.
  A partial undeploy mid-job is a correction, not a lifecycle step backwards, and
  a job bouncing between Prepping and Deployed as an operator fixes a mis-scan
  would be worse than a slightly stale status. The one exception is
  `revertAutoAdvance`, which is a whole-window agent revert, not an operator fix.

## Related

- [62 — Project Lifecycle Locks](./62-project-lifecycle-locks.md) — the tier a
  status implies, and what an automatic move therefore locks.
- [66 — Finance, Quotes & Invoices](./66-finance-quotes-invoices-xero.md) — the
  quote revision model `QUOTE_SENT` hangs off.
- [32 — Prep Containers](./32-preps.md) / [12 — Warehouse](./12-warehouse.md) —
  the prep and deploy flows that fire the warehouse triggers.
