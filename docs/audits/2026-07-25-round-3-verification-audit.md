# Round 3 Verification Audit

**Date:** 2026-07-25 · **Policy:** [`POLICY.md`](../../POLICY.md) v2.6.2 · **Profile:** `WEB`
**Method:** seven independent AI auditors, one per section-group, each told not to read prior reports
or trust any issue's "closed" status — every verdict re-derived from current code, live `pnpm audit`,
live GitHub branch-protection API calls, and live PostHog alert/insight queries.
**Prior:** round 1 (`2026-07-22-full-compliance-audit.md`, 0 Critical/23 Major/14 Minor, 70.4%) →
round 2 (`2026-07-23-remediation-verification-audit.md`, 1 Critical/8 Major/9 Minor, 85.6%) → 28
issues filed (#814-841) → this round.

> **Headline: 0 Critical · 7 Major · 7 Minor · 88.9% compliant** (112 PASS ÷ 126 applicable
> MUST/SHOULD rules). Up from 85.6%. **The Critical finding is resolved** — `main` now has branch
> protection, confirmed live (`protected: true`). But the clearest signal this round is a **pattern**,
> not a single finding: two rules (R-3.1, R-5.3) recurred in files the previous fix didn't touch, and
> one rule (R-8.3.3) has now shown **zero change across three consecutive audits** — 665 unbounded
> `.collect()` calls, identical every time. Remediation is closing the *named instance* in each issue,
> not the underlying defect class.

## What this audit tells us

1. **The Critical is genuinely fixed.** `mcp__github__list_branches` returns `{"name":"main",
   "protected": true}` — a direct API read, not a doc claim. Every recent commit on `main` arrives
   via a merged PR; no orphan direct-push commits found. One caveat: no tool in this environment can
   enumerate the exact ruleset (required-check list, approval count), so the *existence* of
   protection is confirmed, not its full configuration.
2. **Four sections are now clean: §8.4/§8.6/§8.7 (auth/forms/UI), §8.8 (testing), §8.10/§8.11/§8.12
   (integrations/security/privacy).** These held up under a third, adversarial re-check with no
   regressions — including the two originally-Critical/top-priority items (email HTML escaping,
   Postgres backup) from round 1.
3. **One section regressed: §8.9 Observability, 100% → 83%.** Not a code regression — the wiring is
   untouched and correct. Two live PostHog alerts (LCP p75, `convex_op_latency` p95) have been
   **continuously firing since 2026-07-22 with no action taken** — exactly the "standing ignored
   alert" condition R-8.9.3 prohibits. The alerting infrastructure is doing its job; nobody has
   looked at the output yet.
4. **R-8.3.3 (unbounded Convex reads) is now a 3-for-3 non-fix.** 665 non-test `.collect()` calls,
   identical in round 1, round 2, and this round. The 223 `r9.8-ok` comment markers accepting this
   are not valid §15 exceptions (no owner, no expiry, not in `docs/exceptions.md`) — they're a
   self-granted pass on a rule that requires a registered one.
5. **The "fixed the instance, not the class" pattern showed up twice more.** R-3.1 (site-admin role
   check) was fixed in 3 files (#817) but a 4th (`admin/users/page.tsx`) still has it. R-5.3 (stale
   `npx`/`pnpm exec` docs) was fixed in 1 file (#820) but 2 more (`convex-backup-restore-runbook.md`,
   `efficiency-billing-session-prompt.md`) still have it — because the CI check that would catch this
   is diff-scoped to *new* lines, so pre-existing instances are structurally invisible to it.

## Section scorecard

| Section | PASS/Applicable | Compliance | Δ vs round 2 | Worst residual |
|---|---|---|---|---|
| §2 Repo & VC | 6/9 | 66.7% | flat (Critical closed, 3 new Minors) | R-2.5 one stale dependabot PR (Minor) |
| §3 DRY & modularity | 11/12 | 91.7% | ↑ from 75.0% | **R-3.1 recurred in a 4th file (Major)** |
| §4 Dead & stale code | 4/5 | 80.0% | ↓ from 100% | R-4.4 one `@deprecated` marker missing removal condition (Minor) |
| §5 Documentation | 7/8 | 87.5% | ↑ from 75.0% | **R-5.3 recurred in 2 more files (Major)** |
| §6 Dependencies | 8/8 | 100% | ↑ from 87.5% | — |
| §7 Secrets | 4/5 | 80.0% | flat | **R-7.2 still not fixed despite #823 closed (Major)** |
| §15 Exceptions | 3/3 | 100% | flat | — |
| §8.1 Frontend | 6/7 | 85.7% | flat | R-8.1.7 manual WCAG checklist still 2/10 flows (Major) |
| §8.2 Language/type | 3/4 | 75.0% | ↓ from 100% | R-8.2.2 `any`/`ts-ignore` bans are warn-only, unenforced (Minor) |
| §8.3 Backend/DB | 5/7 | 71.4% | flat | **R-8.3.3 unbounded `.collect()` — 665, unchanged 3 rounds running (Major)** |
| §8.4 Auth | 6/6 | 100% | flat | — |
| §8.6 Forms | 4/4 | 100% | flat | — |
| §8.7 UI/styling | 4/4 | 100% | flat (new unrelated instance found) | — |
| §8.8 Testing | 5/5 | 100% | flat | — |
| §8.9 Observability | 5/6 | 83.3% | **↓ from 100%** | **R-8.9.3 two alerts firing unaddressed since 2026-07-22 (Major)** |
| §8.10 Integrations | 4/4 | 100% | ↑ from 50.0% | — |
| §8.11 Web security | 5/5 | 100% | flat | — |
| §8.12 Privacy | 4/4 | 100% | flat | — |
| §9A Efficiency | 5/5 | 100% | flat | — |
| §9B Call efficiency | 6/7 | 85.7% | ↑ from 66.7% | R-9.6 new instance: `api/files/[...path]/route.ts` fetch has no timeout (Minor) |
| §10 CI/CD gates | 4/4 | 100% | flat | — |
| §11 Metrics | 2/3 | 66.7% | (newly scored) | R-11.2 no churn×complexity hotspot tooling (Minor) |
| §12 Quarterly sweep | 1/1 | 100% | flat | — |
| **Overall** | **112/126** | **88.9%** | **↑ from 85.6%** | — |

## Critical: resolved

**R-2.6 — `main` now has branch protection.** Confirmed live: `{"protected": true}`. This closes the
round-2 Critical. Recommend a follow-up check of the exact ruleset (required checks, approval count,
force-push policy) once API access allows enumerating `branches/main/protection` directly — existence
is confirmed, full configuration is not.

## Major findings (grouped, with remediation)

### Recurring — fixed the instance, not the class
- **R-3.1 — site-admin role check recurred in a 4th file.** `src/app/(admin)/admin/users/page.tsx:256`
  still does `user.role === "admin"` instead of the `isSiteAdminRole()` helper (`src/lib/admin-role.ts`)
  that #817's fix created and applied everywhere else. **Fix:** same one-line swap in this file.
- **R-5.3 — stale `npx` commands recurred in 2 more docs.** `docs/convex-backup-restore-runbook.md`
  (3 instances of `npx convex export/import/data`) and `docs/efficiency-billing-session-prompt.md`
  (`npx prisma generate`) still contradict the project's `pnpm exec` convention. #820's fix only
  touched `FEATUREDOCS/02-project-structure.md`. **Root cause:** `scripts/check-docs-npm-npx.mjs` is
  diff-scoped to changed lines only, so pre-existing instances are invisible to it. **Fix:** correct
  both files, then widen the CI check to scan the full repo on every run, not just the diff.
- **R-8.3.3 — 665 unbounded `.collect()` calls, unchanged for the third straight audit.**
  `reservationConflicts.ts` and `crewDashboard.ts` remain unpaginated on org-scoped, growable tables.
  The 223 `r9.8-ok` comments accepting this have no owner/expiry and aren't registered in
  `docs/exceptions.md` — they don't satisfy R-15.1. **Fix:** either actually convert the highest-
  traffic collects to `.paginate()`, or register real, dated, owned exceptions for the ones that
  can't move yet — a bare code comment is not a policy-compliant deferral.

### New this round
- **R-8.9.3 — two PostHog alerts firing continuously, unaddressed, since 2026-07-22.** LCP p75
  (threshold >2000ms, currently 2390-4674ms every day) and `convex_op_latency` p95 (threshold
  >1000ms, currently 1016-1314ms every day) have never once dropped below threshold since data
  started flowing — 3+ days of standing, un-triaged breach. **Fix:** triage whether this is a real
  regression or low-sample-size noise; either fix it, file a tracked ticket, or register a dated
  exception — and add a "current firing state + next-action owner" row to
  `docs/convex-observability-runbook.md` so this doesn't silently recur.
- **R-7.2 — still not fixed despite #823 being closed.** All four previously-flagged `.env.example`
  variables remain undocumented, and — the actual root cause — three of them
  (`NATIVE_EMAIL_SIDEEFFECTS`, `ENABLE_CONVEX_CRONS`, `CONVEX_CRON_TARGET_URL`) were never added to
  `src/env.ts`'s Zod schema either, so nothing in the codebase's own validation surface would catch
  the omission. **Fix:** add all four to `.env.example`, and the three server-side ones to the Zod
  schema so a future omission fails fast instead of silently.
- **R-8.1.7 — manual WCAG checklist still 2 of 10 critical flows**, unchanged since round 2. Both the
  manual leg and the automated leg (limited to `/login` since `e2e-harness` is pulled) are narrow.
  **Fix:** run the deferred 8 flows against staging/harness and log results.

## Minor findings (burn-down)

R-2.4 (Docker release image tagged only `latest`/SHA, never SemVer), R-2.5 (PR #608, a dependabot
TypeScript bump, open 7 days past the 3-day budget), R-2.8 (PR #850 at 531 LOC, over the 400-LOC
SHOULD-target), R-4.4 (`src/server/settings.ts:131`'s `@deprecated` marker has no removal condition),
R-8.2.2 (`any`/`@ts-ignore` bans are ESLint `warn`, not enforced via `--max-warnings 0`), R-9.6
(`api/files/[...path]/route.ts`'s upstream fetch has no timeout — a new instance, distinct from the
two already-fixed round-2 gaps), R-11.2 (no churn×complexity hotspot tooling — newly scored this
round, not previously deep-audited).

## Exception register status

Same five entries as round 2, all still valid and unexpired as of 2026-07-25:

| Rule | Scope | Expiry | Days left |
|---|---|---|---|
| R-8.1.7 | `color-contrast` axe rule only | 2026-10-18 | 85 |
| R-8.11.2 | CSP report-only directives only | 2026-10-18 | 85 |
| R-8.2.2 | `any` lint-ban deferred (ratchet in place) | 2026-10-23 | 90 |
| R-8.8.3 | `e2e-harness` CI job only | 2026-08-22 | 28 |
| R-9.12 | 80%-threshold alerting + monthly review | 2026-10-23 | 90 |

**R-8.8.3 has 28 days left** — the underlying stuck-dialog bug in `harness-revenue-path.spec.ts` is
still unfixed. Flag for the next quarterly sweep.

## Delta vs round 2

**Genuinely closed this round:** R-2.6 (branch protection — the Critical), R-2.1 (CODEOWNERS added),
R-6.3 (dependency-justification check, verified as a real mechanical gate this time), R-8.3.7's
sibling findings in §8.4/§8.6 held at 100%, R-8.7.3 (real `SettingsCard` component, all 14 instances
replaced), R-8.10.3/R-8.10.4 (real retry-with-backoff + test fakes added), R-9.6's two round-1 gaps,
R-9.12's cost-tracking gap (review clause now validly excepted), R-3.10 (glossary added).

**Still open, unchanged:** R-8.3.3 (3 rounds, zero change), R-8.1.7 (2 rounds, still 2/10 flows).

**Closed but recurred elsewhere (same rule, different file):** R-3.1, R-5.3, R-7.2.

**New this round:** R-8.9.3 (standing alerts — a data/operational finding, not a code defect), R-9.6
new instance, R-11.2 (newly scored), R-2.4/R-2.5/R-2.8/R-4.4 (newly surfaced Minors).

## Independence & unverifiables

Each section audited by a separate agent, told not to trust prior reports or issue-closure status.
Live checks performed this round: GitHub branch-protection API (confirmed R-2.6 fixed), `pnpm audit`
(confirmed R-6.6 clean), PostHog alert/insight queries (found the R-8.9.3 regression — this would have
been invisible to a static code read). Not verifiable from available tooling: the exact branch-
protection ruleset detail (required-check list, approval count), R-6.5's historical Dependabot-alert
response-time SLA, and R-10.2's actual measured CI wall-clock time.

*Re-run at the next quarterly sweep, or sooner given the pace of this audit→fix→audit cycle.*
