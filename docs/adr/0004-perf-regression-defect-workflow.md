# ADR-0004: Route performance regressions through the standard defect workflow

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

**Status:** Accepted (2026-07-22)

## Context

POLICY.md **R-9.5** (WEB profile, §9A): *"Performance regressions are bugs: bundle growth,
CWV/latency degradation, CI-time growth each get an owner and enter the defect workflow."* Its
remediation note (from the 2026-07-18 post-remediation audit, tracked as issue #657) is:
*"Once gates block, route perf regressions into the defect workflow with an owner."*

Before #623/#656, this rule was moot — several of the underlying gates were advisory or dead
(the CSS bundle check was never wired into CI; queue lag had no monitoring at all), so there was
nothing to route. #623 made every budget in the README's R-0.4 registry machine-enforced, and
#656 gave every one of them a PostHog alert. With the gates now real, R-9.5 needs an actual
answer: when one fires, what happens next?

Regressions are caught in two different ways, which matters for *when* an issue gets filed but
not for *whether* one does:

1. **Build-time, CI-blocking gates** — the JS bundle regression ratchet (`bundle-ratchet.mjs`)
   and the CSS bundle budget (`size-limit`, R-8.7.5). These run on every PR and fail the build
   before the regression ever reaches `main`.
2. **Runtime PostHog alerts** — CWV (`LCP`/combined `INP+CLS`), `slow_query` (T-9),
   `convex_op_latency` (T-P6), `queue_lag` (T-P7). These fire against live production traffic,
   independent of any PR.

## Decision

**Every regression caught by an R-9.5-covered gate — CI-blocking or a runtime alert — gets a
`perf:`-prefixed GitHub issue.** A blocked PR is not, on its own, enough of a record: it
disappears once the regression is fixed and the PR merges clean, with no trace that it ever
happened. Filing an issue either way gives a permanent, greppable history (`is:issue "perf:"
in:title`) — useful for spotting a budget that keeps getting regressed by different PRs, which a
one-off blocked PR would never surface.

### Trigger

- **Category 1 (CI-blocking):** file the `perf:` issue as soon as the gate fails on a PR — don't
  wait for it to be fixed or merged. Link the failing PR/check run in the issue body.
- **Category 2 (runtime alerts):** file only once an alert has fired on **2 consecutive daily
  evaluations**, not on an isolated first firing. All five alerts run on a `daily`
  `calculation_interval`, so this means the underlying condition has held for roughly 48 hours —
  enough to filter a one-day traffic blip while still catching a real regression fast. This is a
  default, not a hard rule: tighten it per-alert (e.g. file on the first firing) if a specific
  budget turns out to need faster response, or loosen it if a particular alert is noisier than
  expected.
  - **Exception:** an isolated but *severe* spike (e.g. an outage-adjacent latency event) can
    still warrant filing immediately on first firing — that's a judgment call for whoever sees
    the alert, not something the 2-day rule should block.

### Scope

Applies to any budget/gate governed by R-9.5's language ("bundle growth, CWV/latency
degradation, CI-time growth") once it's enforced — not only the five budgets alerted via #656.
README's T-5 (coverage) row is already a blocking CI ratchet today, so it's in scope now; any
future gate that graduates from advisory to blocking or alerted (a11y, CI-time itself, etc.)
joins this workflow automatically, no ADR update needed to add it.

### Ownership

- **Default owner:** whoever's PR most recently touched the affected code/config path. For
  Category 1 this is simply the PR author (they're already blocked from merging until it's
  resolved). For Category 2, trace the regression to its likely originating change (`git log`/
  `git blame` on the affected area, or the most recent deploy before the alert first fired).
- **If no single PR is clearly attributable** (gradual drift, an external dependency update, an
  infra-level cause) — default to the budget owner, Jayden, matching README's `Owner:` line.
- **Backup owner: Penar.** If the primary owner hasn't triaged within the target window (below),
  reassign to Penar. *Open item: this assumes Penar has repo access and enough context to act on
  a reassigned perf issue — worth confirming that's actually true before relying on it in a real
  incident, rather than discovering the gap when an issue is stuck.*

### Triage & resolution

- **"Triaged"** = assigned + acknowledged (a comment or reaction confirming someone has seen it
  and intends to act). It does **not** require a fix to already be in progress.
- **Target: triage within the same week the issue is filed.** This is a soft internal target,
  not a new POLICY.md `MUST` — R-9.5 doesn't specify an SLA, and this repo has no on-call
  rotation to enforce a hard one. Missing the target isn't itself a defect; it's a signal.
- If the primary owner hasn't triaged within the week, reassign to Penar.
- **The issue stays open until the regression is actually resolved** — root-caused and fixed, or
  reverted. Acknowledging it, or opening a separate follow-up issue for a larger investigation,
  does not close the original; it stays open until the regression itself is gone.

### False positives / accepted regressions

Always go through a POLICY.md **§15 exception** in `docs/exceptions.md` (rule ID, reason, scope,
owner, expiry) — never closed with just a comment, regardless of how minor it looks. Close the
`perf:` issue referencing the exception entry once it's registered.

### Naming

`perf:` title prefix (e.g. `perf: LCP p75 crossed 2000ms`, `perf: bundle-ratchet failed on PR
#812`). No dedicated GitHub label — kept lightweight while the workflow is still new enough that
its shape might change.

## Revisit / automate trigger

Manual filing stays the default until **any** of the following:

- The team grows past one person (a second regular contributor beyond the backup-owner role), or
- **3 or more `perf:` issues are filed within a rolling 90-day window** — a sign alert/gate
  volume has outgrown what manual triage handles cleanly, or
- **Same-week triage is missed twice**, even after backup-owner reassignment — a signal the
  manual step itself isn't working, not just that the target is aggressive.

At that point, build a PostHog webhook → GitHub Issues Action to auto-file (mirroring the
existing GHCR/Coolify webhook pattern already in `build-image.yml`) rather than continuing to
rely on someone remembering to check their alert inbox or watch CI.

## Consequences

- Every regression caught by any R-9.5-covered gate now leaves a permanent record, including
  ones CI stopped from ever reaching `main` — this is new process overhead on routine PR fixes
  (e.g. a dependency bump that grows the bundle by a few KB now also means opening an issue, not
  just fixing the diff). Accepted as the cost of the historical record; a high `perf:` count
  driven mostly by Category 1 noise would itself be a signal to reconsider filing on every
  CI-blocked regression, per the revisit trigger above.
- The 2-consecutive-day filter on runtime alerts is a deliberate trade: it accepts a ~24-48h
  detection delay on borderline regressions in exchange for not filing on every noisy blip. The
  severe-spike exception exists for when that trade is wrong for a specific event, but relies on
  a human noticing and choosing to override the default.
- Reassignment to Penar as backup owner is untested — confirm access/context before treating it
  as a reliable escalation path rather than a theoretical one.
