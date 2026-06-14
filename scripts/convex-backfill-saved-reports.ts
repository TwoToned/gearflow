/**
 * One-time (re-runnable) backfill: copy savedReport rows from Prisma into Convex.
 * Phase 4 reactive dual-write for the reports page. Idempotent — skips rows
 * already present (matched by cuid `id`). See src/lib/saved-reports-mirror.ts
 * and FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-saved-reports.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rows = await prisma.savedReport.findMany();
  for (const r of rows) {
    const __res = await convex.mutation(api.savedReports.createIfMissing, toConvexDoc(r) as FunctionArgs<typeof api.savedReports.createIfMissing>);
    if (__res.created) created++; else skipped++;
  }

  console.log(`Saved-reports backfill complete: ${created} created, ${skipped} already present (${rows.length} rows).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
