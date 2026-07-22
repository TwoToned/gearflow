# Seeded-auth E2E harness

The missing piece for authenticated E2E (POLICY.md R-8.8.3 / #621): a local
**self-hosted Convex** backend the app can talk to, so tests can exercise
authenticated, data-backed flows — not just the client-rendered `/login` page.

**Status: proven working locally, CI automation added but not yet verified green.**
`scripts/e2e-harness-up.sh` stands up Convex, pushes the schema, and wires auth;
`e2e/harness-auth.spec.ts` then registers a user and reaches the authenticated
dashboard (verified locally). The `e2e-harness` job in `.github/workflows/ci.yml` runs
the same script + the full harness spec set (auth, a11y, cookie flags, and the
primary revenue path) in CI, but is `continue-on-error: true` until a run has
actually gone green there — the docker-in-CI networking path (the self-hosted Convex
container reaching the app's JWKS endpoint via `host.docker.internal` from a
GitHub-hosted runner rather than a developer laptop) hasn't been exercised yet. Flip
`continue-on-error` off once it has.

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

1. **CI automation** — done: a dedicated `e2e-harness` job (separate from the
   dummy-Convex `e2e` job) runs `scripts/e2e-harness-up.sh` then the harness spec set
   with `E2E_HARNESS=1`, tearing down via `scripts/e2e-harness-down.sh` in an
   `if: always()` step. **Not yet verified green in CI** — the one thing left to
   validate on the GitHub runner is the cross-container `host.docker.internal` JWKS
   reach; the job runs `continue-on-error: true` until that's confirmed (see
   `docs/critical-flows.md`).
2. **Seed domain data + write the revenue-path specs** — done:
   `e2e/harness-revenue-path.spec.ts` covers project → line-items → availability →
   check-out → return (critical-flows #5-9), creating its own model + serialized
   asset first since there's no seed-data API reachable from Playwright, only the
   real UI.
3. This harness also unblocks verifying the deferred refactors (#616 images, #625
   pagination, #618 validation, #645 code-split, #655 templates, #646 axe pages) by
   driving the real authenticated app.
