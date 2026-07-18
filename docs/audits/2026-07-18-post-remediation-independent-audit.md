# Independent Compliance Audit (Post-Remediation)

**Date:** 2026-07-18 · **Policy:** [`POLICY.md`](../../POLICY.md) v2.6.2 · **Profile:** `WEB`
**Method:** five independent AI auditors, one per section-group, assessing the *current* merged
state (PR #601) against POLICY.md — **not told what was changed** (unbiased re-measurement).
**Prior:** `2026-07-18-hygiene-policy-baseline-audit.md` (baseline: 0 Critical, 34 Major, 28 Minor, ~43%).

> **Headline: 0 Critical · ~22 Major · ~35 Minor · ≈49% compliant** (PASS ÷ (PASS+FAIL) over
> applicable MUST/SHOULD; N/A, ADVISORY, and unverifiable excluded). Up from ~43%.
> The security-critical runtime posture remains clean: **cross-tenant IDOR (R-8.4.3) sampled clean**
> (guard discipline intact), server-side authz (R-8.4.2), no client-priced money (R-9.3), no raw
> SQL / sanitized HTML sinks (R-8.11.3), PII scrubbed from Sentry (R-8.12.4).

## What the independent audit tells us

The remediation wave **landed and is verified** — but an unbiased re-audit is stricter than the
baseline and surfaces both incomplete fixes and pre-existing debt the baseline under-counted. Three
honest takeaways:

1. **Most baseline Majors are closed or downgraded** — governance scaffolding, dependency bot +
   blocking vuln gate, lint gates, root files, PII inventory, E2E+a11y in CI, HSTS.
2. **Two of my own remediations were incomplete** (caught by the independent auditors):
   - **R-5.3 (Major):** the npm→pnpm doc sweep **missed `ARCHITECTURE.md`** (still has an `npm run`/`npx prisma` "Commands" block) and **`AGENTS.md:11`** (`npx convex`). README + CLAUDE.md are clean.
   - **R-8.11.2 (Major):** CSP is **report-only**, so it provides no active protection yet — the rule wants an *enforcing* CSP (or a §15 exception for the rollout). HSTS is enforced.
3. **Deep pre-existing structural debt dominates the residual Majors** — mostly efficiency/frontend
   the baseline rated generously: 797 `.collect()` vs 6 `.paginate()` (R-9.8), zero `next/image`
   (R-8.1.4), unstructured logging with no correlation ID (R-8.9.5), Zod↔Convex validation
   duplication (R-8.6.1), and several CI gates that exist but run **advisory** (`continue-on-error`)
   rather than blocking.

## Delta vs baseline (Major findings)

| Baseline Major | Now | Note |
|---|---|---|
| Root files missing (R-2.1) | ✅ CLOSED | `.editorconfig`/`SECURITY.md`/`CONTRIBUTING.md` added |
| README incomplete (R-2.2) | ✅ CLOSED | profile + docs map + test cmd |
| No exception register (R-15.2) | ✅ CLOSED | `docs/exceptions.md` (empty, valid) |
| No dependency bot (R-6.5) | ✅ CLOSED | `dependabot.yml` |
| Known high vulns / no gate (R-6.6) | ✅ CLOSED | 6 high → 0; blocking `pnpm audit` gate |
| No PII inventory (R-8.12.1) | ✅ CLOSED | `docs/pii-inventory.md` |
| No complexity/length/any/naming lint (R-3.6/3.7/8.2.2/3.9) | ✅ CLOSED→PASS / ⚠️ partial | warn-level satisfies "registered in lint config" (R-3.6/3.7 PASS); R-8.2.2 ratchet + `@ts-ignore` ban still open (Minor); R-3.9 lint partial (Minor) |
| No dead-code scanner (R-4.2) | ⬇️ DOWNGRADED | Knip added but **advisory** — Minor now |
| No a11y in CI (R-8.1.7) | ⬇️ DOWNGRADED | axe blocking in CI but covers 1 page — Minor now |
| No E2E / zero-test scaffold (R-8.8.3) | ⚠️ PARTIAL | E2E blocking in CI, but 1/10 flows (revenue path uncovered) — still Major |
| Version skew (R-6.2) | ✅ CLOSED (via #603) | pnpm 11 + Node 22 pinned everywhere incl. Dockerfile |
| Docs contradict code (R-5.3/5.8) | ⚠️ PARTIAL | README/CLAUDE fixed; **ARCHITECTURE.md + AGENTS.md still npm** — still Major |
| No security headers (R-8.11.2) | ⚠️ PARTIAL | HSTS enforced; **CSP report-only, not enforcing** — still Major |
| No budget registry (R-0.4) | ⚠️ PARTIAL | README registry added; 5 §13B thresholds still unregistered — still Major |
| CI gates missing (R-10.1) | ⚠️ PARTIAL | added vuln(blocking)/e2e/a11y/secret/deadcode/bundle; **SAST + license still absent**; secret/deadcode/bundle **advisory** — still Major |
| No quarterly sweep (R-12.1) | ❌ OPEN | no recurring cadence stood up |

## Section scorecard (current)

| Section | Compliance | Worst residual |
|---|---|---|
| §2 Repo/VCS | ~80% | R-2.4 4-part version ≠ SemVer (Minor) |
| §3 DRY/modularity | ~55% | R-3.5 no import-cycle/boundary lint (Major) |
| §4 Dead/stale | ~40% | R-4.3/4.4/4.5 `NATIVE_*` flags/shims lack owner/expiry/markers |
| §5 Docs | ~33% | **R-5.3 ARCHITECTURE.md still npm** (Major) |
| §6 Deps/supply | ~40% | R-6.8 no license/SBOM (Major); committed `apps/discord-bot/node_modules` (R-6.1) |
| §7 Secrets | ~75% | R-7.3 no pre-commit layer; CI gitleaks advisory + tree-only (Major) |
| §8.1 Frontend | ~30% | R-8.1.4 no `next/image`; R-8.1.5 bundle gate advisory (Major) |
| §8.2 Types | ~75% | R-8.2.2 `any` ratchet unenforced (Minor) |
| §8.3 Backend/DB | ~85% | R-8.3.1 schema drift, no CI drift gate (Major) |
| §8.4 Auth | ~90% | R-8.4.5 cookie flags not asserted in a test (Minor) |
| §8.6 Forms | ~50% | R-8.6.1 Zod↔Convex validation duplication (Major) |
| §8.7 UI/styling | ~60% | R-8.7.1 no color-literal lint (Major) |
| §8.8 Testing | ~50% | R-8.8.2 coverage 70%, not run in CI; R-8.8.3 E2E 1/10 flows (Major) |
| §8.9 Observability | ~55% | R-8.9.5 unstructured logging, no correlation ID (Major) |
| §8.10 Integrations | ~0% | R-8.10.1/3 no restricted-import lint, vendor responses unvalidated |
| §8.11 Web security | ~75% | R-8.11.2 CSP report-only (Major) |
| §8.12 Privacy | ~60% | R-8.12.2 no retention/deletion path (Major) |
| §9 Efficiency | ~30% | **R-9.8 797 `.collect()` vs 6 `.paginate()`** (Major); R-9.1 advisory budgets |
| §10 CI/CD | ~30% | R-10.1 SAST+license absent; gates advisory (Major) |
| §11 Metrics | ~50% | R-11.1 DORA not evidenced in-repo (unverifiable) |
| §12 Quarterly sweep | 0% | R-12.1 no cadence (Major) |

## Residual Major findings (grouped)

**Incomplete remediations (fix next — cheap):**
- R-5.3 — `ARCHITECTURE.md` "## Commands" block + `AGENTS.md:11` still use `npm`/`npx` on a pnpm repo.
- R-8.11.2 — CSP is report-only; promote to enforcing (nonce the two `'unsafe-inline'`) or register a §15 exception; add a header-assertion test.
- R-0.4 — register the 5 applicable §13B thresholds (T-P1 audit-log retention, T-P2 PII retention, T-P4 Maps cost, T-P6 endpoint SLOs, T-P7 queue lag).
- R-8.8.2 — raise coverage to 80% and run `test:coverage` (ratcheted) in CI.

**CI gates: make advisory blocking / add the missing ones:**
- R-10.1 — add SAST (CodeQL/Semgrep) + a license check; flip Knip/gitleaks/size-limit from advisory to blocking once their burn-down clears; wire integration tests.
- R-7.3 — add a pre-commit secret-scan layer (husky + gitleaks) and a scheduled full-history sweep.
- R-4.2 — make Knip blocking (it's advisory).
- R-3.5 — add an import-cycle/boundary linter (dependency-cruiser) in CI.

**Pre-existing structural debt (larger):**
- R-9.8 — 797 `.collect()` on growable Convex tables; paginate/bound them (also R-8.3.3).
- R-8.1.4 — adopt `next/image`; R-8.1.5/R-9.1 — make the bundle budget blocking + add CWV.
- R-8.9.5 — introduce a structured logger with a propagated correlation ID.
- R-8.6.1 — collapse the Zod↔Convex duplicated validation to one source.
- R-8.7.1 — lint-ban hardcoded color/spacing literals.
- R-8.3.1 — repair the Prisma migration history + add a CI drift gate.
- R-8.12.2 — build a user-erasure workflow + register per-class retention.
- R-9.6 — add explicit timeouts to `storage.ts`/`sso.ts` fetches; jitter the webhook backoff.
- R-6.8 — add a license/SBOM step; R-6.1 — remove the committed `apps/discord-bot/node_modules` tree.
- R-12.1 — stand up the quarterly sweep as a scheduled workflow.

## Notable Minor (burn-down)
R-2.4 (4-part version), R-4.3/4.4/4.5 (`NATIVE_*` flag/shim bookkeeping), R-5.4 (no ADRs), R-5.5 (core docs lack owner/date), R-5.7 (no link checker), R-6.4 (unused deps), R-6.7 (no min-release-age base, actions not digest-pinned), R-8.4.5 (cookie-flag test), R-8.9.2 (sourcemap/release not enforced in pipeline), R-9.7/9.9/9.10/9.11/9.12 (concurrency/caching/queue/SLO/cost budgets unregistered), R-8.10.2/3/4 (adapter naming/validation/fakes).

## Independence & unverifiables
Each section was audited by a separate agent given only POLICY.md, the profile, and its section
list — no knowledge of the remediation. Not verifiable from the repo (excluded from scoring):
branch protection (R-2.6), git-history secret sweep (R-7.1), DORA dashboards (R-11.1, PostHog),
live CWV/crash-free (R-8.1.5/R-8.9.4), live header values (R-8.11.2 via curl), exhaustive IDOR
sweep of all 1,173 `by_cuid` sites (sampled clean).

*Re-run at the next quarterly sweep (R-12.1); future reports record deltas vs this one.*
