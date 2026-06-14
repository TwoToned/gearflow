/**
 * Orphan cleanup for the Convex `projectLineItems` table.
 *
 * Why: sub-hire line-item REGENERATION (`generateSubHireLineItemsTx` does a
 * deleteMany + recreate with FRESH cuids) leaves the pre-regen rows orphaned in
 * Convex — the dual-write mirror only adds/patches, it can't know an id vanished
 * from Prisma. This brings Convex back to exactly matching Prisma.
 *
 * ⚠️ `projectLineItems` IS now browser-reactive (the equipment tab subscribes via
 * `listByProject`). So this does NOT truncate (security review P1-5): an old
 * truncate+recreate would briefly empty a live table that reactive readers see.
 * Instead it RECONCILES: insert any missing Prisma row (atomic createIfMissing —
 * no query-then-create race), then remove only the Convex rows whose id is no
 * longer in Prisma. The table is never emptied; readers always see a consistent
 * set. Still gated behind --confirm; --dry-run reports what it would change.
 *
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-resync-line-items.ts --dry-run
 *   pnpm tsx --env-file=.env --env-file=.env.local scripts/convex-resync-line-items.ts --confirm
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
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm");
  if (!dryRun && !confirmed) {
    console.error(
      "Refusing to run without an explicit flag.\n" +
      "  --dry-run   report orphans + missing rows, change nothing\n" +
      "  --confirm   reconcile (create missing, remove orphans)",
    );
    process.exit(2);
  }

  const convex = await getConvexClient();
  const orgIds = (
    await prisma.projectLineItem.findMany({
      distinct: ["organizationId"],
      select: { organizationId: true },
    })
  ).map((r) => r.organizationId);

  let created = 0;
  let removed = 0;

  for (const orgId of orgIds) {
    const rows = await prisma.projectLineItem.findMany({ where: { organizationId: orgId } });
    const prismaIds = new Set(rows.map((r) => r.id));

    // 1. Ensure every Prisma row exists in Convex (atomic, no truncate).
    for (const row of rows) {
      if (dryRun) {
        const exists = await convex.query(api.projectLineItems.getById, { id: row.id });
        if (!exists) created++;
        continue;
      }
      const res = await convex.mutation(
        api.projectLineItems.createIfMissing,
        toConvexDoc(strip(row as unknown as Record<string, unknown>)) as FunctionArgs<typeof api.projectLineItems.createIfMissing>,
      );
      if (res.created) created++;
    }

    // 2. Remove only the orphans (Convex rows whose id is gone from Prisma).
    const existing = await convex.query(api.projectLineItems.list, { orgId });
    for (const row of existing) {
      if (prismaIds.has(row.id)) continue;
      removed++;
      if (!dryRun) await convex.mutation(api.projectLineItems.remove, { id: row.id });
    }
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Line-item reconcile: ${created} missing ` +
    `${dryRun ? "would be created" : "created"}, ${removed} orphan(s) ` +
    `${dryRun ? "would be removed" : "removed"} across ${orgIds.length} org(s).`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
