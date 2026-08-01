# Project Overview Tab (Readiness + Finance at a glance)

> _Owner: Jayden Nawotka · Last reviewed: 2026-08-01 (review quarterly — POLICY.md R-5.5)_

#1061 — the project detail's **home tab**. You land here, read the project's
state, then pick a tab to work in.

## What changed and why

Before #1061 the project detail opened straight into **Equipment**, with:

- a ~296px right sidebar (Schedule · Location · Team · Activity) rendered
  alongside **every** tab — context the equipment table was paying for on
  every row;
- a 4-metric summary strip, a reservation-conflicts banner and a lock strip
  stacked above the tab row;
- quotes and invoices reachable only by opening the Finance tab and scrolling
  past a vertical stack of panels.

There was no single place that answered "is this job OK?". The signals existed
— the org-wide overbooking board, the conflicts banner, the confirm-time gate —
but each answered a different question, in a different place, and three of them
were hide-when-clean banners, so a clean project and a project whose checks
hadn't loaded looked identical.

## Layout

```
Page header · lifecycle stepper · lock strip        ← stays page-level (every tab)
└── Tabs: Overview | Equipment | Labour & logistics | Finance | Tasks | Notes | Files
     └── Overview
          ├── main column            ├── context rail (lg+)
          │   ├── Readiness          │   ├── Schedule
          │   ├── Quote │ Invoicing  │   ├── Location
          │   └── Money strip        │   ├── Team
          │                          │   └── Activity
```

Every other tab now renders **full width**.

**The lifecycle stepper and lock strip deliberately stay above the tabs.**
Status and lock state change what you can do in *every* tab, so they're
page-level context, not Overview content.

**Overview is the landing tab, but `?tab=` still wins** — the org Finance
section's rows deep-link to `?tab=finance` and must land there (#992).
`Tabs` is CONTROLLED (it was uncontrolled before) because a failing readiness
check navigates you to the tab that fixes it.

## Readiness

Five checks, always rendered — including the passing ones. This is a departure
from the banners it replaces (`ProjectConflictsBanner`, `StalePricingBanner`),
and the reason is worth keeping: a hide-when-clean banner gives zero noise but
also zero reassurance, and a component that appears and disappears makes the
page jump. When every check passes the panel collapses to a single line with a
"Show checks" toggle, so the five rows only cost anything when they have
something to say.

| Check | Source | Severity |
|---|---|---|
| Gear short for this window | `projectReadiness.forProject` | `blocking` (hard) / `warning` (pencilled) |
| Assets double-booked | `reservationConflicts.projectConflicts` | `blocking` |
| Crew unconfirmed / services understaffed | `projectReadiness.forProject` | `warning` |
| Lines unpriced | `projectReadiness.forProject` | `warning` |
| Pricing stale for these dates | `lineItemWrites.projectPricingStaleness` | `warning` |

### Rules that are load-bearing, not cosmetic

- **`unknown` is a fourth severity and never counts as all-clear.** A dateless
  project has no window to compare bookings against, so the gear check reports
  "not checked" rather than a false pass.
- **Hard vs pencilled get different sentences.** "Gear short for this window"
  (committed) vs "would be short if you confirm" (pencilled). An unconfirmed
  project's own demand is pencilled *by definition*, so collapsing these would
  cry wolf on every enquiry.
- **"No crew assigned yet" ≠ "All crew confirmed."** Both pass, but the first
  must not imply a roster exists.
- **`DECLINED`/`CANCELLED` are settled-no, not unconfirmed.** A decline shrinks
  the active count (the service is a head short) rather than inflating the
  chase-up count — there's nobody left to chase on that row.
- **Order is fixed, not severity-sorted**, so rows don't reshuffle under the
  cursor as problems resolve. Only the marks change.

Each failing row carries the action that fixes it: gear → `/overbookings`
(where a shortage is actually resolved), conflicts → expands **inline** to the
swap-to-a-free-asset picker, crew → the Labour tab, unpriced → Equipment,
stale → an inline "Recalculate".

## Finance cards

Two peers: **Quote** (what we told the client) and **Invoicing** (what they owe
us). Each carries only the ONE action you'd most likely take next.

- **A sent quote's amount is the FROZEN snapshot total**, never live project
  pricing — that's the whole point of the freeze (FEATUREDOCS/66). Only a
  never-sent draft shows the project's current total, because that IS what
  sending would freeze.
- **The invoicing headline is what's OUTSTANDING**, not the invoice total.
  "Not yet raised" is a separate row: being un-invoiced and being unpaid are
  different problems with different fixes.
- **A null amount renders a faint em-dash, never `$0.00`** — nothing quoted and
  zero dollars quoted are different facts.
- **No invented gates.** Invoice creation is NOT blocked on an accepted quote
  anywhere in `invoicesWrites.ts`, so the card never claims it is.

**These cards are not a second quote rail.** Recall, correction, delete,
reprice, the revision viewer and diff, issuing, voiding, crediting, Xero pushes
and the full invoice/payment lists all stay in the Finance tab, which remains
the single owner of those workflows. The dialogs the cards open are the SAME
components `ProjectQuoteRail` uses.

## Architecture

```
convex/lib/projectReadiness.ts   — pure aggregation (no ctx.db), unit-tested
convex/projectReadiness.ts       — the `forProject` query (bounded reads, R-9.8)
src/lib/project-readiness-checks.ts  — severity/wording/ordering (plain module)
src/lib/project-invoicing-state.ts   — invoicing position + next step
src/hooks/use-project-readiness.ts   — fans three sources into one check list
src/components/projects/project-readiness-panel.tsx
src/components/projects/project-context-rail.tsx     — the re-homed sidebar
src/components/projects/conflict-row.tsx             — was project-conflicts-banner.tsx
src/components/projects/overview/{quote-card,invoicing-card,card-parts}.tsx
```

### One rule, one home (R-3.1)

The readiness query deliberately does **not** re-implement two checks that
already had exactly one home each — the panel subscribes to their existing
queries alongside it:

- double-booked assets → `reservationConflicts.projectConflicts`
- stale auto-pricing → `lineItemWrites.projectPricingStaleness`

Three duplications were collapsed while building this, rather than added to:

| Rule | Was | Now |
|---|---|---|
| "which shortages are this project's problem" | inline in `overbookingConfirmImpact.ts` | `ownGearModelIds`, shared with the confirm gate |
| deposit-before-balance next step | inline JSX in `project-finance-panel.tsx` | `deriveInvoicingState`, shared with the Overview card |
| `intentToBadgeStatus` | two byte-identical private copies | `src/lib/status-colors.ts` |

### Reactivity

`projectReadiness.forProject` is a **live subscription** — same bounded,
referenced-only read shape the org board already subscribes to, and the
checklist genuinely benefits from updating as a swap or a crew confirmation
lands. `projectConflicts` stays **one-shot** by design: conflict detection
scans the org's whole booking graph, so a reactive subscription would re-run on
every org write (see the R-8.3.3 entry in `docs/exceptions.md`). `isLoading`
waits on the readiness query alone — withholding four known answers pending a
fifth is worse than filling in.

### Actual vs simulated status

`overbookingBoard.confirmImpact` simulates the project as `CONFIRMED` to answer
"what would break if I confirmed this". `projectReadiness.forProject` reports
the project's **real** status — the checklist describes what is true now, and
the confirm-time dialog keeps owning the hypothetical. Both read the same
aggregation core, so they can't disagree about the underlying numbers.

## Related

- [10 — Projects](./10-projects.md) · [62 — Lifecycle locks](./62-project-lifecycle-locks.md)
- [65 — Overbookings & Gaps board](./65-overbookings-gaps-board.md) — the org-wide sibling
- [66 — Finance: quotes, invoices, Xero](./66-finance-quotes-invoices-xero.md)
