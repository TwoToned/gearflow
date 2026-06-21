/**
 * One-time (re-runnable) backfill: copy the WarehouseDashboardToken table from
 * Prisma into Convex.
 *
 * Bucket-2 Phase B write inversion. Idempotent — skips tokens already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent. Run once
 * BEFORE the Convex-only read rewiring deploys (else existing tokens read empty):
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-warehouse-dashboard-tokens.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-decommission-RUNBOOK.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CreateArgs = FunctionArgs<typeof api.warehouseDashboardTokens.create>;

async function main() {
  const convex = await getConvexClient();
  const rows = await prisma.warehouseDashboardToken.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${rows.length} warehouse dashboard tokens in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const __res = await convex.mutation(
      api.warehouseDashboardTokens.createIfMissing,
      toConvexDoc(r) as CreateArgs,
    );
    if (__res.created) created++;
    else skipped++;
    console.log(`  + ${r.name} (${r.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
