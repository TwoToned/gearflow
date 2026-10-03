import { Pool } from "pg";

/**
 * Per-file DB isolation for the seeded E2E harness (#1118). Every
 * `harness-*.spec.ts` file's own docstring claims to run against "a fresh
 * Better Auth DB" — true only for whichever file happens to run first in a
 * CI job, since `scripts/e2e-harness-up.sh` stands up ONE shared Postgres
 * for the whole job, not one per file. #1071 removed the single-org
 * auto-join hook that used to paper over this (every registrant silently
 * joined whatever org already existed), so a second file's fresh registrant
 * now correctly gets rejected creating a second org (`allowUserToCreateOrganization`
 * only permits it while zero orgs exist system-wide — src/server/site-admin.ts's
 * `isOrgCreationBootstrap`).
 *
 * Call this from a `test.beforeEach` in every harness spec file to restore
 * the "fresh harness" isolation each file's docstring already assumes —
 * `beforeEach`, not `beforeAll`: a file with more than one test needs a
 * fresh DB before EACH one, not just once for the whole file. Playwright's
 * harness project runs with `workers: 1` in CI
 * (playwright.config.ts) — tests execute one file at a time in a single
 * worker, so truncating here can never race a concurrently-running file.
 *
 * Scoped to Postgres (Better Auth identity + org/membership) — Convex's
 * domain data is untouched. Stale Convex rows from a prior file's
 * (already-truncated) org are harmless orphans: every read is org-scoped to
 * the NEW org's own cuid (R-8.4.3), and `isOrgCreationBootstrap` itself only
 * ever checks Postgres.
 *
 * Deliberately does NOT truncate `jwks`, unlike `scripts/e2e-harness-up.sh`'s
 * own ONE-TIME `DELETE FROM jwks` (which runs once, before the harness's
 * Convex backend ever fetches the app's JWKS endpoint, clearing a stale key
 * from a previous run's different `BETTER_AUTH_SECRET`). Truncating it here,
 * repeatedly, mid-run, is a different and much worse thing: Convex caches the
 * JWKS response from its FIRST successful fetch; wiping the table forces
 * Better Auth to mint a brand-new signing key on the very next use, and every
 * JWT signed with that new key fails Convex's cached-stale-key validation
 * with "does this key match any key in the provider's JWKS?" — breaking auth
 * for every file after the first. The `jwks` table isn't part of what this
 * reset needs to isolate anyway (`isOrgCreationBootstrap` only ever checks
 * `organization`); it caused exactly this regression on the first real CI
 * run and was removed.
 */
export async function resetHarnessDb(): Promise<void> {
  if (!process.env.E2E_HARNESS) return; // never touch a non-harness DB
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `TRUNCATE TABLE "organization", "member", "invitation", "pending_sso_approval", ` +
        `"sso_provider", "user", "session", "account", "verification", ` +
        `"twoFactor", "backup_code", "passkey" CASCADE`,
    );
  } finally {
    await pool.end();
  }
}
