# Codebase Hygiene Policy — Baseline Compliance Audit

**Date:** 2026-07-18 · **Policy:** [`POLICY.md`](../../POLICY.md) v2.6.2 · **Profile:** `WEB`
**Auditor:** Claude Code (AI-assisted, R-14.3) · **Scope:** full repo, all applicable rules §§2–13
**Type:** First audit — establishes the baseline; no prior deltas.

> **Headline: 0 Critical · 34 Major · 28 Minor.**
> **Overall compliance ≈ 43%** (PASS ÷ (PASS+FAIL) over applicable MUST/SHOULD rules; ADVISORY, N/A, and unverifiable rules excluded from the denominator per R-14.2).
> The one Critical-class unknown (R-8.4.3 cross-tenant IDOR) was subsequently **swept exhaustively and cleared** — see below.

## The one-paragraph truth

**The running application is in materially better shape than the score suggests.** The
security-critical runtime posture largely PASSES: server-side authz via one shared guard
(R-8.4.2), the known `by_cuid` cross-tenant IDOR footgun is handled by `requireOrgReadDoc` in
every sampled read (R-8.4.3), server is the authority for prices/validation (R-9.3), no
hand-rolled crypto (R-8.4.1), parameterized queries + sanitized HTML sinks (R-8.11.3), Sentry
scrubs PII before send (R-8.12.4), append-only audit log (R-8.11.4), tested backups (R-8.11.5).
**Almost every Major failure is a *missing control in CI/tooling or missing governance
scaffolding*, not broken product code** — no bundle/a11y/SAST/secret/dep-vuln/dead-code/license
CI gates, no dependency bot, no E2E tests, no CSP/HSTS headers, no PII inventory, no budget
registry, no exception register, plus doc/tooling contradictions (`npm`/`npx` instructions on a
pnpm repo) and un-decommissioned Prisma→Convex migration residue. That makes remediation
mostly **additive** (wire gates, author docs) rather than a code rewrite.

---

## Profile & tool → category mapping (R-14.3)

Profile **WEB** (production Next.js 16 app at flow.rvlt.app). No payment provider → **§8.5 Billing = N/A** (not REG on payment grounds). Personal data present → §8.12 active.

| §8 category | Active? | Repo tooling |
|---|---|---|
| 8.1 Frontend | ● | Next.js 16 App Router (RSC), Tailwind |
| 8.2 Language/type | ● | TypeScript strict (`tsconfig.json`) |
| 8.3 Backend/DB | ● | Convex Cloud (domain SSOT `convex/schema.ts`) + Prisma/Postgres (Better-Auth + audit) |
| 8.4 Auth | ● | Better Auth (`src/lib/auth.ts`) + Convex guard (`convex/lib/auth.ts`, `permissionsCore.ts`) |
| 8.5 Billing | **N/A** | No payment provider in deps |
| 8.6 Forms | ● | React Hook Form + Zod (`src/lib/validations/`) |
| 8.7 UI/styling | ● | Mixed Radix/Base-UI + tokens (DESIGN.md) |
| 8.8 Testing | ● | Vitest (unit + integration) + Playwright (scaffold, 0 E2E) |
| 8.9 Observability | ● | Sentry (`@sentry/nextjs`, `instrumentation*.ts`) |
| 8.10 Integrations | ● | Resend, Google Maps, pdfme, Convex storage |
| 8.11 Web security | ◐→● | `next.config.ts` headers, `src/middleware.ts` |
| 8.12 Privacy | ◐→● | User/client/crew PII in Convex + Postgres |

---

## Scorecard by section

Compliance % = PASS ÷ (PASS+FAIL) over applicable MUST/SHOULD only. Unverifiable & advisory excluded.

| Section | PASS | FAIL | Compliance | Worst finding |
|---|---|---|---|---|
| §2 Repo & version control | 2 | 4 | **33%** | R-2.4 4-part version not SemVer; no root `.editorconfig`/`CONTRIBUTING`/`SECURITY` |
| §3 DRY & modularity | 4 | 6 | **40%** | R-3.6 no complexity lint; R-3.5 no import-lint; R-3.9 naming undeclared |
| §4 Dead & stale code | 1 | 4 | **20%** | R-4.2 no dead-code scanner; R-4.3/4.5 `NATIVE_*` flag + migration residue |
| §5 Documentation | 3 | 5 | **38%** | R-5.3/R-5.8 docs instruct `npm`/`npx` on a pnpm repo |
| §6 Dependencies & supply chain | 1 | 6 | **14%** | R-6.5/6.6/6.7/6.8 no bot, vuln scan, hardening, or license/SBOM |
| §7 Secrets & source access | 3 | 1 | **75%** | R-7.3 no pre-commit/CI secret scanning |
| §8.1 Frontend | 1 | 3 | **25%** | R-8.1.5 no CI bundle gate; R-8.1.7 no axe |
| §8.2 Language/type | 3 | 1 | **75%** | R-8.2.2 `any` not banned/ratcheted (160 sites) |
| §8.3 Backend/DB | 6 | 1 | **86%** | R-8.3.1 no CI schema-drift gate; history drifted |
| §8.4 Auth | 5 | 1 | **83%** | R-8.4.5 cookie flags not asserted in a test |
| §8.6 Forms | 3 | 1 | **75%** | R-8.6.4 no typed handler wrapper (22 API routes) |
| §8.7 UI/styling | 1 | 2 | **33%** | R-8.7.1 no lint ban on hardcoded colors |
| §8.8 Testing | 2 | 2 | **50%** | R-8.8.3 zero E2E, no critical-flows list, not blocking deploy |
| §8.9 Observability | 2 | 3 | **40%** | R-8.9.2 no release tag/sourcemap upload in deploy |
| §8.10 Integrations | 0 | 4 | **0%** | R-8.10.1 no restricted-import; R-8.10.3 vendor responses unvalidated |
| §8.11 Web security | 3 | 1 | **75%** | R-8.11.2 no CSP, no HSTS |
| §8.12 Privacy | 2 | 2 | **50%** | R-8.12.1 no PII inventory; R-8.12.2 no retention/deletion path |
| §9 Efficiency & calls | 3 | 7 | **30%** | R-9.1 budgets exist only on paper; R-9.8 761 unbounded `.collect()` |
| §10 CI/CD gates | 0 | 3 | **0%** | R-10.1 most mandatory gates unwired |
| §11 Metrics | 1 | 1 | **50%** | R-11.1 DORA metrics not tracked at project level |
| §12 Quarterly sweep | 0 | 1 | **0%** | R-12.1 no sweep machinery exists |
| **Overall** | **~46** | **~62** | **~43%** | — |

---

## Critical-class item — R-8.4.3 cross-tenant IDOR: **VERIFIED CLEAN**

The only Critical-class surface received a full site-by-site sweep (not just sampling):

- **584 exported handlers** fetching via `withIndex("by_cuid")`/`("by_modelId")` extracted by a
  brace-matching parser across 276 `convex/*.ts` files — 578 public `query`/`mutation`, 6
  `internal*` (not browser-reachable).
- **Zero handlers with no guard.** Every browser-reachable handler that fetches an
  **arg-supplied** id via a global index either re-checks the row's org (directly via
  `requireOrgReadDoc` / `.filter(d => d.organizationId === orgId)`, or through `*InOrg` helpers:
  `requireProjectInOrg`, `assertUnitInOrg`, `assertModelInOrg`, `requireKitInOrg`,
  `requireSubHireInOrg`, …) or is a `requireService`-gated / self-minted-id path.
- The three public queries guarded only by caller-org `requireOrgRead` (`dashboardActivity.ts:39`,
  `globalSearch.ts:125`, `projectTasks.ts:53`) are safe: their global-index lookups key off ids
  **derived from org-scoped scans**, never off attacker-supplied args — no IDOR surface.

**Verdict: R-8.4.3 PASS (verified, exhaustive).** No cross-tenant read found.

---

## Major findings (34) — grouped by remediation theme

### Theme A — CI/CD security & quality gates absent (10 Major)
The largest single gap. `ci.yml` runs only: brand-guard, lint, typecheck, `pnpm test` (unit), build.

| Rule | Finding | Evidence |
|---|---|---|
| R-10.1 | Mandatory gates unwired: SAST, secret scan, dep-vuln scan, dead-code/unused-dep scan, license check, bundle-size, a11y, integration tests, coverage ratchet | `.github/workflows/ci.yml` |
| R-6.5 | No Renovate/Dependabot config | no `.github/dependabot.yml`/`renovate.json` |
| R-6.6 | No dependency-vulnerability gate at merge | no `pnpm audit`/OSV/Snyk step |
| R-6.7 | No supply-chain hardening: `ignore-scripts`, `minimum-release-age`, GHA actions pinned to digests | `.npmrc`, floating `@v4` tags in workflows |
| R-6.8 | No license allow/deny check + no SBOM | no license/syft/cyclonedx step |
| R-7.3 | No secret scanning (pre-commit Gitleaks + CI) | no `.husky/`/`.pre-commit-config.yaml`/CI job |
| R-4.2 | No dead-code / unused-dependency scanner in CI | no Knip/ts-prune/depcheck |
| R-8.1.5 | No CI bundle-size budget check (T-8 170/300 KB) | no size-limit/bundle-analyzer |
| R-8.1.7 | No axe/Playwright-axe a11y check in CI | no `axe` dependency |
| R-8.9.2 | Release tag + sourcemap upload not in deploy pipeline (upload silently no-ops without `SENTRY_AUTH_TOKEN`; no `SENTRY_RELEASE`) | `build-image.yml:80-87`, `next.config.ts:51` |

### Theme B — Lint gates not wired (4 Major, overlaps A)
One `eslint.config.mjs` change closes several findings.

| Rule | Finding | Evidence |
|---|---|---|
| R-3.6 | No `complexity` rule (NIST ≤10) | `eslint.config.mjs` |
| R-3.5 | No import-lint for cycles/boundaries (dependency-cruiser / `import/*`) | not in CI |
| R-3.9 | Naming conventions neither declared nor `@typescript-eslint/naming-convention`-enforced | no `CONTRIBUTING.md` |
| R-8.2.2 | `any` not lint-banned or ratcheted — 160 `: any`/`as any` in src+convex | e.g. `src/app/(app)/dashboard/page.tsx:68` |

### Theme C — Governance scaffolding not stood up (5 Major)

| Rule | Finding |
|---|---|
| R-0.4 | No budget registry; coverage set to 70% vs T-5 default 80% with no registered rationale (unregistered non-default = failure) |
| R-12.1 | No quarterly-sweep cadence (dead-code burn-down, flag audit, deprecation check, full-history secret sweep, backup-restore, exception review) |
| R-15.2 | No `docs/exceptions.md` exception register while unexceptioned deviations exist |
| §16 | Adoption checklist substantially incomplete: profile undeclared (now fixed in CLAUDE.md), no budget registry, no §8 tool-mapping doc, no critical-flows list, no dep bot |
| R-11.1 | DORA five metrics not tracked at project level (PostHog connected; not evidenced) |

### Theme D — Docs contradict reality (2 Major)

| Rule | Finding | Evidence |
|---|---|---|
| R-5.3 | README uses `npm install`, `npx convex`, `npx prisma` — contradicts pnpm-only repo (CI `pnpm install --frozen-lockfile`) and CLAUDE.md's own "never npx convex" rule | `README.md:102,161,167` |
| R-5.8 | `CLAUDE.md` "Commands" block instructs `npm run dev/build/test` + `npx prisma` on a pnpm project | `CLAUDE.md` |

### Theme E — Migration residue & DRY debt (3 Major)

| Rule | Finding | Evidence |
|---|---|---|
| R-3.1 | Two hand-maintained line-item money-math definitions kept "in parity" (native `convex/lib/recalc.ts` + legacy `src/server/line-items.ts`) | `convex/lineItemWrites.ts:1207` |
| R-4.3 | `NATIVE_*` feature flags (7+) have no owner/expiry/removal condition | `src/lib/native-writes.ts`, `convex/*` |
| R-4.5 | Prisma→Convex superseded write paths retained without a scheduled removal task or dated R-4.4 marker | `src/server/*` + `convex/*Writes.ts` dual paths |

### Theme F — Adapter discipline & input validation (4 Major)

| Rule | Finding | Evidence |
|---|---|---|
| R-8.10.1 | No `no-restricted-imports` fence; Resend/Sentry/Google-Maps SDKs imported across multiple files, not one adapter each | `src/lib/email.ts`, `convex/emailActions.ts`, maps components |
| R-8.10.3 | Vendor responses (Resend, Google Maps) not schema-validated | `src/lib/email.ts`, `address-input.tsx:84` |
| R-8.6.4 | No typed handler wrapper requiring a schema; 22 `app/api/**/route.ts` handlers validate at discretion | `src/app/api/**` |
| R-6.2 | Runtime not pinned in-repo; CI Node 20 vs `Dockerfile` Node 22 (env skew) | `ci.yml:34`, `Dockerfile:1` |

### Theme G — Backend, web-security & privacy hardening (6 Major)

| Rule | Finding | Evidence |
|---|---|---|
| R-8.3.1 | No CI schema-drift gate; Prisma history admittedly drifted (early tables via `db push`, never captured as migrations) | `ci.yml` build-job note |
| R-8.11.2 | No Content-Security-Policy and no HSTS header anywhere (XCTO/Referrer/X-Frame set) | `next.config.ts` headers |
| R-8.12.1 | No PII data inventory in-repo (app stores user email, `crewMembers.icalToken`, client phone) | — |
| R-8.12.2 | No registered PII retention (T-P2) and no verifiable user-deletion/erasure path | — |
| R-8.8.3 | Playwright is a zero-test scaffold (`./e2e` dir absent); no critical-flows list; E2E not blocking deploy | `playwright.config.ts:5` |
| R-9.8 | 761 unbounded `.collect()` vs 33 paginated reads on growable Convex tables (also implicates R-8.3.3) | `convex/*.ts` |

### Theme H — Efficiency budgets on paper only (1 Major)

| Rule | Finding |
|---|---|
| R-9.1 | Machine-enforceable budgets (bundle KB, CWV, coverage ratchet, latency, cost, queue lag) have no CI/monitoring enforcement — "document only" is explicitly non-compliant. Root cause of R-8.1.5, R-8.7.5, R-9.11, R-9.12. |

---

## Minor findings — burn-down list (28)

Owner column blank = **unassigned** (assign at next planning). All Minor = burn-down, non-blocking.

| Rule | Finding | Owner |
|---|---|---|
| R-2.1 | Missing `.editorconfig`, `CONTRIBUTING.md`, `SECURITY.md` at root | |
| R-2.2 | README missing profile declaration, test command, "where docs live" | |
| R-2.3 | CHANGELOG has no `## [Unreleased]` section | |
| R-2.4 | 4-part version `0.24.17.0` is not valid SemVer (3 identifiers) | |
| R-5.4 | No ADRs (Context/Decision/Consequences) in-repo | |
| R-5.5 | Docs lack owner + last-reviewed-date metadata | |
| R-5.7 | No CI link checker | |
| R-10.4 | GHA actions pinned to floating tags, not digests | |
| R-10.5 | No OpenSSF Scorecard workflow | |
| R-11.1 | (also Major-tracked) DORA metrics | |
| R-3.7 | No `max-lines`/`max-lines-per-function` lint; 25+ files >400 lines (largest `warehouse/[projectId]/page.tsx` 3219) | |
| R-3.10 | No in-repo glossary despite many domain terms | |
| R-4.4 | Compat shims (`src/server/line-items.ts`, `uploadToS3`) lack `@deprecated` + removal condition | |
| R-6.4 | Unused-dependency scanner absent (control missing) | |
| R-8.10.2 | Stale adapter names: `uploadToS3`/`deleteFromS3` route to Convex; PDF plugin files still `gearflow-*` | |
| R-8.10.4 | Storage/Maps/Sentry adapters have no fake/local test implementation | |
| R-8.1.4 | `next/image` unused (0); 7 raw `<img>` tags bypass optimization | |
| R-8.7.1 | Hardcoded hex colors outside token file (`address-map-inner.tsx:77-79`, `dynamic-favicon.tsx:53`) | |
| R-8.7.5 | CSS not in an enforced size budget | |
| R-8.8.2 | Coverage threshold 70% (< 80%), not run in CI (`pnpm test`, not `test:coverage`), not ratcheted | |
| R-8.9.5 | No structured/JSON logger with propagated correlation/request ID | |
| R-8.9.6 | No per-endpoint p95 SLOs (T-P6); no dashboard owners | |
| R-8.4.5 | Cookie flags correct but not asserted in an integration test | |
| R-9.2 | No 80%-of-budget alerting (follows R-9.1) | |
| R-9.6 | Outbound calls without explicit timeout: `email.ts` (Resend), `sso.ts` fetch, `storage.ts` fetch (webhooks adapter is exemplary) | |
| R-9.10 | No registered queue lag/age alert threshold (T-P7) | |
| R-9.11 | Interactive-endpoint SLOs (T-P6) unregistered | |
| R-9.12 | Google Maps (metered) has no registered monthly cost budget (T-P4) | |

---

## Unverifiable — needs out-of-repo checks (not scored)

| Rule | Item | How to verify |
|---|---|---|
| R-2.6 | Branch protection, merged-branch deletion | GitHub → Settings → Branches |
| R-7.1 | Full git-history secret sweep | TruffleHog/BFG over the pack |
| R-8.4.2 | "No unauthenticated mutation reachable" | Enumerate every `convex/*Writes.ts` + `src/server/*` write for guard presence |
| R-8.11.2 | Live edge headers | `curl -I https://flow.rvlt.app` (Coolify/CDN could inject) |
| R-8.1.5 / T-7 | Live CWV p75 | Prod RUM / PostHog |
| R-8.9.4 / T-13 | Crash-free rate ≥99.5% | Sentry |
| R-11.1 | DORA metrics | PostHog / external dashboards |

---

## Next-step recommendations (highest leverage first)

1. **Close the CI gap (Theme A).** One `ci.yml` expansion + a few config files unwires ~10 Major findings: add Gitleaks (pre-commit + CI), `pnpm audit`/OSV, Knip, license check, size-limit bundle budget, axe, and run integration + `test:coverage` (ratcheted). Add Dependabot/Renovate. Pin GHA actions to digests and set `.npmrc` `ignore-scripts` + `minimum-release-age`.
2. **Wire the lint gates (Theme B).** Add `complexity`, `max-lines`, `@typescript-eslint/no-explicit-any` (with a ratchet), `naming-convention`, and import-boundary rules to `eslint.config.mjs`.
3. **Stand up governance (Theme C).** Create `docs/exceptions.md`, a budget-registry + §8 tool-mapping section in README/POLICY, a critical-flows list, and schedule the quarterly sweep. (Profile is already declared in CLAUDE.md as part of this adoption.)
4. **Fix the security headers + PII gaps (Theme G).** Add CSP + HSTS in `next.config.ts`; author a PII inventory + retention/deletion path doc; add a CI schema-drift check.
5. **~~Finish the IDOR sweep~~ — DONE.** R-8.4.3 swept exhaustively and cleared; no cross-tenant read. Add a regression test asserting the guard pattern to keep it closed.
6. **Write E2E for auth + the revenue path (R-8.8.3)** and make it deploy-blocking.
7. **Resolve doc contradictions now (Theme D, cheap).** Replace `npm`/`npx` with `pnpm`/`pnpm exec` in README + CLAUDE.md.
8. **Retire migration residue (Theme E).** Give each `NATIVE_*` flag an owner+expiry; mark or delete legacy write paths; unify the duplicated money-math definition.

---

*This is the baseline. Re-run each quarter (R-12.1); future reports record deltas vs this one. Per R-14.2 no secret values are reproduced — findings cite locations only.*
