/**
 * One-time (re-runnable) backfill: copy savedTableView rows from Prisma into
 * Convex. Phase 4 reactive dual-write for the table saved-view dropdowns.
 * Idempotent — skips rows already present (matched by cuid `id`). See
 * src/lib/saved-views-mirror.ts and FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-saved-views.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rows = await prisma.savedTableView.findMany();
  for (const r of rows) {
    if (await convex.query(api.savedTableViews.getById, { id: r.id })) { skipped++; continue; }
    await convex.mutation(
      api.savedTableViews.create,
      toConvexDoc(r) as FunctionArgs<typeof api.savedTableViews.create>,
    );
    created++;
  }

  console.log(`Saved-views backfill complete: ${created} created, ${skipped} already present (${rows.length} rows).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
