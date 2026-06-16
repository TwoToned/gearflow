/**
 * One-time (re-runnable) backfill: copy the append-only asset_scan_log event
 * table from Prisma into Convex (table "assetScanLogs").
 *
 * Phase 6 decommission groundwork, dual-write INFRA. Idempotent — skips rows
 * already present in Convex (matched by cuid `id` via createIfMissing). Maps
 * Date -> ms, Decimal -> number, null -> absent (toConvexDoc). Strips nested
 * relations (asset/bulkAsset/kit/project/scannedBy) — findMany returns scalars
 * only here, so toConvexDoc already yields a clean create payload.
 *
 * Scan logs can be high-volume; this processes every row in a simple loop,
 * which is fine for now. See src/lib/asset-scan-log-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-asset-scan-logs.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  let created = 0;
  let skipped = 0;

  const rows = await prisma.assetScanLog.findMany();
  for (const row of rows) {
    // Re-fetch the client each iteration so the 5-min service token refreshes
    // mid-loop (this table is high-volume and the loop can exceed the TTL).
    const convex = await getConvexClient();
    const __res = await convex.mutation(
      api.assetScanLogs.createIfMissing,
      toConvexDoc(row) as FunctionArgs<typeof api.assetScanLogs.createIfMissing>,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(
    `Asset scan log backfill complete: ${created} created, ${skipped} already present ` +
      `(${rows.length} scan logs).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
