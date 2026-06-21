/**
 * Vitest per-worker setupFile for the integration suite. Runs in each worker
 * process BEFORE that worker imports any test module (and therefore before
 * `@/env` is evaluated), so this is the place to guarantee the Convex env the
 * migrated code depends on is present.
 *
 * The `test:integration` npm script already exports these, but a developer who
 * runs vitest directly (e.g. `pnpm exec vitest run --config
 * vitest.integration.config.ts`) might not. We backfill safe defaults from
 * `.env.local` semantics so the suite "just works" either way.
 *
 *   • NEXT_PUBLIC_CONVEX_URL    — the shared DEV Convex deployment.
 *   • BETTER_AUTH_URL           — MUST be the issuer dev Convex trusts
 *                                 (https://preview.lab.rvlt.app). The minted
 *                                 service token's `iss` claim comes from this.
 *
 * DATABASE_URL is intentionally NOT defaulted here — the runner must point it at
 * the local gearflow_test DB (the script does). We only assert it is set.
 */

if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://groovy-koala-475.convex.cloud";
}

// Dev Convex trusts service tokens whose issuer is this fixed preview origin.
// Better Auth's jwt plugin uses BETTER_AUTH_URL as the `iss` claim.
process.env.BETTER_AUTH_URL = "https://preview.lab.rvlt.app";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[integration setup] DATABASE_URL is not set — run via `npm run test:integration` " +
      "or set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gearflow_test.",
  );
}
