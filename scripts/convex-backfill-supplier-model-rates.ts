/**
 * One-time (re-runnable) backfill: copy supplier_model_rate from Prisma into
 * Convex ("supplierModelRates"). Dual-write INFRA-ONLY (no reactive consumer yet
 * — keeps the Convex graph complete for the eventual Prisma decommission).
 * Idempotent — skips rows already present in Convex (matched by cuid `id`). Maps
 * Date -> ms, Decimal -> number, null -> absent. Also the heal path.
 * See src/lib/supplier-model-rate-mirror.ts and FEATUREDOCS/54.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-backfill-supplier-model-rates.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const RATE_SCALAR_KEYS = new Set([
  "id", "organizationId", "supplierId", "modelId", "lastUnitCost",
  "pricingType", "lastUsedAt", "updatedAt",
]);

function stripRate(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (RATE_SCALAR_KEYS.has(k)) out[k] = v;
  }
  return out;
}

async function main() {
  const convex = await getConvexClient();
  let created = 0;
  let skipped = 0;

  const rates = await prisma.supplierModelRate.findMany();
  for (const r of rates) {
    const doc = stripRate(toConvexDoc(r as unknown as Record<string, unknown>));
    const __res = await convex.mutation(
      api.supplierModelRates.createIfMissing,
      doc as FunctionArgs<typeof api.supplierModelRates.createIfMissing>,
    );
    if (__res.created) created++;
    else skipped++;
  }

  console.log(
    `Supplier model rate backfill complete: ${created} created, ${skipped} already present ` +
    `(${rates.length} total).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
