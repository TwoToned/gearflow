/**
 * One-time (re-runnable) backfill: copy asset_bulk_child rows from Prisma into
 * Convex (table "assetBulkChildren").
 *
 * Phase 6 decommission groundwork — dual-write infra for the bulk-accessory join
 * rows on serialised parent assets. Idempotent: skips rows already present in
 * Convex (matched by cuid `id`). Maps Date -> ms, Decimal -> number, null ->
 * absent via toConvexDoc. Also the heal path.
 * See src/lib/asset-bulk-child-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-asset-bulk-children.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rows = await prisma.assetBulkChild.findMany();
  for (const row of rows) {
    const __res = await convex.mutation(
      api.assetBulkChildren.createIfMissing,
      toConvexDoc(row) as FunctionArgs<typeof api.assetBulkChildren.createIfMissing>,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(
    `Asset bulk children backfill complete: ${created} created, ${skipped} already present ` +
      `(${rows.length} total).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
