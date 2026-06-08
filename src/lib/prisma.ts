import "dotenv/config";
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

const adapter = new PrismaPg({ connectionString: hardenedUrl });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
