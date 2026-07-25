# Round 4 Verification Audit

**Date:** 2026-07-25 · **Policy:** [`POLICY.md`](../../POLICY.md) v2.6.2 · **Profile:** `WEB`
**Method:** seven independent AI auditors, one per section-group, each told not to trust prior reports
or issue-closure status — every verdict re-derived from current code, live `pnpm audit`, live GitHub
branch-protection API, live full-history `gitleaks`, and live PostHog alert queries.
**Prior:** round 1 (70.4%) → round 2 (85.6%) → round 3 (88.9%) → 25 issues filed (#851-875) → this round.

> **Headline: 0 Critical · 5 Major · 0 Minor · 96.1% compliant** (123 PASS ÷ 128 applicable
> MUST/SHOULD rules). Up from 88.9%. **Nine of round 3's findings are genuinely fixed** — but the
> two findings that most needed real fixes did not get them, and this round independently discovered
> **two new Major findings that two consecutive prior rounds had missed**, one of them a real
> exploitable trust-boundary gap. The number went up; the risk picture did not uniformly improve.

## What this audit tells us

1. **Nine round-3 findings are genuinely closed, verified in code:** R-2.4 (Docker image now SemVer
   tagged), R-2.5 (stale PR resolved via a valid exception), R-2.6 (branch protection, re-confirmed),
   R-3.1 (the site-admin check recurrence fixed), R-4.4 (deprecation marker fixed), R-7.2 (`.env.example`
   + schema, fixed with sound architectural reasoning for what wasn't added), R-8.1.7 (all 10 manual
   WCAG flows now walked, with a real follow-up issue filed for the one residual gap), R-8.3.7 (stale
   dual-write docs corrected), R-9.6 (the `api/files` timeout gap), R-11.2 (a real hotspot-analysis
   script now exists and runs in the quarterly sweep).
2. **R-5.3 recurred a 4th time — and this round found the actual root cause.** The "widened,
   full-repo" checker script (`scripts/check-docs-npm-npx.mjs`) has two independent regex bugs: it
   can't match ordinary `` `npm run build` `` phrasing at all, and its allowlist checks the whole
   line instead of the specific match, so any line mentioning "pnpm" anywhere gets a free pass even
   if it also contains a bad command. The script reports a false "OK" on 96 files while 6 real
   violations sit uncaught. Three rounds of diff-scoping were only half the problem.
3. **R-8.3.3 is now a 4th-round failure, and the tracked number moved the wrong way.** The unbounded
   `.collect()` count went from 665 (unchanged for 3 rounds) to **671** — up, not down. The mechanism
   was raising the ratchet's baseline to match reality rather than lowering the actual count. Some
   real work did happen underneath (crewDashboard.ts's transaction-volume reads are now genuinely
   indexed), but `reservationConflicts.ts`'s 5 calls remain fully unbounded, and 211 of 225
   `r9.8-ok` comment markers (94%) still have no owner or expiry registered in `docs/exceptions.md`
   — not valid §15 exceptions per R-15.1, no matter how many audits they survive.
4. **Two sections reported clean for two consecutive rounds were not actually clean.** §8.6 and §8.7
   were audited fresh, adversarially, and each turned up a new Major finding this round found that
   rounds 2 and 3 missed:
   - **R-8.6.2 — a real, exploitable trust-boundary gap.** At least 3 Convex "Native" mutation files
     (the Test & Tag feature area, plus part of Sub-Hire) skip the server-side bound-checks that
     ~24 of the other 39 write files correctly implement. Any authenticated org member with the
     right permission can call these mutations directly via a Convex client and write arbitrarily
     long strings or out-of-range numbers — the UI's Zod validation is the only thing currently
     stopping this, and it's client-side.
   - **R-8.7.2/R-8.7.3 — the settings-card duplication pattern recurred elsewhere.** Two
     independently-built `PageHeader` components coexist, unused by anyone; 14 `new`/`edit` pages
     hand-duplicate the same header markup instead. Same defect class round 3 reportedly fixed for
     the settings cards, found again in a different corner of the codebase.

## Section scorecard

| Section | PASS/Applicable | Compliance | Δ vs round 3 | Worst residual |
|---|---|---|---|---|
| §2 Repo & VC | 9/9 | 100% | ↑ from 66.7% | — |
| §3 DRY & modularity | 12/12 | 100% | ↑ from 91.7% | — |
| §4 Dead & stale code | 4/4 | 100% | ↑ from 80.0% | — |
| §5 Documentation | 7/8 | 87.5% | flat | **R-5.3 recurred 4th time; checker script has 2 regex bugs (Major)** |
| §6 Dependencies | 8/8 | 100% | flat | — |
| §7 Secrets | 5/5 | 100% | ↑ from 80.0% | — |
| §15 Exceptions | 3/3 | 100% | flat | — |
| §8.1 Frontend | 7/7 | 100% | ↑ from 85.7% | — |
| §8.2 Language/type | 4/4 | 100% | ↑ from 75.0% | — |
| §8.3 Backend/DB | 6/7 | 85.7% | ↑ from 71.4% | **R-8.3.3 unbounded `.collect()` — 671, UP from 665, 4th round (Major)** |
| §8.4 Auth | 6/6 | 100% | flat | — |
| §8.6 Forms | 3/4 | 75.0% | **↓ from 100%** | **R-8.6.2 real trust-boundary gap in 3+ Native mutation files (Major)** |
| §8.7 UI/styling | 3/5 | 60.0% | **↓ from 100%** | **R-8.7.2/R-8.7.3 duplicate PageHeader + 14-file duplication (Major ×2)** |
| §8.8 Testing | 5/5 | 100% | flat | — |
| §8.9 Observability | 6/6 | 100% (see caveat) | ↑ from 83.3% | — |
| §8.10 Integrations | 4/4 | 100% | flat | — |
| §8.11 Web security | 5/5 | 100% | flat | — |
| §8.12 Privacy | 4/4 | 100% | flat | — |
| §9A Efficiency | 5/5 | 100% | flat | — |
| §9B Call efficiency | 7/7 | 100% | ↑ from 85.7% | — |
| §10 CI/CD gates | 5/5 | 100% | flat | — |
| §11 Metrics | 3/3 | 100% | ↑ from 66.7% | — |
| §12 Quarterly sweep | 1/1 | 100% | flat | — |
| **Overall** | **123/128** | **96.1%** | **↑ from 88.9%** | — |

**§8.9 caveat:** scores 100% because a valid, dated §15 exception now covers R-8.9.3 with a proper
runbook entry — but a live PostHog query at audit time shows **both alerts are still actively
firing** (LCP p75 at 3584ms vs. a 2000ms threshold; `convex_op_latency` p95 at 1172ms vs. 1000ms).
The fix this round was procedural (correctly governed) not substantive (metric still red). Watch
whether the exception gets renewed again in a month with no metric movement — that would just
relocate the "standing ignored alert" problem into the exception register.

## Critical: none

## Major findings

### Persisting, and trending the wrong way
- **R-8.3.3 — unbounded `.collect()` count went UP, 665→671, 4th consecutive round unresolved.**
  The increase came from raising `.collect-ratchet-full-baseline` to match a widened scan scope plus
  "pre-existing drift," not from reducing actual unbounded reads. `reservationConflicts.ts`'s 5 calls
  remain fully unbounded and unpaginated — now backed by a dated exception arguing pagination would
  break cross-project conflict correctness (a defensible but rule-stretching argument, since it isn't
  one of R-8.3.3's three enumerated exemption categories). Genuine partial progress:
  `crewDashboard.ts`'s transaction-volume reads (assignments, time entries) are now bounded via a
  compound index — real work happened, just not enough to move the aggregate number down. 211 of 225
  `r9.8-ok` markers (94%) are still bare comments with no owner/expiry in `docs/exceptions.md` — not
  valid exceptions under R-15.1 regardless of how many rounds they survive.
  **Fix:** stop treating "raise the baseline" as remediation. Either convert `reservationConflicts.ts`
  to a bounded/indexed shape (even a date-window pre-filter before the conflict math) or accept the
  cost of the correctness argument and register it properly; for the 211 bare markers, add real
  `docs/exceptions.md` rows or convert the query — track *unregistered-marker count* as its own
  ratchet metric, since "0 unjustified" is currently measuring marker-presence, not exception-validity.

- **R-5.3 — 4th recurrence, root cause now identified: the checker script itself is broken.**
  `scripts/check-docs-npm-npx.mjs`'s `BAD` regex requires no space before the next character after
  `npm run`, so it can never match real prose; its `ALLOW` regex is evaluated per-line instead of
  per-match, so any line mentioning "pnpm" anywhere whitelists the whole line even if it also
  contains a bad command elsewhere. 6 live violations across `docs/efficiency-billing-session-prompt.md`,
  `docs/designs/rvlt-flow-rebrand-migration.md`, `docs/designs/rvlt-polish-sweep.md`,
  `docs/designs/ux-ui-redesign.md`, `NEWFEATURES/10-user-customisation.md`, and
  `FEATUREDOCS/19-mobile-pwa.md` are currently invisible to CI.
  **Fix:** rewrite `BAD` to `/\bnpm (run|install|ci|test|start|exec)\b/` (word boundary, no
  trailing-`\S` requirement); change `ALLOW` to a per-match proximity check instead of a whole-line
  check. Then fix the 6 files.

### New this round — missed by two prior "100%" rounds
- **R-8.6.2 — real trust-boundary gap, not hypothetical.** `convex/testTagAssetsWrites.ts`,
  `testProfilesWrites.ts`, `testTagRecordsWrites.ts`, and part of `subHiresWrites.ts` skip the
  server-side bound checks (string length, numeric range) that their paired Zod schemas define and
  that ~24 of the other 39 `*Writes.ts` files correctly mirror. These are explicitly documented as
  "Phase 3 browser-direct" mutations — any authenticated org member with `testTag:create`/`update`
  permission can call them directly with a valid Convex client JWT and bypass every client-side
  constraint. **Fix:** add local bound checks (mirroring `convex/lib/fieldGuards.ts` or the working
  pattern in `suppliersWrites.ts`) to each flagged file's string/number args.
- **R-8.7.2/R-8.7.3 — duplicate PageHeader components, 14-file un-extracted duplication.**
  `src/components/ui/page-header.tsx` and `src/components/layout/page-header.tsx` are two
  independently-built components with the same name and different styling, and neither is used by
  the 14 `new`/`edit` pages that instead hand-copy `<h1 className="font-display text-page-title...">`
  verbatim (15 occurrences), plus a second repeated wrapper cluster (15 occurrences). Same defect
  class as the settings-card fix from round 3 — recurred in a different location.
  **Fix:** consolidate to one `PageHeader` (the token-based `layout/page-header.tsx`), migrate the
  14 call sites to use it.

## Delta vs round 3

**Genuinely closed this round, verified in code:** R-2.4, R-2.5 (exception), R-2.6 (reconfirmed),
R-3.1, R-4.4, R-7.2, R-8.1.7, R-8.3.7, R-9.6, R-11.2 — 10 findings.

**Recurred despite being "closed," with root cause now identified:** R-5.3 (4th time — broken
checker script), R-8.3.3 (4th time — number moved wrong direction).

**Newly discovered in sections previously reported clean for 2 rounds:** R-8.6.2, R-8.7.2, R-8.7.3.

**Procedurally resolved but substantively unchanged:** R-8.9.3 (valid exception now covers it;
alerts still firing live).

## Independence & unverifiables

Each section audited by a separate agent, told not to trust prior reports or issue-closure status.
Live checks this round: GitHub branch-protection API (R-2.6 reconfirmed), `pnpm audit` (clean),
full-history `gitleaks` (6 historical matches, verified as doc placeholders in a deleted file, not
real secrets), live PostHog alert queries (found R-8.9.3's alerts still firing despite the exception).
Not independently verifiable this round: R-10.2's actual measured CI wall-clock time, and the exact
branch-protection ruleset detail (required-check list, approval count) — existence confirmed,
full configuration not enumerable from available tooling.

*Re-run at the next quarterly sweep, or sooner given the pace of this cycle.*
