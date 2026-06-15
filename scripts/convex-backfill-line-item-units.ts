/**
 * One-time (re-runnable) backfill: copy project_line_item_unit rows from Prisma
 * into Convex.
 *
 * Phase 6 decommission groundwork. Units are the fulfillment source of truth
 * (one row per physical asset on a line); their reads in the equipment editor /
 * warehouse / PDF pipeline move to Convex once this populates the mirror.
 * Idempotent — skips rows already present (matched by cuid `id`). Maps Date -> ms,
 * Decimal -> number, null -> absent. Also the heal path for the authoritative
 * per-line-item reconcile in src/lib/line-item-unit-mirror.ts. See FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-line-item-units.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const units = await prisma.projectLineItemUnit.findMany();
  for (const u of units) {
    const __res = await convex.mutation(
      api.projectLineItemUnits.createIfMissing,
      toConvexDoc(u) as FunctionArgs<typeof api.projectLineItemUnits.createIfMissing>,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(
    `Line-item-unit backfill complete: ${created} created, ${skipped} already present (${units.length} units).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
