/**
 * One-time (re-runnable) backfill: copy the MaintenanceRecordAsset join table
 * from Prisma into Convex.
 *
 * Bucket-2 Phase B write inversion. Idempotent — skips links already present in
 * Convex (matched by cuid `id`). The join carries no Date/nullable columns (just
 * `id`, `maintenanceRecordId`, `assetId`), so toConvexDoc is a passthrough. Run
 * once BEFORE the Convex-only read rewiring deploys (else maintenance asset lists
 * + getRecentActivity read empty):
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-maintenance-record-assets.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-decommission-RUNBOOK.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CreateArgs = FunctionArgs<typeof api.maintenanceRecordAssets.create>;

async function main() {
  const convex = await getConvexClient();
  const rows = await prisma.maintenanceRecordAsset.findMany();
  console.log(`Found ${rows.length} maintenance-record-asset links in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const __res = await convex.mutation(
      api.maintenanceRecordAssets.createIfMissing,
      toConvexDoc(r) as CreateArgs,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
