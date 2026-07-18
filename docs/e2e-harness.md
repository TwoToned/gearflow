# Seeded-auth E2E harness

The missing piece for authenticated E2E (POLICY.md R-8.8.3 / #621): a local
**self-hosted Convex** backend the app can talk to, so tests can exercise
authenticated, data-backed flows — not just the client-rendered `/login` page.

**Status: proven working locally.** `scripts/e2e-harness-up.sh` stands up Convex,
pushes the schema, and wires auth; `e2e/harness-auth.spec.ts` then registers a user
and reaches the authenticated dashboard (verified). CI automation is the remaining
finish (see below).

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

1. **CI automation** — run this in the `e2e` job: `docker compose up` the Convex
   backend (service or step), generate the admin key, push the schema, `pnpm dev`,
   then `E2E_HARNESS=1 playwright test`. The cross-container `host.docker.internal`
   JWKS reach is the one thing to validate on the GitHub runner.
2. **Seed domain data + write the revenue-path specs** (project → line-items →
   availability → check-out → return) now that authenticated pages render.
3. This harness also unblocks verifying the deferred refactors (#616 images, #625
   pagination, #618 validation, #645 code-split, #655 templates, #646 axe pages) by
   driving the real authenticated app.
