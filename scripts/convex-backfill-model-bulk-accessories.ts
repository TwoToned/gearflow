/**
 * One-time (re-runnable) backfill: copy `model_bulk_accessory` from Prisma into
 * Convex (table "modelBulkAccessories").
 *
 * Dual-write INFRA-ONLY (no reactive consumer yet) — keeps the central graph
 * complete for the eventual Prisma decommission. Idempotent: skips rows already
 * present in Convex (matched by cuid `id`). Maps Date -> ms, Decimal -> number,
 * null -> absent via toConvexDoc. Also the heal path.
 * See src/lib/model-bulk-accessory-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-model-bulk-accessories.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

/** Scalar columns the Convex create validator accepts (relations stripped). */
const SCALAR_KEYS = new Set([
  "id", "organizationId", "modelId", "bulkAssetId", "quantity", "sortOrder",
  "notes", "addedAt", "addedById",
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

  const rows = await prisma.modelBulkAccessory.findMany();
  for (const row of rows) {
    const doc = strip(toConvexDoc(row as unknown as Record<string, unknown>));
    const res = await convex.mutation(
      api.modelBulkAccessories.createIfMissing,
      doc as FunctionArgs<typeof api.modelBulkAccessories.createIfMissing>,
    );
    if (res.created) created++;
    else skipped++;
  }

  console.log(
    `Model bulk accessory backfill complete: ${created} created, ${skipped} already present ` +
    `(${rows.length} total).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
