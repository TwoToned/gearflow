/**
 * One-time (re-runnable) backfill: copy the project grouping substructure —
 * project_category + project_group — from Prisma into Convex.
 *
 * Central-graph step 3 (Phase 3), dual-write INFRA-ONLY (no reactive consumer —
 * composed in the equipment editor that stays on Prisma). Idempotent — skips rows
 * already present in Convex (matched by cuid `id`). Maps Date -> ms, Decimal ->
 * number, null -> absent. Also the heal path. category_slot stays Prisma-only.
 * See src/lib/project-grouping-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-project-grouping.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = (await getConvexClient());
  let created = 0;
  let skipped = 0;

  const categories = await prisma.projectCategory.findMany();
  for (const c of categories) {
    { const __res = await convex.mutation(api.projectCategories.createIfMissing, toConvexDoc(c) as FunctionArgs<typeof api.projectCategories.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  const groups = await prisma.projectGroup.findMany();
  for (const g of groups) {
    { const __res = await convex.mutation(api.projectGroups.createIfMissing, toConvexDoc(g) as FunctionArgs<typeof api.projectGroups.createIfMissing>); if (__res.created) created++; else skipped++; }
  }

  console.log(
    `Project grouping backfill complete: ${created} created, ${skipped} already present ` +
    `(${categories.length} categories, ${groups.length} groups).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
