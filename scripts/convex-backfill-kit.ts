/**
 * One-time (re-runnable) backfill: copy the kit cluster — kit, kit_serialized_item,
 * kit_bulk_item — from Prisma into Convex.
 *
 * Kit central-graph step 1 (Phase 3), dual-write. Idempotent — skips rows already
 * present in Convex (matched by cuid `id`). Maps Date -> Unix ms, Decimal -> number,
 * null -> absent. Also the heal path for the dual-write.
 *
 * SCOPE: kit + the two member sub-tables only. kit_media (composed on the Prisma
 * mirror like every media gallery) and kit_check_item (check-config join, not yet
 * migrated) stay Prisma-only. See src/lib/kit-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-kit.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = (await getConvexClient());
  let created = 0;
  let skipped = 0;

  const kits = await prisma.kit.findMany();
  for (const k of kits) {
    if (await convex.query(api.kits.getById, { id: k.id })) { skipped++; continue; }
    await convex.mutation(api.kits.create, toConvexDoc(k) as FunctionArgs<typeof api.kits.create>);
    created++;
  }

  const serializedItems = await prisma.kitSerializedItem.findMany();
  for (const s of serializedItems) {
    if (await convex.query(api.kitSerializedItems.getById, { id: s.id })) { skipped++; continue; }
    await convex.mutation(api.kitSerializedItems.create, toConvexDoc(s) as FunctionArgs<typeof api.kitSerializedItems.create>);
    created++;
  }

  const bulkItems = await prisma.kitBulkItem.findMany();
  for (const b of bulkItems) {
    if (await convex.query(api.kitBulkItems.getById, { id: b.id })) { skipped++; continue; }
    await convex.mutation(api.kitBulkItems.create, toConvexDoc(b) as FunctionArgs<typeof api.kitBulkItems.create>);
    created++;
  }

  console.log(
    `Kit backfill complete: ${created} created, ${skipped} already present ` +
    `(${kits.length} kits, ${serializedItems.length} serialized items, ${bulkItems.length} bulk items).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
