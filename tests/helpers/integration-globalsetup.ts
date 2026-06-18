/**
 * Vitest GLOBAL setup for the integration suite (runs ONCE per `vitest run`,
 * before any worker/test file).
 *
 * Responsibility: make the Convex service-token trust chain work against the
 * shared DEV Convex deployment (`groovy-koala-475`).
 *
 * The trust chain (see docs/designs/convex-phase5-auth-bridge.md):
 *   1. The integration runner points DATABASE_URL at the local `gearflow_test`
 *      Postgres (fast, disposable, per-test TRUNCATE).
 *   2. Better Auth's `jwt` plugin signs the SERVICE token with the ES256 private
 *      key it reads from the `jwks` table in DATABASE_URL.
 *   3. Dev Convex trusts ONLY the public key it already published — the keypair
 *      that lives in the DEV Postgres `jwks` table.
 *
 * So the local test DB must carry the SAME `jwks` row the dev deployment trusts.
 * We copy it from the dev Postgres (CONVEX_TRUST_DATABASE_URL) into the test DB
 * once here. The per-test TRUNCATE in `truncateAllTables` explicitly skips the
 * `jwks` table so the trusted key survives the whole run.
 *
 * Idempotent: re-running just upserts the same row(s).
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// The dev Postgres that holds the keypair dev Convex trusts. Defaults to the
// project's known dev DB; override via CONVEX_TRUST_DATABASE_URL if it moves.
const TRUST_DB_URL =
  process.env.CONVEX_TRUST_DATABASE_URL ??
  "postgres://postgres:ZeCiqVBin90ul6eGMeEu4BQtRZPcfDxU3qyqS9diTe1M05W6o4TpHu83vOWh3vm9@100.64.240.72:5432/postgres";

const TEST_DB_URL = process.env.DATABASE_URL;

type JwksRow = {
  id: string;
  publicKey: string;
  privateKey: string;
  createdAt: Date;
  expiresAt: Date | null;
};

export default async function globalSetup(): Promise<void> {
  if (!TEST_DB_URL) {
    throw new Error(
      "[integration globalSetup] DATABASE_URL is not set — point it at gearflow_test.",
    );
  }
  if (TEST_DB_URL === TRUST_DB_URL) {
    throw new Error(
      "[integration globalSetup] DATABASE_URL must NOT be the dev/prod Postgres — point it at the local gearflow_test DB.",
    );
  }

  const trustDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TRUST_DB_URL }),
  });
  const testDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DB_URL }),
  });

  try {
    const rows = await trustDb.$queryRaw<JwksRow[]>`
      SELECT id, "publicKey", "privateKey", "createdAt", "expiresAt" FROM jwks
    `;
    if (rows.length === 0) {
      throw new Error(
        "[integration globalSetup] No jwks rows in the trust DB — cannot establish Convex trust. " +
          "Has the dev Convex auth bridge been provisioned?",
      );
    }

    for (const r of rows) {
      // Upsert by primary key so re-runs are idempotent and we never duplicate.
      await testDb.$executeRaw`
        INSERT INTO jwks (id, "publicKey", "privateKey", "createdAt", "expiresAt")
        VALUES (${r.id}, ${r.publicKey}, ${r.privateKey}, ${r.createdAt}, ${r.expiresAt})
        ON CONFLICT (id) DO UPDATE SET
          "publicKey" = EXCLUDED."publicKey",
          "privateKey" = EXCLUDED."privateKey",
          "createdAt" = EXCLUDED."createdAt",
          "expiresAt" = EXCLUDED."expiresAt"
      `;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[integration globalSetup] Copied ${rows.length} jwks row(s) into the test DB — Convex service-token trust is ready.`,
    );
  } finally {
    await trustDb.$disconnect();
    await testDb.$disconnect();
  }
}
