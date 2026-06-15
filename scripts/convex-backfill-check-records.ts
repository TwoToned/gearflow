/**
 * One-time (re-runnable) backfill: copy check_record rows from Prisma into
 * Convex (table "checkRecords").
 *
 * Dual-write groundwork (Phase 6 decommission). Idempotent — skips rows already
 * present in Convex (matched by cuid `id`). Maps Date -> ms, Decimal -> number,
 * null -> absent. Also the heal path. See src/lib/check-record-mirror.ts and
 * FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-check-records.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

/** Scalar columns the Convex checkRecords create validator accepts. */
const SCALAR_KEYS = new Set([
  "id",
  "organizationId",
  "context",
  "lineItemId",
  "lineItemUnitId",
  "assetId",
  "bulkAssetId",
  "kitId",
  "checkItemId",
  "checkItemLabelSnapshot",
  "checkItemTypeSnapshot",
  "result",
  "value",
  "notes",
  "photos",
  "performedById",
  "performedAt",
]);

function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const records = await prisma.checkRecord.findMany();
  for (const r of records) {
    const doc = strip(toConvexDoc(r as unknown as Record<string, unknown>));
    const __res = await convex.mutation(
      api.checkRecords.createIfMissing,
      doc as FunctionArgs<typeof api.checkRecords.createIfMissing>,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(
    `Check record backfill complete: ${created} created, ${skipped} already present ` +
      `(${records.length} total).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
