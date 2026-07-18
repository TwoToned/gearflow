# Critical Flows

The E2E smoke suite (`e2e/`, Playwright) MUST cover 100% of this list, and it MUST run on
and block every deploy (POLICY.md **R-8.8.3**). At minimum this list covers **auth** and the
**primary revenue path**. Update this list in the same PR that adds or changes a critical flow.

**Status:** the list is defined and the E2E suite **runs blocking in CI** (the `e2e` job in
`.github/workflows/ci.yml`: Postgres service + Playwright chromium against a dummy Convex URL).
Flow #1 is covered with a functional smoke **and** an axe a11y check (R-8.1.7). Flows 2+ need a
seeded auth user and are the remaining R-8.8.3 work — until they're covered, the "100% of the
list" clause is partially met (auth entry ✅; sign-in + revenue path pending).

| # | Flow | Steps | E2E coverage |
|---|------|-------|--------------|
| 1 | **Login page loads** | Unauthenticated visit to `/login` renders the sign-in entry form (+ axe a11y, zero serious/critical WCAG 2 A/AA) | ✅ `e2e/smoke.spec.ts`, `e2e/a11y.spec.ts` (CI-gated) |
| 2 | **Sign in / register** | Register/sign in → authenticated → lands on dashboard | 🟡 proven via the seeded harness (`e2e/harness-auth.spec.ts`, `E2E_HARNESS=1`); see `docs/e2e-harness.md`. CI automation pending. |
| 3 | **Sign out** | Authenticated → sign out → session invalidated, back to `/login` | ⬜ pending |
| 4 | **Register / onboarding** | New account → create/join org → onboarding completes | ⬜ pending |
| 5 | **Create a project** (revenue path) | New project with a client → saved, visible in list | ⬜ pending |
| 6 | **Add line items + pricing** (revenue path) | Add gear/models to a project → totals compute server-side | ⬜ pending |
| 7 | **Availability check** (revenue path) | Overlapping booking is flagged; no double-book | ⬜ pending |
| 8 | **Warehouse check-out** | Project gear checked out (per-unit) from the warehouse | ⬜ pending |
| 9 | **Warehouse check-in / return** | Checked-out gear returned; status + history update | ⬜ pending |
| 10 | **Create inventory** | Create a model/asset → asset tag generated | ⬜ pending |

**Primary revenue path** = flows 5 → 6 → 7 → 8 → 9 (project creation through check-out/return),
where pricing and availability are server-authoritative (R-9.3).

## Running

```bash
pnpm test:e2e         # headless (starts the dev server per playwright.config.ts)
pnpm test:e2e:ui      # Playwright UI
```

E2E requires a reachable Postgres + Convex (the app reads site/SSO settings during render),
seeded auth for flows 2+, and installed Playwright browsers (`pnpm exec playwright install`).
