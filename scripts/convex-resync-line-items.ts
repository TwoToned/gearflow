/**
 * Clean TRUNCATE + BACKFILL of the Convex `projectLineItems` table.
 *
 * Why: sub-hire line-item REGENERATION (`generateSubHireLineItemsTx` does a
 * deleteMany + recreate with FRESH cuids) leaves the pre-regen rows orphaned in
 * Convex — the dual-write mirror only adds/patches, it can't know an id vanished
 * from Prisma. project_line_item is infra-only (no Convex consumer), so the orphans
 * are harmless, but this resync clears them so Convex exactly matches Prisma. See
 * FEATUREDOCS/54 (sub-hire family known limitation).
 *
 * Per org: list the Convex line items, delete ALL of them (truncate), then
 * re-create every Prisma row. After this, Convex count == Prisma count exactly.
 * Safe to run any time — project_line_item has no reactive reader yet.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-resync-line-items.ts
 */
import { type FunctionArgs } from "convex/server";
import { prisma } from "@/lib/prisma";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../convex/_generated/api";

const RELATION_KEYS = new Set([
  "model", "asset", "bulkAsset", "kit", "supplier", "category", "group",
  "parentLineItem", "childLineItems", "units", "project", "subHire",
  "subHireItem", "subHireGroup", "checkRecords", "damageEvents",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

async function main() {
  const convex = getConvexClient();

  const orgIds = (
    await prisma.projectLineItem.findMany({
      distinct: ["organizationId"],
      select: { organizationId: true },
    })
  ).map((r) => r.organizationId);

  let removed = 0;
  let created = 0;

  for (const orgId of orgIds) {
    // 1. Truncate: delete every Convex line item for this org (incl. orphans).
    const existing = await convex.query(api.projectLineItems.list, { orgId });
    for (const row of existing) {
      await convex.mutation(api.projectLineItems.remove, { id: row.id });
      removed++;
    }

    // 2. Backfill: re-create from Prisma (the current source of truth).
    const rows = await prisma.projectLineItem.findMany({ where: { organizationId: orgId } });
    for (const row of rows) {
      await convex.mutation(
        api.projectLineItems.create,
        toConvexDoc(strip(row as unknown as Record<string, unknown>)) as FunctionArgs<typeof api.projectLineItems.create>,
      );
      created++;
    }
  }

  // Verify per-org parity.
  let mismatch = false;
  for (const orgId of orgIds) {
    const convexCount = (await convex.query(api.projectLineItems.list, { orgId })).length;
    const prismaCount = await prisma.projectLineItem.count({ where: { organizationId: orgId } });
    if (convexCount !== prismaCount) {
      mismatch = true;
      console.error(`MISMATCH org ${orgId}: Convex ${convexCount} != Prisma ${prismaCount}`);
    }
  }

  console.log(
    `Line-item resync complete: ${removed} removed, ${created} re-created across ` +
    `${orgIds.length} org(s). ${mismatch ? "PARITY CHECK FAILED" : "Convex == Prisma."}`,
  );
  await prisma.$disconnect();
  if (mismatch) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
