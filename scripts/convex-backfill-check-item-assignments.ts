/**
 * One-time (re-runnable) backfill: copy the check-item ASSIGNMENT join tables —
 * `model_check_item` and `kit_check_item` — from Prisma into Convex.
 *
 * These tables have Phase-2 Convex CRUD but were not dual-written until this
 * session, so their Convex copies start empty/stale. Idempotent — skips rows
 * already present in Convex (matched by cuid `id`). Maps Date -> Unix ms, null ->
 * absent. Also the heal path for the dual-write. Run after the Convex stack is up
 * + schema deployed:
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-check-item-assignments.ts
 *
 * See FEATUREDOCS/54 and docs/designs/convex-hybrid-migration.md.
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

type ModelCheckItemCreateArgs = FunctionArgs<typeof api.modelCheckItems.create>;
type KitCheckItemCreateArgs = FunctionArgs<typeof api.kitCheckItems.create>;

function modelCheckItemDoc(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organizationId, modelId: row.modelId,
    checkItemId: row.checkItemId, sortOrder: row.sortOrder, createdAt: row.createdAt,
  };
}
function kitCheckItemDoc(row: Record<string, unknown>) {
  return {
    id: row.id, organizationId: row.organizationId, kitId: row.kitId,
    checkItemId: row.checkItemId, sortOrder: row.sortOrder, createdAt: row.createdAt,
  };
}

async function main() {
  const convex = await getConvexClient();

  const modelChecks = await prisma.modelCheckItem.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${modelChecks.length} model_check_item rows in Prisma.`);
  let mCreated = 0, mSkipped = 0;
  for (const r of modelChecks) {
    const res = await convex.mutation(
      api.modelCheckItems.createIfMissing,
      toConvexDoc(modelCheckItemDoc(r as unknown as Record<string, unknown>)) as ModelCheckItemCreateArgs,
    );
    if (res.created) mCreated++; else mSkipped++;
  }

  const kitChecks = await prisma.kitCheckItem.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Found ${kitChecks.length} kit_check_item rows in Prisma.`);
  let kCreated = 0, kSkipped = 0;
  for (const r of kitChecks) {
    const res = await convex.mutation(
      api.kitCheckItems.createIfMissing,
      toConvexDoc(kitCheckItemDoc(r as unknown as Record<string, unknown>)) as KitCheckItemCreateArgs,
    );
    if (res.created) kCreated++; else kSkipped++;
  }

  console.log(`\nBackfill complete:`);
  console.log(`  model_check_item: ${mCreated} created, ${mSkipped} already present.`);
  console.log(`  kit_check_item:   ${kCreated} created, ${kSkipped} already present.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
