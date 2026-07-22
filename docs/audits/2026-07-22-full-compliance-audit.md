# Full Compliance Audit

**Date:** 2026-07-22 · **Policy:** [`POLICY.md`](../../POLICY.md) v2.6.2 · **Profile:** `WEB`
**Method:** seven independent AI auditors, one per section-group, each given only POLICY.md, the
profile, and its section list — **not shown prior audit reports** (unbiased re-measurement of the
current repo state, same methodology as `2026-07-18-post-remediation-independent-audit.md`).
**Prior:** baseline `2026-07-18-hygiene-policy-baseline-audit.md` (0 Critical, 34 Major, 28 Minor,
~43%) → post-remediation `2026-07-18-post-remediation-independent-audit.md` (0 Critical, ~22
Major, ~35 Minor, ~49%). ~60 PRs landed against those findings between 2026-07-18 and today.

> **Headline: 0 Critical · 23 Major · 14 Minor · 70.4% compliant** (88 PASS ÷ 125 applicable
> MUST/SHOULD rules; N/A and ADVISORY excluded from the denominator per §14.2). Up from ~49%.
> Minor findings fell sharply (35 → 14) — most hygiene/tooling gaps from the last round are closed.
> Major findings held roughly flat (22 → 23) but the *composition* shifted: most of the prior
> round's Majors (CI gates, budget registry, coverage ratchet, license/SBOM, migration drift,
> user-erasure, quarterly sweep) are now closed, and a comparable number of **new, more specific**
> Majors surfaced under this round's finer-grained scrutiny — concentrated in §8.4/§8.6/§8.7 (auth
> duplication, client/server validation drift, styling-lint gaps) and §8.9 (observability context).

## What this audit tells us

1. **The tooling/gate layer is now solid.** CI enforcement (§10), the budget registry (R-0.4),
   dependency/secret scanning (§6/§7), migration-drift and coverage gates, and the quarterly sweep
   are all in place and mostly blocking. This is where the ~60 remediation PRs concentrated, and it
   shows: §6/§7/§15 (93.75%) and §9-§12 (90%) are now the strongest sections.
2. **Application-layer discipline has not kept pace with the gates.** The weakest sections —
   §8.4/§8.6/§8.7 (27%), §8.8/§8.9 (44%), §8.1-8.3 (55.6%) — are exactly the sections where a lint
   rule or CI gate can't yet catch the violation: duplicated authz checks, a Zod schema not actually
   shared with the server boundary, a color-literal regex that doesn't match Tailwind's arbitrary-value
   syntax, an `x-request-id` that's minted but never read downstream. These are real code-review-class
   defects, not missing infrastructure.
3. **One finding is a genuine security exposure worth prioritizing above the rest**: unescaped
   user-controlled strings (org name, asset description, role, inviter name) interpolated directly
   into transactional email HTML with no sanitizer in the repo (R-8.11.3). Scored Major per the
   evidence criteria, but it's the closest thing to a Critical in this report and should be treated
   accordingly.

## Section scorecard

| Section | PASS/Applicable | Compliance | Worst residual |
|---|---|---|---|
| §2 Repo & VC | 7/9 | 77.8% | R-2.5 371 stale branches, oldest 4+ months (Major) |
| §3 DRY & modularity | 11/12 | 91.7% | R-3.5 29 allow-listed import cycles (Minor) |
| §4 Dead & stale code | 5/5 | 100% | — |
| §5 Documentation | 6/8 | 75.0% | R-5.5 50/51 docs lack owner/review-date (Major) |
| §6 Dependencies & supply chain | 7/8 | 87.5% | R-6.6 2 unpatched HIGH `next` CVEs (Major) |
| §7 Secrets & source access | 5/5 | 100% | — |
| §15 Exceptions | 3/3 | 100% | — |
| §8.1 Frontend | 5/7 | 71.4% | R-8.1.4 7 files bypass `AppImage`/`next/image` (Minor) |
| §8.2 Language/type | 1/4 | 25.0% | R-8.2.3/8.2.4 unvalidated webhook + duplicated types (Major) |
| §8.3 Backend/DB | 4/7 | 57.1% | R-8.3.2 confirmed N+1; R-8.3.4 copy-pasted access pattern (Major) |
| §8.4 Auth | 3/6 | 50.0% | R-8.4.2/8.4.4 site-admin authz reimplemented 5× (Major) |
| §8.6 Forms | 0/4 | 0% | R-8.6.1/8.6.2 client Zod not enforced at Convex boundary (Major) |
| §8.7 UI/styling | 1/5 | 20.0% | R-8.7.1 color-lint misses Tailwind arbitrary values (Major) |
| §8.8 Testing | 3/4 | 75.0% | R-8.8.3 revenue-path E2E job is `continue-on-error` (Major) |
| §8.9 Observability | 1/5 | 20.0% | R-8.9.1/8.9.4/8.9.5/8.9.6 (Major ×4) |
| §8.10 Integrations | 1/4 | 25.0% | R-8.10.1 PDF vendor not adapter-isolated (Minor) |
| §8.11 Web security | 3/5 | 60.0% | **R-8.11.3 unescaped HTML in emails (Major, top priority)** |
| §8.12 Privacy | 4/4 | 100% | — |
| §9A Efficiency (cross-cutting) | 5/5 | 100% | — |
| §9B Call efficiency | 5/7 | 71.4% | R-9.12 cost budget registered but unenforced (Major) |
| §10 CI/CD gates | 5/5 | 100% | (license-check silent-fallback burn-down item) |
| §11 Metrics | 2/2 scored | 100% | R-11.2 no hotspot tooling (ADVISORY) |
| §12 Quarterly sweep | 1/1 | 100% | — |
| **Overall** | **88/125** | **70.4%** | — |

## Critical findings

**None.** Consistent with both prior audits: no unrotated secrets, no missing server-side authz on
the main org-scoped guard path, no client-originated prices (N/A, no billing), IDOR discipline
sampled clean on `by_cuid` fetches, CSRF/security headers enforced, PII scrubbed from logs/analytics.

## Major findings (grouped, with remediation)

### Top priority — security-adjacent
- **R-8.11.3 — Unescaped user content in transactional emails.** `src/lib/email-templates.ts` and
  `src/server/test-tag-reminders.ts` interpolate `orgName`/`role`/`inviterName`/asset
  `description`/`location` directly into HTML with no escaping anywhere in the repo (`escapeHtml`/
  `sanitizeHtml` grep returns zero hits). An org name or asset description containing
  `<img src=x onerror=…>` renders live in any webmail client that doesn't independently sanitize.
  **Fix:** add an `escapeHtml()` helper, apply to every interpolation site in both files, add a
  regression test.
- **R-8.11.5 — No registered/tested Postgres backup.** Convex backups are solid (daily, 90-day
  retention, quarterly restore drill passed 2026-07-12). Better Auth's Postgres data (users,
  sessions, credentials) has zero documented backup schedule or restore evidence — the runbook
  explicitly marks it out of scope. **Fix:** document/confirm the hosting provider's managed backup
  + retention (or stand up `pg_dump`), then run and record a restore drill.
- **R-6.6 — 2 unpatched HIGH vulnerabilities.** `next@16.2.7` (pinned exactly in `package.json`) has
  two live HIGH CVEs (middleware/proxy bypass, Server Actions DoS), patched at `>=16.2.11`, with no
  exception registered. **Fix:** bump `next` to `>=16.2.11` and re-verify `pnpm audit`; if it can't
  land immediately, register a dated §15 exception.

### Auth & permissions duplication
- **R-8.4.2 / R-8.4.4 — Site-admin authz reimplemented 5×.** `src/lib/admin-auth.ts`,
  `src/server/site-admin.ts` (×3), `src/server/invitations.ts` each independently check
  `role !== "admin"` instead of sharing one guard — the org-scoped RBAC path is clean, this is
  specifically the site-admin path. **Fix:** collapse into one `requireSiteAdmin()`, have all
  call sites import it.

### Client/server validation drift
- **R-8.6.1 / R-8.6.2 — Browser-direct Convex writes validate only client-side.** ~30
  `use-*-writes.ts` hooks Zod-validate in the browser, then call Convex mutations whose `v.*()`
  args validator is a separately hand-maintained shape — server-side constraints (`min`/`max`,
  price ≥ 0) are not re-enforced. A stale comment in `convex/assetWrites.ts:379-381` still claims a
  server action does this validation; it doesn't exist anymore. **Fix:** either mirror Zod
  constraints into the Convex args validator, or re-run the same Zod `.parse()` inside the Convex
  handler so one schema truly governs both boundaries.
- **R-8.2.3 — Unvalidated webhook trust boundary.** WooCommerce webhook body
  (`src/app/api/integrations/woocommerce/webhook/route.ts:41-44`) is `JSON.parse`'d and cast to a
  hand-written `interface WooOrder`, never Zod. **Fix:** add a Zod schema, `z.infer` the type.
- **R-8.2.4 — Duplicated hand-written types shadow Convex-generated `Doc<>` shapes.** 16
  `Mapped*`/`Native*` interfaces across 7 `src/lib/*-read.ts` files re-declare Convex document
  shapes field-by-field instead of deriving from `Doc<"table">` — exactly the "PDF-consumer /
  estimator-sync" class of footgun CLAUDE.md already warns about. **Fix:** derive via
  `Omit<Doc<"table">, ...> & {...}` instead of hand-typing.

### Query & data-access hygiene
- **R-8.3.2 — Confirmed N+1.** `convex/crewDashboard.ts` `upcomingShifts()` queries
  `crewShifts` inside a `for` loop over assignment IDs instead of a batched read. A broader scripted
  sweep flagged ~196 further candidate sites, unverified — recommend a full N+1 sweep.
- **R-8.3.3/R-9.8 — Unbounded reads still broad.** `.collect()` count is now **665** non-test calls
  (down from the baseline's 761–797) vs 6 `.paginate()` / 29 `.take()`. The CI ratchet
  (`collect-ratchet.mjs`) genuinely holds the narrow "unjustified pure-org-index" subset at 0, but
  that subset is a small fraction of the 665 — the rest rely on 219 manual `r9.8-ok` comments and
  reviewer judgment, not an automated bound. **Fix:** widen the ratchet to cover non-org-index
  `.collect()` calls on growable tables.
- **R-8.3.4 — Copy-pasted `kit by cuid` access pattern.** Inlined verbatim ~30 times across 19
  files despite an existing `kitByCuid()` helper in `warehouseOps.ts:342`. Each inlined site is an
  independent opportunity to forget the org check (per CLAUDE.md's `by_cuid`-is-global-index note).
  **Fix:** extract and enforce one accessor.

### Observability
- **R-8.9.1 — Convex jobs/cron have no error-capture pipeline.** Documented as a known-open item in
  `docs/convex-observability-runbook.md:35-40` — errors land only in the Convex dashboard.
- **R-8.9.4 — Error context is empty; no crash-free-floor measurement.** `onRequestError` context is
  `{route, method}` only — no opaque user ID, no request ID. `posthog.identify()` is never called
  client-side despite `person_profiles: "identified_only"`.
- **R-8.9.5 — Correlation ID minted but unused.** `middleware.ts` sets `x-request-id` only on
  authenticated non-public routes; every public/token route skips it; nothing downstream reads it
  (repo-wide grep for consumers returns zero hits).
- **R-8.9.6 — No cross-service trace context.** No W3C `traceparent` (or equivalent) between
  Next.js, Convex, and Postgres despite a genuinely multi-service architecture.
  **Fix (all four):** thread `x-request-id` unconditionally from `middleware.ts` into every
  `logger.*` call and into `captureServerException`'s context; call `posthog.identify()` client-side
  with the opaque member cuid; wire the Convex dashboard's failure webhook to PostHog/Slack; stand
  up a crash-free-sessions alert against T-13 (99.5%).

### Styling & duplication
- **R-8.7.1 — Color-literal lint has a gap.** The ban only matches literals whose *entire* value is
  a hex code; Tailwind arbitrary-value syntax (`text-[#fff]`, `bg-[#0a0f14]`) slips through — 12+
  confirmed uncaught instances. **Fix:** extend the lint regex to match hex inside brackets.
- **R-8.7.2 — Dead duplicate primitive.** `src/components/ui/combobox.tsx` (0 import sites) coexists
  with `combobox-picker.tsx` (28 usages) with no documented convention distinguishing them.
  **Fix:** delete the dead one or document the split.

### Docs & branch hygiene
- **R-2.5 — 371 remote branches, oldest 4+ months old**, far past the 3-day trunk-based budget with
  no registered override. **Fix:** sweep merged/abandoned branches, enable auto-delete-on-merge.
- **R-5.5 — 50/51 FEATUREDOCS + most of `docs/` lack an `Owner:`/`Last reviewed:` header** (only
  README/CLAUDE.md/ARCHITECTURE.md have one). **Fix:** add the header pattern repo-wide; wire a
  staleness check into the quarterly sweep.
- **R-5.3 — Stale npm/npx instructions** in `FEATUREDOCS/36-testing.md` and `convex/README.md`
  contradicting the pnpm-only / `pnpm exec convex` policy (a narrower recurrence of the same finding
  from the prior audit, now in different files). **Fix:** sweep-and-replace; make the existing
  `quarterly-sweep.sh` §5 grep a blocking CI check on `**/*.md`.

### Testing & vendor isolation
- **R-8.8.3 — Revenue-path E2E job is non-blocking.** `e2e-harness` (flows 2, 5-9, including the
  primary revenue path) runs with `continue-on-error: true` — structurally cannot block a bad
  deploy regardless of outcome. 3 of 10 critical flows remain unwritten. **Fix:** get one clean run
  on GitHub-hosted runners, flip the flag off, write the remaining flows.
- **R-9.12 — Cost budget registered but unenforced.** T-P4 values exist in the README table with no
  code-level cost instrumentation and no PostHog alert (unlike T-P6/T-P7, which are both live).
  **Fix:** wire a monthly vendor-cost check and an 80%-threshold alert per vendor.

## Minor findings (burn-down)

R-2.6 (23 merged-but-undeleted branches), R-3.5 (29 allow-listed import-cycle violations, not
zero), R-8.1.4 (7 media components bypass `AppImage`), R-8.1.7 (no manual WCAG checklist artifact
alongside the automated axe gate), R-8.2.2 (`any` tolerated under a flat ratchet of 137, `warn`
not `error`), R-8.4.5 (no integration test asserting session cookie flags), R-8.6.3 (schema
variants re-declared instead of derived via `.omit`/`.pick`), R-8.6.4 (no typed handler wrapper
enforcing a schema arg — outcome is fine, mechanism is by-convention), R-8.7.3 (repeated class-string
clusters not extracted into CVA variants), R-8.7.4 (dead styles from the R-8.7.2 duplicate primitive
not cleaned up), R-8.10.1 (PDF vendor not adapter-isolated, 3 call sites), R-8.10.3 (unchecked type
assertion on Convex storage-upload response instead of Zod), R-8.10.4 (one email template built
inline outside `email-templates.ts`; no fake for the Maps adapter), R-9.6 (2 outbound calls without
timeout/jitter: `invokeCronRoute`'s bare `fetch`, `withConvexReadRetry`'s unjittered fixed-delay
retry), R-10.1 (license-check step silently falls back to a vacuous pass on tool failure instead of
failing the gate).

## Section-by-section source reports

This report synthesizes seven independent section audits, each run fresh against the current repo
state (methodology: unbiased per-section-group re-measurement, matching the prior post-remediation
audit's approach). Full per-rule tables with file:line evidence live in the individual auditor
outputs and are summarized above; the section split was:

| Auditor scope | Sections |
|---|---|
| 1 | §2 Repo/VC, §3 DRY, §4 Dead code, §5 Docs |
| 2 | §6 Deps, §7 Secrets, §15 Exceptions |
| 3 | §8.1 Frontend, §8.2 Types, §8.3 Backend/DB |
| 4 | §8.4 Auth, §8.6 Forms, §8.7 UI/styling (§8.5 Billing N/A) |
| 5 | §8.8 Testing, §8.9 Observability |
| 6 | §8.10 Integrations, §8.11 Web security, §8.12 Privacy |
| 7 | §9A/§9B Efficiency, §10 CI/CD, §11 Metrics, §12 Quarterly sweep |

## Exception register status

Both entries in `docs/exceptions.md` remain valid and unexpired as of 2026-07-22 (expiry
2026-10-18), and both are honored correctly in current code:
- **R-8.1.7** — brand-red contrast carve-out, scoped to the `color-contrast` axe rule only.
- **R-8.11.2** — CSP split (enforced zero-risk subset + report-only `unsafe-inline`/`form-action`/
  `frame-src`), verified `next.config.ts` matches the exception's description exactly.

No new exception is registered for R-6.6 (the unpatched `next` CVEs) — it should either be fixed
immediately or get a dated exception; leaving it unregistered is itself non-compliant with R-15.1.

## Delta vs the 2026-07-18 post-remediation audit

**Closed since last audit:** R-0.4 budget registry (all §13B thresholds now registered), R-8.8.2
coverage ratchet (registered override + CI-blocking), R-10.1 CI gates (SAST/license/all 8 categories
now present and blocking), R-7.3 pre-commit secret scanning (husky + gitleaks), R-4.2 Knip
(blocking ratchet), R-8.3.1 migration drift (CI gate added), R-8.12.2 user erasure (implemented and
verifiable), R-12.1 quarterly sweep (scheduled workflow covering all 10 checklist items), R-8.11.2
CSP (now a valid, correctly-honored exception rather than an unregistered gap), R-6.8 license/SBOM.

**Still open, same root cause:** R-5.3 stale npm/npx docs (different files this round), R-3.5
import-cycle allowlist (29, not zero), R-9.8/R-8.3.3 unbounded `.collect()` (narrowed but not
resolved — 665 vs the prior 761-797), R-8.9.5 structured logging (logger built, correlation-ID
propagation still broken), R-8.6.1 Zod↔Convex duplication (still open), R-8.7.1 color-literal lint
(still has a gap, now specifically the Tailwind-bracket-syntax case), R-8.1.4 `next/image` adoption
(partial — `AppImage` now exists, 7 call sites still bypass it).

**New this round** (surfaced by this round's finer per-rule scrutiny, not necessarily new in the
code): R-2.5 branch hygiene, R-5.5 doc ownership/dates, R-6.6 unpatched CVEs, R-8.2.3/8.2.4 (webhook
validation, duplicated types), R-8.3.2/8.3.4 (N+1, copy-pasted access pattern), R-8.4.2/8.4.4
(duplicated site-admin authz), R-8.7.2 (dead duplicate primitive), R-8.9.1/8.9.4/8.9.6 (Convex job
error capture, empty error context, no trace context), R-8.11.3 (unescaped email HTML — flagged as
this round's top-priority item), R-8.11.5 (Postgres backup), R-9.12 (cost-budget enforcement).

## Independence & unverifiables

Each section group was audited by a separate agent given only POLICY.md, the profile, and its
section list — no knowledge of this or prior reports. Not independently verifiable from the repo
alone (excluded from scoring, noted by the relevant auditor): live GitHub branch-protection
configuration (R-2.6, R-7.5), whether "zero standing ignored alerts" holds in practice (R-8.9.3),
full-pipeline CI timing beyond one sampled run (T-11), an exhaustive N+1 sweep beyond the one
confirmed instance (R-8.3.2 — ~196 further candidates flagged, unverified).

*Re-run at the next quarterly sweep (R-12.1, `.github/workflows/quarterly-sweep.yml`); future
reports record deltas vs this one.*
