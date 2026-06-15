/**
 * One-time (re-runnable) backfill: copy sub_test_record from Prisma into Convex
 * (table "subTestRecords").
 *
 * Test & Tag dual-write groundwork (Phase 6 decommission). Idempotent — skips
 * rows already present in Convex (matched by cuid `id`). Maps Date -> ms,
 * Decimal -> number, null -> absent. Also the heal path. See
 * src/lib/test-tag-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-sub-test-records.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const records = await prisma.subTestRecord.findMany();
  for (const r of records) {
    const __res = await convex.mutation(
      api.subTestRecords.createIfMissing,
      toConvexDoc(r) as FunctionArgs<typeof api.subTestRecords.createIfMissing>,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(
    `Sub-test record backfill complete: ${created} created, ${skipped} already present ` +
      `(${records.length} total).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
