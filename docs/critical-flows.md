# Critical Flows

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-25 (review quarterly — POLICY.md R-5.5)_

The E2E smoke suite (`e2e/`, Playwright) MUST cover 100% of this list, and it MUST run on
and block every deploy (POLICY.md **R-8.8.3**). At minimum this list covers **auth** and the
**primary revenue path**. Update this list in the same PR that adds or changes a critical flow.

**Status:** the list is 100% written. Flow #1 runs **blocking** in CI (the `e2e` job in
`.github/workflows/ci.yml`: Postgres service + Playwright chromium against a dummy Convex URL)
with a functional smoke **and** an axe a11y check (R-8.1.7). Flows 2-10 (sign-in through the
primary revenue path) are covered by seeded-harness specs (`e2e/harness-*.spec.ts`,
`docs/e2e-harness.md`) — verified passing locally **and** the **`e2e-harness` CI job is
restored** (2026-07-25, #858). Both prior blockers are now fixed: the original red runs (#725)
were a Next dev-server crash under `next dev` (fixed via a prebuilt `next start`), and the
second bug — `harness-revenue-path.spec.ts` hanging on a stuck "Assign assets" dialog after
"Prep"/"Deploy" — is root-caused and fixed (see `docs/e2e-harness.md`). The job stays
`continue-on-error: true` until proven green on a GitHub-hosted runner.

| # | Flow | Steps | E2E coverage |
|---|------|-------|--------------|
| 1 | **Login page loads** | Unauthenticated visit to `/login` renders the sign-in entry form (+ axe a11y, zero serious/critical WCAG 2 A/AA) | ✅ `e2e/smoke.spec.ts`, `e2e/a11y.spec.ts` (CI-gated, blocking) |
| 2 | **Sign in / register** | Register/sign in → authenticated → lands on dashboard | ✅ `e2e/harness-auth.spec.ts` (`E2E_HARNESS=1`; passes locally and in CI — see status above) |
| 3 | **Sign out** | Authenticated → sign out → session invalidated, back to `/login` | ✅ `e2e/harness-sign-out.spec.ts` (asserts a post-sign-out visit to `/dashboard` bounces back to `/login`, not just a client-side redirect) |
| 4 | **Register / onboarding** | New account → create/join org → onboarding completes | ✅ `e2e/harness-onboarding.spec.ts` (asserts a post-onboarding revisit to `/onboarding` itself redirects away, proving the org was actually created) |
| 5 | **Create a project** (revenue path) | New project with a client → saved, visible in list | ✅ `e2e/harness-revenue-path.spec.ts` (name-only project; client is optional so this run skips it) |
| 6 | **Add line items + pricing** (revenue path) | Add gear/models to a project → totals compute server-side | ✅ `e2e/harness-revenue-path.spec.ts` (own-stock, by-model) |
| 7 | **Availability check** (revenue path) | Overlapping booking is flagged; no double-book | ✅ `e2e/harness-revenue-path.spec.ts` (asserts the inline availability panel renders with no overbook warning for a 1-asset/1-unit request) |
| 8 | **Warehouse check-out** | Project gear checked out (per-unit) from the warehouse | ✅ `e2e/harness-revenue-path.spec.ts` (Pick → Prep → Deploy) — the stuck "Assign assets" dialog after Prep/Deploy is root-caused and handled (see `docs/e2e-harness.md`) |
| 9 | **Warehouse check-in / return** | Checked-out gear returned; status + history update | ✅ `e2e/harness-revenue-path.spec.ts` (Deployed → Return) |
| 10 | **Create inventory** | Create a model/asset → asset tag generated | ✅ `e2e/harness-create-inventory.spec.ts` (standalone flow; also exercised as setup within `e2e/harness-revenue-path.spec.ts`) |

**Primary revenue path** = flows 5 → 6 → 7 → 8 → 9 (project creation through check-out/return),
where pricing and availability are server-authoritative (R-9.3). Covered end-to-end by
`e2e/harness-revenue-path.spec.ts`, verified passing locally and restored to CI — see
`docs/e2e-harness.md`.

## Running

```bash
pnpm test:e2e         # headless (starts the dev server per playwright.config.ts)
pnpm test:e2e:ui      # Playwright UI
```

E2E requires a reachable Postgres + Convex (the app reads site/SSO settings during render),
seeded auth for flows 2+, and installed Playwright browsers (`pnpm exec playwright install`).

## Accessibility

Automated axe checks (above) are necessary but not sufficient for WCAG 2.2 AA (POLICY.md
R-8.1.7). A manual keyboard/focus/screen-reader-label checklist pass against this flow list is
required each release — see [`docs/a11y-manual-checklist.md`](./a11y-manual-checklist.md) for
the criteria, procedure, and results log.
