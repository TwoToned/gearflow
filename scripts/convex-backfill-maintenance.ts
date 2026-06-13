/**
 * One-time (re-runnable) backfill: copy maintenanceRecord rows from Prisma into
 * Convex.
 *
 * Phase 4 reactive dual-write for the maintenance list / workshop kanban /
 * detail pages. Idempotent — skips rows already present (matched by cuid `id`).
 * Maps Date -> ms, Decimal -> number, null -> absent. Also the heal path. Only
 * the record row is mirrored (the maintenanceRecordAssets join stays Prisma).
 * See src/lib/maintenance-mirror.ts and FEATUREDOCS/54.
 *
 *   npx tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-maintenance.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rows = await prisma.maintenanceRecord.findMany();
  for (const r of rows) {
    if (await convex.query(api.maintenanceRecords.getById, { id: r.id })) { skipped++; continue; }
    await convex.mutation(
      api.maintenanceRecords.create,
      toConvexDoc(r) as FunctionArgs<typeof api.maintenanceRecords.create>,
    );
    created++;
  }

  console.log(`Maintenance backfill complete: ${created} created, ${skipped} already present (${rows.length} records).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
