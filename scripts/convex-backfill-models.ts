/**
 * One-time (re-runnable) backfill: copy the Model table from Prisma into Convex.
 *
 * Models domain (Phase 3). Idempotent — skips models already present in Convex
 * (matched by cuid `id`). Maps Date -> Unix ms, Prisma Decimal -> number, null ->
 * absent, and passes the Json `specifications`/`customFields` through unchanged
 * (Convex `v.any()`). Also the heal path for the dual-write. Run after the Convex
 * stack is up + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-models.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type ModelCreateArgs = FunctionArgs<typeof api.models.create>;

async function main() {
  const convex = (await getConvexClient());
  const models = await prisma.model.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${models.length} models in Prisma.`);

  let created = 0;
  let skipped = 0;
  for (const m of models) {
    const existing = await convex.query(api.models.getById, { id: m.id });
    if (existing) {
      skipped++;
      continue;
    }
    await convex.mutation(api.models.create, toConvexDoc(m) as ModelCreateArgs);
    created++;
    console.log(`  + ${m.name} (${m.id})`);
  }

  console.log(`\nBackfill complete: ${created} created, ${skipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
