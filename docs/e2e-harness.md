# Seeded-auth E2E harness

The missing piece for authenticated E2E (POLICY.md R-8.8.3 / #621): a local
**self-hosted Convex** backend the app can talk to, so tests can exercise
authenticated, data-backed flows — not just the client-rendered `/login` page.

**Status: proven working locally; CI job re-added 2026-07-23 with
`continue-on-error: true` pending a proven green run on a GitHub-hosted runner (see
`docs/exceptions.md` R-8.8.3).** `scripts/e2e-harness-up.sh` stands up Convex, pushes
the schema, and wires auth; `e2e/harness-auth.spec.ts` then registers a user and
reaches the authenticated dashboard (verified locally). The `e2e-harness` job in
`.github/workflows/ci.yml` runs the same script + the full harness spec set (auth,
a11y, cookie flags, onboarding, sign-out, create-inventory, and the primary revenue
path).

**Root cause of the prior red runs (#725, investigated 2026-07-23):** NOT the
docker-in-CI JWKS networking path — `docker-compose.convex.yml` already maps
`host.docker.internal:host-gateway` on Linux (present since the harness was first
built), and one of the two observed failures (run 2) got well past the JWKS-trust
steps (through registration and deep into the revenue path) before dying, which
JWKS misconfiguration wouldn't allow. The actual cause was Playwright's `webServer`
always spawning **`next dev`**, including in CI. The harness's flow set is far
longer and touches far more routes than the `e2e` job's plain `/login` smoke check,
which triggers much more Turbopack on-demand compilation — and that's what surfaced
a known Next dev-server crash class (`uncaughtException: Error: aborted` /
`ECONNRESET` when a client aborts a request mid-compile) under CI resource
pressure. `playwright.config.ts` now runs a prebuilt **`next start`** instead when
`E2E_PROD_SERVER=1` (set by the `e2e-harness` job only — the `e2e` job's simpler
smoke suite is untouched and stays on `next dev`), which serves a static build with
no on-demand compilation and sidesteps the crash entirely — it's also more
representative of what's actually deployed. To flip `continue-on-error` off:
confirm a run (ideally a few in a row) has gone green on a GitHub-hosted runner,
then remove the `continue-on-error: true` line and update `docs/exceptions.md`.

## How it works

Self-hosted Convex (`docker-compose.convex.yml`, `ghcr.io/get-convex/convex-backend`)
runs on **local-disk storage — no S3 needed** — backed by a `gearflow_convex` Postgres
DB. The harness pushes the app's schema/functions to it and sets two deployment env
vars so the backend trusts the app's Better Auth ES256 JWTs:

- `CONVEX_AUTH_ISSUER` = the app origin (`http://localhost:3000`)
- `CONVEX_AUTH_JWKS_URL` = `http://host.docker.internal:3000/api/auth/jwks` (reachable
  from the Convex container)

The push writes `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210` to `.env.local`, so the
app connects to the local backend.

## Run it

```bash
bash scripts/e2e-harness-up.sh     # boots Convex, pushes schema, wires auth
pnpm dev                           # in another terminal
E2E_HARNESS=1 pnpm exec playwright test --project=chromium e2e/harness-auth.spec.ts
bash scripts/e2e-harness-down.sh   # tear down
```

**Gotcha (already handled by the up script):** Better Auth encrypts its JWKS private
key with `BETTER_AUTH_SECRET`. A stale `jwks` row from a *different* secret makes
sign-up fail with "Failed to decrypt private key" — the up script clears it so it
regenerates. A fresh Better Auth DB avoids it entirely; the first registered user
bootstraps as admin.

## Remaining finish (scoped)

1. **CI automation** — **done, not yet blocking** (2026-07-23). A dedicated
   `e2e-harness` job (separate from the dummy-Convex `e2e` job) runs
   `scripts/e2e-harness-up.sh` then the harness spec set with `E2E_HARNESS=1` against
   a prebuilt `next start` server, tearing down via `scripts/e2e-harness-down.sh` in
   an `if: always()` step. `continue-on-error: true` until a run (ideally a few in a
   row) is confirmed green on a GitHub-hosted runner — see the root-cause writeup
   above, `docs/critical-flows.md`, and `docs/exceptions.md` (R-8.8.3) for status.
2. **Seed domain data + write the revenue-path specs** — done:
   `e2e/harness-revenue-path.spec.ts` covers project → line-items → availability →
   check-out → return (critical-flows #5-9), creating its own model + serialized
   asset first since there's no seed-data API reachable from Playwright, only the
   real UI. `e2e/harness-onboarding.spec.ts` (#4), `e2e/harness-sign-out.spec.ts`
   (#3), and `e2e/harness-create-inventory.spec.ts` (#10, standalone) round out the
   remaining critical flows.
3. This harness also unblocks verifying the deferred refactors (#616 images, #625
   pagination, #618 validation, #645 code-split, #655 templates, #646 axe pages) by
   driving the real authenticated app.
