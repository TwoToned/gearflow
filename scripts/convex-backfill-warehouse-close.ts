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
    if (await convex.query(api.warehouseCloses.getById, { id: r.id })) { skipped++; continue; }
    await convex.mutation(
      api.warehouseCloses.create,
      toConvexDoc(r) as FunctionArgs<typeof api.warehouseCloses.create>,
    );
    created++;
  }

  console.log(`Warehouse-close backfill complete: ${created} created, ${skipped} already present (${rows.length} rows).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
