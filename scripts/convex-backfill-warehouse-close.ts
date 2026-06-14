/**
 * One-time (re-runnable) backfill: copy warehouseClose rows from Prisma into
 * Convex. Phase 4 reactive dual-write for the warehouse views. Idempotent —
 * skips rows already present (matched by cuid `id`). See
 * src/lib/warehouse-close-mirror.ts and FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-warehouse-close.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rows = await prisma.warehouseClose.findMany();
  for (const r of rows) {
    const __res = await convex.mutation(api.warehouseCloses.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.warehouseCloses.createIfMissing>);
    if (__res.created) created++; else skipped++;
  }

  console.log(`Warehouse-close backfill complete: ${created} created, ${skipped} already present (${rows.length} rows).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
