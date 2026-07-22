# ADR-0004: Route performance regressions through the standard defect workflow

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

The budgets split into two categories with different natural owners:

1. **Build-time, CI-blocking gates** — the JS bundle regression ratchet (`bundle-ratchet.mjs`)
   and the CSS bundle budget (`size-limit`, R-8.7.5). These run on every PR and fail the build.
2. **Runtime PostHog alerts** — CWV (`LCP`/combined `INP+CLS`), `slow_query` (T-9),
   `convex_op_latency` (T-P6), `queue_lag` (T-P7). These fire against live production traffic,
   independent of any PR.

## Decision

**Category 1 (CI-blocking) is already compliant — no new process needed.** A failing
bundle-ratchet or CSS-budget check blocks the PR from merging. The PR itself is the tracking
artifact, the PR author is the owner by construction (they can't merge until it's fixed or a
POLICY.md §15 exception is registered), and this satisfies R-9.5's "owner + defect workflow"
requirement without any additional tooling.

**Category 2 (runtime alerts) gets a lightweight manual process**, proportionate to this
being a solo-maintainer project (README's `Owner:` line names one person for the whole repo) —
not a webhook-to-issue automation pipeline, which would be disproportionate engineering effort
for this finding's `severity:minor` / `effort:medium` audit rating:

1. All five PostHog alerts (`LCP`, combined `INP+CLS`, `slow_query`, `convex_op_latency`,
   `queue_lag`) are subscribed to the budget owner (currently Jayden, matching README's `Owner:`
   line and the R-9.12 cost-budget owner convention already in place).
2. On receiving an alert notification, the owner opens a GitHub issue in this repo:
   - Title prefixed `perf:` (e.g. `perf: LCP p75 crossed 2000ms`), so these are greppable via
     `is:issue "perf:" in:title` without needing a dedicated label.
   - Body links the firing PostHog insight/alert and states the budget row it corresponds to
     (T-7/T-9/T-P6/T-P7 from README's R-0.4 table).
   - Assigned to an owner (default: the budget owner, same person, unless the regression is
     clearly scoped to a specific recent PR/author).
3. The issue is triaged and closed like any other bug — through the normal PR-review workflow,
   not a special performance-only process. If the alert is a false positive or the regression is
   accepted, that's a POLICY.md §15 exception in `docs/exceptions.md`, not a silent close.

This is a **process** decision, not a code change — there is nothing to merge for Category 2
beyond this ADR. It closes the loop that #623 (enforcement) and #656 (alerting) opened, without
building bespoke automation a one-person team doesn't yet need.

## Consequences

- R-9.5 is satisfied for both regression categories without new infrastructure.
- The manual step in Category 2 is a real gap: a missed or ignored PostHog notification means a
  regression goes untracked. Revisit if the team grows past one person, or if alert volume makes
  manual triage unreliable — at that point, a PostHog webhook → GitHub Issues Action (mirroring
  how `build-image.yml` already calls external webhooks) is the natural next step.
- No new GitHub label was created (`perf:` title prefix instead) to avoid repo-config churn for
  a workflow that may still change shape as it's used in practice.
