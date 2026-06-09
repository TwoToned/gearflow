/**
 * One-time (re-runnable) backfill: copy the Category table from Prisma into Convex.
 *
 * Categories domain (Phase 3). Idempotent — skips categories already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent. `parentId`
 * is a plain stored string in Convex (no real FK), so insertion order is
 * irrelevant — a child can be copied before its parent. Also the heal path for
 * the dual-write. Run after the Convex stack is up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-categories.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CategoryCreateArgs = FunctionArgs<typeof api.categories.create>;

async function main() {
  const convex = (await getConvexClient());
  const categories = await prisma.category.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${categories.length} categories in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const c of categories) {
    const existing = await convex.query(api.categories.getById, { id: c.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.categories.create, toConvexDoc(c) as CategoryCreateArgs);
    created++;
    console.log(`  + ${c.name} (${c.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
