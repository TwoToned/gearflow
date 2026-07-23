# Critical Flows

> _Owner: Jayden Nawotka · Last reviewed: 2026-07-23 (review quarterly — POLICY.md R-5.5)_

The E2E smoke suite (`e2e/`, Playwright) MUST cover 100% of this list, and it MUST run on
and block every deploy (POLICY.md **R-8.8.3**). At minimum this list covers **auth** and the
**primary revenue path**. Update this list in the same PR that adds or changes a critical flow.

**Status:** the list is defined. Flow #1 runs **blocking** in CI (the `e2e` job in
`.github/workflows/ci.yml`: Postgres service + Playwright chromium against a dummy Convex URL)
with a functional smoke **and** an axe a11y check (R-8.1.7). Flows 2 and 5-9 (the primary
revenue path) are covered by seeded-harness specs (`e2e/harness-*.spec.ts`,
`docs/e2e-harness.md`) — verified passing locally, but the **`e2e-harness` CI job is
temporarily removed** (2026-07-23) after the docker-in-CI networking path (self-hosted Convex
container → app JWKS endpoint via `host.docker.internal`) never went green on a GitHub-hosted
runner; it ran `continue-on-error: true` and consistently failed with no gating value, so it
was pulled rather than left red. Registered as a dated exception (`docs/exceptions.md`,
R-8.8.3). Flows 3, 4, and 10 (as a standalone flow) remain unwritten.

| # | Flow | Steps | E2E coverage |
|---|------|-------|--------------|
| 1 | **Login page loads** | Unauthenticated visit to `/login` renders the sign-in entry form (+ axe a11y, zero serious/critical WCAG 2 A/AA) | ✅ `e2e/smoke.spec.ts`, `e2e/a11y.spec.ts` (CI-gated, blocking) |
| 2 | **Sign in / register** | Register/sign in → authenticated → lands on dashboard | ✅ `e2e/harness-auth.spec.ts` (`E2E_HARNESS=1`; passes locally, `e2e-harness` CI job temporarily removed — see status above) |
| 3 | **Sign out** | Authenticated → sign out → session invalidated, back to `/login` | ⬜ pending |
| 4 | **Register / onboarding** | New account → create/join org → onboarding completes | ⬜ pending |
| 5 | **Create a project** (revenue path) | New project with a client → saved, visible in list | ✅ `e2e/harness-revenue-path.spec.ts` (name-only project; client is optional so this run skips it) |
| 6 | **Add line items + pricing** (revenue path) | Add gear/models to a project → totals compute server-side | ✅ `e2e/harness-revenue-path.spec.ts` (own-stock, by-model) |
| 7 | **Availability check** (revenue path) | Overlapping booking is flagged; no double-book | ✅ `e2e/harness-revenue-path.spec.ts` (asserts the inline availability panel renders with no overbook warning for a 1-asset/1-unit request) |
| 8 | **Warehouse check-out** | Project gear checked out (per-unit) from the warehouse | ✅ `e2e/harness-revenue-path.spec.ts` (Pick → Prep → Deploy) |
| 9 | **Warehouse check-in / return** | Checked-out gear returned; status + history update | ✅ `e2e/harness-revenue-path.spec.ts` (Deployed → Return) |
| 10 | **Create inventory** | Create a model/asset → asset tag generated | 🟡 exercised as setup within `e2e/harness-revenue-path.spec.ts` (model + serialized asset), not yet its own standalone flow test |

**Primary revenue path** = flows 5 → 6 → 7 → 8 → 9 (project creation through check-out/return),
where pricing and availability are server-authoritative (R-9.3). Covered end-to-end by
`e2e/harness-revenue-path.spec.ts`, not yet verified against a real CI run (see above).

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
