/**
 * End-to-end guard: the app's PrismaClient must connect with a server-side
 * statement_timeout, so no single query can hold a pooled connection hostage
 * and stall the whole app. Regression test for the prod incident where a bad
 * query plan (stale stats after a backfill) froze the app for ~1 minute.
 */
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

describe("app prisma client connection hardening", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("connects with a non-zero statement_timeout", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ statement_timeout: string }>>(
      "SHOW statement_timeout",
    );
    // Default DB_STATEMENT_TIMEOUT_MS is 30000 -> Postgres reports "30s".
    expect(rows[0].statement_timeout).not.toBe("0");
    expect(rows[0].statement_timeout).toBe("30s");
  });
});
