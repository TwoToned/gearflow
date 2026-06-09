/**
 * One-time (re-runnable) backfill: copy the Location table from Prisma into Convex.
 *
 * Locations domain (Phase 3). Idempotent — skips locations already present in
 * Convex (matched by cuid `id`). Maps Date -> Unix ms, null -> absent (see
 * toConvexDoc). Also the heal path for the dual-write. `parentId` is a plain
 * stored string in Convex (no real FK), so insertion order is irrelevant — a
 * child can be copied before its parent. Run after the Convex stack is up +
 * schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-locations.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type LocationCreateArgs = FunctionArgs<typeof api.locations.create>;

async function main() {
  const convex = (await getConvexClient());
  const locations = await prisma.location.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${locations.length} locations in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const l of locations) {
    const existing = await convex.query(api.locations.getById, { id: l.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.locations.create, toConvexDoc(l) as LocationCreateArgs);
    created++;
    console.log(`  + ${l.name} (${l.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
