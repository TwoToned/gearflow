# Project Overview Tab (the job's home)

> _Owner: Jayden Nawotka · Last reviewed: 2026-11-21 (review quarterly — POLICY.md R-5.5)_

#1061 — the project detail's **home tab**. You land here, read the job's
state, then pick a tab to work in. UX Phase 7 (spec §6b, the calm revision)
rebuilt it as one column in prose: a sentence of state, the things to sort, two
quiet money lines, three facts columns and four lines of recent activity. No
cards, no tiles, no per-row buttons: hairlines, sentence-case overlines
(`t-overline`, DESIGN §5.2) and text links. Red appears once (a blocker), amber
only as a dot. Width is capped at 860px so the eye has a single line to follow.

## History

- **#1061** made Overview the landing tab: a Readiness panel, Quote and
  Invoicing cards, a four-tile money strip and four context cards.
- **#1244** replaced the Readiness panel with a Work card; **`6bbdee8`
  (2026-10-17)** then deleted the work layer and the card with it, leaving the
  readiness rules and the Convex query with no UI consumer.
- **UX Phase 7** (this doc) restored readiness, added the blocking-discussions
  and incidents rows, and replaced the cards and tiles with §6b's lines.

## Layout

```
Job header (DetailHeader: status word · lock glyph · progress line)   ← page-level (every tab)
└── DetailLayout
     ├── TabStrip: Overview · Equipment · Packing n/m · Logistics · Finance · Tasks n/m · Notes · Files n · Versions n
     │    └── Overview  (overview/overview-tab.tsx, max-w 860, one column)
     │         ├── Readiness          verdict · lead · rows · clear line
     │         ├── Quote │ Invoicing  two lines + text links (stacked on phone)
     │         ├── When │ Where │ Who  (stacked on phone)
     │         └── Recent             four lines · All activity › · Discussion ›
     └── Sidebar (Schedule · Location · Team · Activity)   ← every tab EXCEPT Overview
```

**The sidebar rides along on every tab except Overview** (#1063). On Overview
that same content IS the page (When · Where · Who and Recent); rendering both
would show the same facts twice. The facts are shaped once in
`src/lib/project-context.ts` (`projectScheduleRows`, `directionsHref`) and shared
by both renderings (R-3.1).

**The header's progress line and lock glyph stay above the tabs** (FEATUREDOCS/10
"Project Detail Page Layout"): they change what you can do in every tab.

**Overview is the landing tab, but `?tab=` still wins** (#992). The tabs are
CONTROLLED because a failing readiness row navigates you to the tab that fixes
it; the keys and aliases live in `src/lib/job-tabs.ts`. A template shows only
its facts (Where, Who): no readiness, money or activity.

## Readiness

`overview/readiness-section.tsx`, from `useProjectReadiness`
(`src/hooks/use-project-readiness.ts`). The rules are
`src/lib/project-readiness-checks.ts`; how they read is
`src/lib/job-readiness-verdict.ts`.

**Before the gear leaves** (Enquiry → Prepping):

- **Headline** — `Prep is held` (red; any blocker), `Not ready for prep yet`
  (anything unknown or warning), `Ready for prep` (green).
- **Lead** — the first blocker in words, with its ONE link (`Open the
  discussion ›`, `Swap ›`, `Resolve ›`); or `n things to sort before the gear
  leaves.`; or `Every check is clear.`
- **Rows** — the other failing checks, worst first (blocking, unknown,
  warning; fixed order within a severity). Three shown; `and n more ›` expands.
  Each row is one text button that goes to the surface owning the fix.
- **Clear line** — one micro line naming the checks that passed.

**From Out onward** (Out, On site, Returned, Completed, Invoiced, and
Cancelled) the checklist has done its job: the section is a one-line state
sentence (`Out — the gear has left the warehouse.`), with only a failing
**incidents** or **blocking discussions** row still listed under it.

| Check | Source | Severity | Fix (link) | Dropped when |
|---|---|---|---|---|
| Gear short / would be short | `projectReadiness.forProject` | `blocking` (hard) / `warning` (pencilled) / `unknown` (no dates) | Equipment; no dates → edit page | never |
| Assets double-booked | `reservationConflicts.projectConflicts` (ONE-SHOT) | `blocking`; `unknown` until it answers, on failure, or with no dates | Equipment (the swap); no dates → edit page | never |
| Blocking discussions hold prep | `collaboration.getProjectBlockingSummary` (the header's subscription) | `blocking` | the comments panel | count still loading |
| Services not confirmed / short of crew | `forProject` | `warning` | Logistics | no active services |
| Crew unconfirmed | `forProject` | `warning` | Logistics | no crew assigned |
| Lines unpriced | `forProject` | `warning` | Equipment | never |
| Lines not planned (no container) | `forProject` | `warning` | Packing | no plannable equipment |
| Open incidents on this job's gear | `forProject` (`incidents`, bounded) | `warning` | the job's warehouse page | never |

**Phase 10 must not build the blocking-discussions row again** — it moved into
Phase 7 (overseer ruling Q4).

### Rules that are load-bearing, not cosmetic

- **`unknown` never counts as clear.** A dateless job can't be checked for gear
  or double-booking; an unanswered or failed one-shot detection is "not checked
  yet", never "No assets double-booked".
- **Hard vs pencilled get different sentences** ("Gear short for this window"
  vs "would be short if you confirm").
- **A row that doesn't apply doesn't render at all** (no services, no crew,
  nothing to plan). Don't conflate "N/A" with `unknown`.
- **Services and crew are separate rows** (#1063): the WORK vs the PEOPLE.
- **`DECLINED`/`CANCELLED` are settled-no**, not unconfirmed; a service is "not
  confirmed" only while `PLANNED`.
- **Every failing row carries its `fix`** (`ReadinessFix`: a tab, the edit page,
  the warehouse page, or the discussion). The section never fixes anything.

### The reads

- `projectReadiness.forProject` is a **live subscription** (bounded,
  referenced-only reads, R-9.8). Its `incidents` section (UX Phase 7) reads
  `maintenanceRecords` through the existing `by_projectId` index (the project is
  already org-checked; the index is global, so any row whose `organizationId`
  isn't the caller's org is dropped), takes at most 201 rows and returns
  `{ openCount, truncated }`; a truncated count prints as `200+`. No schema change. Open = `incidentType` set, status neither
  `COMPLETED` nor `CANCELLED`. This replaced the `OpenIssuesBadge`, which
  subscribed to the org's whole `maintenanceRecords.list`.
- `reservationConflicts.projectConflicts` is **one-shot** (a `convex.query` in
  an effect, once per job per mount): it scans the org's booking graph
  (`loadOrgGraph`), the R-8.3.3 exception in `docs/exceptions.md`, renewed to
  2027-02-21.
- The blocking count is the same `getProjectBlockingSummary` subscription the
  header ⋯ holds (same args, one subscription).
- The section waits only on `forProject`; the other two may lag and their rows
  say so.

`forProject` reports the job's **real** status; `overbookingBoard.confirmImpact`
keeps owning "what would break if I confirmed" (it simulates `CONFIRMED`). Both
read the same aggregation core.

## Money: two lines

`overview/quote-card.tsx` (`QuoteMoneyLine`) and `overview/invoicing-card.tsx`
(`InvoicingMoneyLine`), side by side on desktop, stacked on phone.

- **Quote** — `$23,880 · v3 sent 4 Nov · valid until 4 Dec` (or `v3 accepted`,
  `v2 · not sent yet`, …), a drift line when the job no longer matches the sent
  version (`see what changed ›` → Finance), then text links: the next move
  (`Send quote` for a never-sent draft, `Record accept` for a sent one, never
  both), `PDF` (only when stored bytes exist, #987), `All revisions`
  (`QuoteManagerDialog`), `Finance ›`. A sent quote's amount is the **frozen
  snapshot total**, never live pricing; only a never-sent draft shows the live
  total.
- **Invoicing** — exactly what `deriveInvoicingState` says: its headline label
  and the figures that mean something (`Awaiting payment · $5,000 outstanding ·
  $5,000 invoiced`), the next step under it (`$18,880 not yet raised · Last:
  INV-0041 deposit issued 8 Nov`), then `+ Invoice ▾` (partial / remaining
  balance, only while something is left to raise), `Record payment`,
  `All invoices` (`InvoiceManagerDialog`), `Finance ›`. No client → "Assign a
  client to this job to raise quotes and invoices."
- **Out of Phase 7, into Phase 10:** merging `deriveInvoicingState` with
  `computePaymentProgress` (they disagree on credit notes and drafts) and adding
  `Deposit paid` as an invoicing state.
- **No invented gates**, and these lines are not a second quote rail: recall,
  correction, reprice, issuing, voiding, crediting and Xero all stay on Finance;
  the dialogs here are the SAME components `ProjectQuoteRail` uses.

## When · Where · Who · Recent

`overview/context-cards.tsx`.

- **When** — `Rental 12 Nov – 14 Nov · 3 days`, the job window rows (or "No job
  window — same as the rental dates"), `Edit dates` (→ the edit page until
  Phase 9's dates sheet), `Logistics ›`.
- **Where** — venue, address · `directions`, `Edit` (→ the edit page until
  Phase 9).
- **Who** — site contact · phone, the client, `PM …` with `+` (opens the
  existing `ProjectManagersPanel` inline), crew count with unconfirmed in amber
  (from `forProject`, same subscription) · `Logistics ›`.
- **Recent** — four lines of the job's activity log (`activityLog.listByEntity`),
  `All activity ›` (→ `/activity?entityType=project&entityId=…`),
  `Discussion ›` (the header's comments panel, lifted to the page so both open
  the ONE panel).

## Keep · move · remove (UX Phase 7)

| Was on Overview | Now |
|---|---|
| Readiness panel (deleted in `6bbdee8`) | restored as the readiness section, + blocking discussions, + incidents |
| Open-issues badge (top of Overview after slice A) | the incidents row; badge deleted with its org-wide subscription |
| Quote card (amount, revision, sent, valid until, drift, Send / Record accept, View PDF, All revisions) | the quote line, same facts and the same dialogs as text links |
| Invoicing card (outstanding, invoiced, paid, not yet raised, last issued, + Invoice ▾, Record payment, All invoices) | the invoicing line, same derivation and dialogs |
| Tile **Equipment** (equipment revenue) | Finance tab › Financial summary "Equipment"; the line totals on Equipment's footer (Subtotal · Discount · Tax · Total) |
| Tile **Services** (charge · cost) | Logistics tab footer: `On quote`, and with show cost `Cost` + `Margin` |
| Tile **Crew** (labour cost · count) | Finance › Financial summary "Labour"; crew count on Overview's Who line and on Logistics |
| Tile **Total** | the quote line's amount; Equipment footer `Total`; Finance summary |
| Margin (never on Overview by default, §6b) | Equipment `Show margin` (Cost column), Logistics show cost (`Margin` line), Finance summary margin bar |
| Schedule / Location / Team / Activity cards | When / Where / Who / Recent; the sidebar on other tabs unchanged |

## Architecture

```
convex/lib/projectReadiness.ts      — pure aggregation (no ctx.db), incl. computeProjectIncidentReadiness
convex/projectReadiness.ts          — the `forProject` query (bounded reads, R-9.8)
src/lib/project-readiness-checks.ts — severity / wording / fix target per row (plain module)
src/lib/job-readiness-verdict.ts    — verdict, lead, rows, clear line, state sentence (plain module)
src/lib/project-invoicing-state.ts  — invoicing position + next step
src/hooks/use-project-readiness.ts  — fans three sources into one check list; the one-shot conflicts read
src/lib/project-context.ts          — schedule rows + directions, shared by BOTH renderings
src/components/projects/project-context-rail.tsx — the sidebar (every tab but Overview)
src/components/projects/overview/{overview-tab,readiness-section,quote-card,invoicing-card,context-cards,overview-parts}.tsx
```

Tests: `convex/projectReadiness.test.ts` (incidents through `by_projectId`,
org-mismatch rows dropped), `convex/lib/projectReadiness.test.ts`,
`src/lib/__tests__/project-readiness-checks.test.ts`,
`src/lib/job-readiness-verdict.test.ts`, and the jsdom
`overview/__tests__/overview-tab.smoke.test.tsx`, which opens every overlay
(`+ Invoice ▾`, Send quote, Record accept, Record payment, All revisions, All
invoices, the PM editor, `and n more ›`). `src/app/(app)/projects/[id]/__tests__/page-size.test.ts`
keeps the page at or under 800 lines.

### One rule, one home (R-3.1)

The readiness query does **not** re-implement a check that already has a home:
double-booking stays `reservationConflicts.projectConflicts`, blocking
discussions stay `getProjectBlockingSummary`. Stale auto-pricing stays the
Finance tab's `StalePricingBanner` and is deliberately not a readiness row.

## Related

- [10 — Projects](./10-projects.md) · [62 — Lifecycle locks](./62-project-lifecycle-locks.md)
- [64 — Incident reporting](./64-incident-reporting.md) — the incidents the row counts
- [65 — Overbookings & Gaps board](./65-overbookings-gaps-board.md) — the org-wide sibling
- [66 — Finance: quotes, invoices, Xero](./66-finance-quotes-invoices-xero.md)
