# Remediation Verification Audit

**Date:** 2026-07-23 · **Policy:** [`POLICY.md`](../../POLICY.md) v2.6.2 · **Profile:** `WEB`
**Method:** seven independent AI auditors, one per section-group, each given only POLICY.md, the
profile, and its section list — **explicitly instructed not to read the prior report or trust the
"closed" status of any GitHub issue**, and to re-derive every verdict from the current code, live
`pnpm audit`/GitHub-API/PostHog checks where applicable. Audited against `main` @ `fdf28a45` plus
this branch's one docs commit (all §9-§12 remediation PRs #809-#816 merged).
**Prior:** `2026-07-22-full-compliance-audit.md` (0 Critical, 23 Major, 14 Minor, 70.4%) → 37
findings filed as GitHub issues, all 52 issues (37 findings + 15 tracking) closed within ~8 hours.

> **Headline: 1 Critical · 8 Major · 9 Minor · 85.6% compliant** (107 PASS ÷ 125 applicable
> MUST/SHOULD rules; N/A and ADVISORY excluded per §14.2). Up from 70.4%.
> Most of the prior round's findings are **genuinely fixed, verified in code** — not just
> doc-claimed. But one **new Critical finding** surfaced that no prior audit caught: `main` has no
> branch protection. And one prior Major (`R-8.3.3`, unbounded reads) shows **zero net progress**
> despite its issue being closed.

## What this audit tells us

1. **Most remediation is real.** Independently re-derived, not trusted: the WooCommerce webhook
   validation, the duplicated-type cleanup, the N+1 fix in `crewDashboard.ts`, the kit-by-cuid
   consolidation (48 call sites now share one helper), site-admin authz consolidation, the
   Tailwind-arbitrary-value color-lint fix, the dead combobox primitive deletion, the email-HTML
   escaping (traced field-by-field with a regression test), the Postgres backup+restore drill, and
   all of §8.9 Observability (error context, request-ID propagation, Convex job error capture,
   trace correlation) all check out under adversarial re-verification.
2. **One finding was closed without being fixed.** `R-8.3.3` (unbounded `.collect()` reads):
   the count is **665, identical to the prior audit** — zero reduction. The "fix" narrowed the CI
   ratchet's scope and added 223 `r9.8-ok` comment markers accepting the status quo on tables that
   are genuinely org-scoped and growable (e.g. `reservationConflicts.ts` still collects an entire
   org's assets/projects/line-items per conflict check). The issue is closed; the underlying risk
   is not reduced.
3. **A new Critical finding, missed by every prior audit round: `main` has no branch protection.**
   `protected: false` via a live GitHub API call — no required reviews, no required status checks,
   no force-push block. Every CI gate and review norm this repo documents is currently advisory,
   not enforced, until this is turned on. Prior audits marked this "unverifiable"; this round
   actually called the API.
4. **A few fixes are real but partial**, not full closures: R-2.5 branch hygiene (371 branches →
   24, but 20 of the 24 remaining are still past the 3-day budget), R-9.12 cost budgets (usage
   tracking covers most but not all paths, and the monthly-review clause isn't operative), R-8.1.7
   manual WCAG checklist (2 of 10 critical flows walked, not all 10), and R-8.10.3/8.10.4 (retry
   policy and test fakes exist on the newer code paths but not the older/default ones).

## Section scorecard

| Section | PASS/Applicable | Compliance | Δ vs 07-22 | Worst residual |
|---|---|---|---|---|
| §2 Repo & VC | 6/9 | 66.7% | ↓ from 77.8% | **R-2.6 no branch protection on main (Critical)** |
| §3 DRY & modularity | 9/12 | 75.0% | ↓ from 91.7% | R-3.1 client-side admin check duplicated 3× (Major) |
| §4 Dead & stale code | 5/5 | 100% | flat | — |
| §5 Documentation | 6/8 | 75.0% | flat | R-5.3 stale `npx prisma generate`, survived a same-day "review" (Major) |
| §6 Dependencies | 7/8 | 87.5% | flat | R-6.3 no PR-template justification check (Minor) |
| §7 Secrets | 4/5 | 80.0% | ↓ from 100% | R-7.2 `.env.example` missing 4 real vars (Minor) |
| §15 Exceptions | 3/3 | 100% | flat | — |
| §8.1 Frontend | 6/7 | 85.7% | ↑ from 71.4% | R-8.1.7 manual WCAG checklist 2/10 flows (Minor) |
| §8.2 Language/type | 4/4 | 100% | ↑ from 25.0% | — |
| §8.3 Backend/DB | 5/7 | 71.4% | ↑ from 57.1% | **R-8.3.3 unbounded `.collect()` — 665, unchanged (Major)** |
| §8.4 Auth | 6/6 | 100% | ↑ from 50.0% | — |
| §8.6 Forms | 4/4 | 100% | ↑ from 0% | — |
| §8.7 UI/styling | 4/5 | 80.0% | ↑ from 20.0% | R-8.7.3 settings-card class cluster duplicated 14× (Major) |
| §8.8 Testing | 5/5 | 100% | ↑ from 75.0% | — |
| §8.9 Observability | 6/6 | 100% | ↑ from 20.0% | — |
| §8.10 Integrations | 2/4 | 50.0% | ↑ from 25.0% | R-8.10.3 default email/storage paths have no retry (Major) |
| §8.11 Web security | 5/5 | 100% | ↑ from 60.0% | — |
| §8.12 Privacy | 4/4 | 100% | flat | — |
| §9A Efficiency | 5/5 | 100% | flat | — |
| §9B Call efficiency | 4/6 | 66.7% | ↓ from 71.4% | R-9.6 new timeout gap in `errorReporting.ts`; R-9.12 partial fix (Major ×2) |
| §10 CI/CD gates | 4/4 | 100% | flat | — |
| §11 Metrics | 2/2 scored | 100% | flat | — |
| §12 Quarterly sweep | 1/1 | 100% | flat | — |
| **Overall** | **107/125** | **85.6%** | **↑ from 70.4%** | — |

## Critical finding

**R-2.6 — `main` has no branch protection.** Confirmed via `mcp__github__list_branches`:
`{"name":"main", "protected":false}`. No required reviews, no required status checks, no
force-push/direct-push restriction. Corroborating evidence: recent PRs (#810-#813) were opened and
merged by the same author within minutes with no visible independent review — consistent with an
unenforced merge path. **This is the single highest-leverage fix available**: every lint/type/test/
security gate this repo has built is advisory, not binding, until this is turned on.

**Fix:** enable branch protection on `main` — require PR review, require the `lint`/`typecheck`/
`test`/`hygiene`/`build` status checks to pass, disallow force-push and direct pushes. This is a
GitHub repo-settings change, not a code change — outside what a commit/PR can fix directly.

## Major findings (grouped, with remediation)

### Closed but not actually fixed
- **R-8.3.3 — unbounded `.collect()` reads: 665, unchanged from the prior audit.** The remediation
  narrowed the CI ratchet to only "pure org-index, whole-table" shapes (222 of 665) and marked the
  rest `r9.8-ok: reviewed, accepted tradeoff — revisit if rows grow large` — including on tables
  that are already per-org and growable (`reservationConflicts.ts`'s conflict check collects the
  entire org's `assets`/`projects`/`projectLineItems` on every call). Only 6 `.paginate()` calls
  exist in all of `convex/`. **Fix:** convert the highest-traffic org-wide collects
  (`reservationConflicts.ts`, `crewDashboard.ts`'s five-table `crewGraph()`) to `.paginate()` or a
  bounded/indexed narrowing; track the ratchet against the full 665, not the narrower 222.

### New this round
- **R-9.6 — new timeout gap.** `convex/lib/errorReporting.ts:36`'s outbound PostHog `fetch()` has
  no `AbortController`/timeout — the two originally-cited gaps (Convex cron `fetch`, read-retry
  jitter) are fixed, but this third call site wasn't part of that sweep. Also: `resend.emails.send()`
  has no explicit timeout (the SDK exposes none by default). **Fix:** wrap both in the same
  timeout pattern already proven in `scheduledJobs.ts`.
- **R-9.12 — partial fix.** Usage tracking is real for the direct Resend/Maps paths but misses the
  Convex-scheduled email send path; the alerting gap is validly excepted (expires 2026-10-23), but
  the "reviewed monthly with a named owner" clause isn't operative and isn't covered by the
  exception's stated scope. **Fix:** extend usage tracking to `convex/emailActions.ts`'s `deliver`,
  and either stand up the monthly review now or extend the exception to explicitly cover it.
- **R-8.7.3 — settings-page card wrapper duplicated 14×.** `"rounded-lg bg-bg-surface p-5
  surface-ring sm:p-6"` is hand-copied across 8 settings pages, several of which already import
  `FormSection` from `page-layouts.tsx` for other content on the same page — the wrapper just isn't
  part of the component yet. **Fix:** move the wrapper styling into `FormSection` itself; replace
  the 14 call sites.
- **R-8.10.3 — default email/storage adapters have no retry.** Only the newer, gated
  Convex-scheduled email path (`emailActions.ts`, behind `NATIVE_EMAIL_SIDEEFFECTS`) got
  retry+idempotency; `src/lib/email.ts`/`storage.ts` — the path auth/invitation/SSO flows actually
  use — still throw immediately on a transient failure. **Fix:** either migrate all sends through
  the Convex-scheduled path, or add a small bounded-retry wrapper to the direct-send functions.
- **R-3.1 — client-side admin-role check duplicated 3×**, despite `admin-auth.ts`'s docstring and a
  CHANGELOG entry both declaring this consolidation complete. `user-nav.tsx:33` and
  `account/page.tsx:373,419` still hand-roll `role === "admin"`. *Mitigating context from the §8.4
  audit*: this is client-side nav-hiding UX only — the actual authorization boundary is
  server-enforced via `AdminLayout` and `admin-auth.ts`'s shared guard, so there is no live
  privilege-escalation risk. It remains a real R-3.1 DRY defect (duplicated knowledge, even if
  currently in sync) and a factually incorrect changelog claim. **Fix:** export a trivial
  `isSiteAdminRole()` helper and replace the three inline comparisons.
- **R-5.3 — stale command survived a same-day "last reviewed" stamp.**
  `FEATUREDOCS/02-project-structure.md:62` says `npx prisma generate`, contradicting the project's
  own `pnpm exec prisma generate` convention — and its header claims `Last reviewed: 2026-07-23`
  (today), suggesting the R-5.5 doc-review sweep bulk-stamped dates without verifying content. All
  51 FEATUREDOCS files share today's date, which is itself worth a second look. **Fix:** one-line
  correction; consider spot-auditing a sample of the other 50 "reviewed today" docs for the same
  pattern.
- **R-2.5 — branch cleanup real but incomplete.** 371 branches → 24 (a genuine ~94% reduction), but
  20 of the remaining 24 are unmerged and past the 3-day T-16 budget, oldest 131 days
  (`feature/model-accessories`). **Fix:** merge or delete each; file a dated §15 exception for any
  that must legitimately persist.

## Minor findings (burn-down)

R-2.1 (no CODEOWNERS despite active PR routing), R-3.6 (`complexity` lint is warn-only, no ratchet
or exception — unlike the equivalent `any` rule), R-3.10 (no glossary despite a large multi-domain
vocabulary), R-5.1 (one ownerless, unlinked external doc reference), R-6.3 (no PR-template check
for new-dependency justification), R-7.2 (`.env.example` missing 4 vars that are actually read:
`NATIVE_EMAIL_SIDEEFFECTS`, `NEXT_PUBLIC_SITE_ADMIN_REG_ENABLED`, `ENABLE_CONVEX_CRONS`,
`CONVEX_CRON_TARGET_URL`), R-8.1.7 (manual WCAG checklist covers 2 of 10 critical flows, not all),
R-8.3.7 (three read-modules still document a Prisma dual-write that no longer exists),
R-8.10.4 (no test fake for the storage or PostHog adapters, only maps/email got fakes).

## Exception register status

Five entries in `docs/exceptions.md`, all unexpired as of 2026-07-23:

| Rule | Scope | Expiry |
|---|---|---|
| R-8.1.7 | `color-contrast` axe rule only | 2026-10-18 |
| R-8.11.2 | CSP report-only directives only | 2026-10-18 |
| R-8.2.2 | `any` lint-ban deferred (ratchet in place) | 2026-10-23 |
| R-8.8.3 | `e2e-harness` CI job only | 2026-08-22 |
| R-9.12 | 80%-threshold alerting only (usage tracking not exempted) | 2026-10-23 |

All five are correctly scoped to a specific clause/gate, not blanket carve-outs, and each names a
concrete interim control. **R-8.8.3 expires in 30 days** — flag for the next quarterly sweep to
confirm the underlying stuck-dialog bug is fixed or the exception is renewed with updated reasoning.

## Delta vs the 2026-07-22 audit

**Genuinely closed** (verified in code, not just doc-claimed): R-8.2.3, R-8.2.4, R-8.3.2, R-8.3.4,
R-8.4.2, R-8.4.4, R-8.6.1, R-8.6.2, R-8.7.1, R-8.7.2, R-8.7.4, R-8.9.1, R-8.9.4, R-8.9.5, R-8.9.6,
R-8.11.3 (top-priority email-HTML-injection), R-8.11.5 (Postgres backup + real restore drill),
R-6.6 (unpatched `next` CVE).

**Closed but not actually fixed:** R-8.3.3 (`.collect()` count unchanged at 665).

**Closed with partial/incomplete fixes:** R-2.5 (94% branch reduction, 20 still stale), R-9.6
(2 of 3 gaps fixed, a 3rd found this round), R-9.12 (tracking mostly wired, review clause open),
R-8.1.7 (2 of 10 manual checks done), R-8.10.3/R-8.10.4 (fixed on new paths, not old ones).

**New, not on the prior list:** R-2.6 (branch protection — Critical), R-3.1 (client-side check
regression vs a changelog claim), R-5.3 (different stale-doc instance), R-8.7.3 (new duplication
instance), R-6.3, R-7.2 (new Minor hygiene gaps).

## Independence & unverifiables

Each section was audited by a separate agent given only POLICY.md, the profile, and its section
list — explicitly told not to read the prior report or trust any issue's "closed" status. Several
findings above were confirmed via *live* checks rather than static reading: a real `pnpm audit`
run (§6), the GitHub branch-protection API (§2 — this is what caught the Critical), and direct
PostHog alert/insight queries (§8.9, §9B). Not independently verifiable from the repo alone: a full
re-run of the CI flakiness fix referenced in the R-8.8.3 exception (accepted as documented, not
reproduced), exhaustive coverage of all ~40 `use-*-writes.ts` hooks for the R-8.6.1 validation-parity
pattern (12 of 41 sampled, extrapolated as PASS with an advisory note).

*Re-run at the next quarterly sweep (`.github/workflows/quarterly-sweep.yml`); future reports
record deltas vs this one.*
