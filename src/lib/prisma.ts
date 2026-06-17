import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/env";
import { buildRuntimeDatabaseUrl } from "./db-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Harden the runtime connection: bound per-query time and pool waits so a
// single slow query can't take the whole app down (see src/lib/db-url.ts).
// `prisma migrate` reads DATABASE_URL directly and is unaffected, so backfill
// migrations are never killed by the statement timeout.
// NOTE: Prisma 7 requires @prisma/adapter-pg adapter; datasourceUrl is removed.
const hardenedUrl = buildRuntimeDatabaseUrl(env.DATABASE_URL, {
  statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  poolTimeoutS: env.DB_POOL_TIMEOUT_S,
  connectionLimit: env.DB_CONNECTION_LIMIT,
});

// Under the integration test runner (Vitest) we pin the pg pool to a SINGLE,
// never-recycled connection. The default multi-connection pool is correct for
// the app, but in the Vitest worker its checkout/checkin races (queries land on
// different physical connections across `await` points) make a per-test
// `TRUNCATE` non-deterministically race fixture writes — rows leak past a
// truncate or a just-written row reads back missing. One pinned connection
// serialises every statement, which is exactly what the integration tests need.
// (No effect on prod: gated on VITEST.)
const isVitest = process.env.VITEST === "true";
const adapter = isVitest
  ? new PrismaPg(
      new Pool({
        connectionString: env.DATABASE_URL,
        max: 1,
        idleTimeoutMillis: 0,
        allowExitOnIdle: false,
      }),
    )
  : new PrismaPg({ connectionString: hardenedUrl });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
