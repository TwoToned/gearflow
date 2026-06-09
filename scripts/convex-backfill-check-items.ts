/**
 * One-time (re-runnable) backfill: copy the CheckItem table from Prisma into Convex.
 *
 * Check-items domain (Phase 3). Idempotent — skips check items already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent, and passes
 * the Json `dropdownOptions` through unchanged (Convex `v.any()`). Also the heal
 * path for the dual-write. Run after the Convex stack is up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-check-items.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type CheckItemCreateArgs = FunctionArgs<typeof api.checkItems.create>;

async function main() {
  const convex = (await getConvexClient());
  const items = await prisma.checkItem.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${items.length} check items in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const c of items) {
    const existing = await convex.query(api.checkItems.getById, { id: c.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.checkItems.create, toConvexDoc(c) as CheckItemCreateArgs);
    created++;
    console.log(`  + ${c.label} (${c.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
