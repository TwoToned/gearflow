/**
 * Phase 2a backfill for the line-item fulfillment model.
 *
 * See docs/designs/line-item-fulfillment-model.md.
 *
 * What this does (the SAFE, additive half of Phase 2):
 *   For every ProjectLineItem that has a physical thing assigned to it
 *   (a serialised `assetId` or a bulk `bulkAssetId`), create exactly one
 *   ProjectLineItemUnit row carrying that line's current per-unit state,
 *   then recompute the rollup counters on the line.
 *
 * What this does NOT do:
 *   It does not collapse split siblings (the qty-1 rows a `10x` line was
 *   split into) back into one order line. That is Phase 2b — hazardous,
 *   needs a production-data dry-run, and is best run adjacent to the
 *   Phase 3 reader/writer cutover. This script only populates units
 *   alongside the existing data; nothing reads the new rows yet, so it is
 *   non-destructive and reversible (delete the created rows).
 *
 * Idempotent: a line item that already has unit rows is skipped, so the
 * script is safe to re-run.
 *
 * Usage:
 *   tsx --env-file=.env scripts/backfill-line-item-units.ts            # dry-run
 *   tsx --env-file=.env scripts/backfill-line-item-units.ts --apply    # writes
 *   tsx --env-file=.env scripts/backfill-line-item-units.ts --org <id> # one org
 */

import { prisma } from "../src/lib/prisma";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgArgIndex = args.indexOf("--org");
const orgFilter = orgArgIndex >= 0 ? args[orgArgIndex + 1] : null;

interface Plan {
  lineItemId: string;
  projectId: string;
  kind: "serialised" | "bulk";
  unitQuantity: number;
  status: string;
}

async function main() {
  console.log("Line-item unit backfill (Phase 2a)");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will mutate)" : "dry-run"}`);
  if (orgFilter) console.log(`Org filter: ${orgFilter}`);
  console.log();

  // Only line items with something physical assigned get a unit. Service /
  // labour / transport lines and unsourced equipment orders get none.
  const lineItems = await prisma.projectLineItem.findMany({
    where: {
      ...(orgFilter ? { organizationId: orgFilter } : {}),
      OR: [{ assetId: { not: null } }, { bulkAssetId: { not: null } }],
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      assetId: true,
      bulkAssetId: true,
      quantity: true,
      returnedQuantity: true,
      status: true,
      prepStatus: true,
      prepContainer: true,
      checkedOutAt: true,
      checkedOutById: true,
      returnedAt: true,
      returnedById: true,
      returnCondition: true,
      returnStatus: true,
      returnNotes: true,
      _count: { select: { units: true } },
    },
    orderBy: [{ organizationId: "asc" }, { projectId: "asc" }],
  });

  console.log(`Scanned ${lineItems.length} line items with an asset assigned.\n`);

  const todo: Plan[] = [];
  let alreadyDone = 0;

  for (const li of lineItems) {
    if (li._count.units > 0) {
      alreadyDone++;
      continue;
    }
    const kind = li.bulkAssetId ? "bulk" : "serialised";
    todo.push({
      lineItemId: li.id,
      projectId: li.projectId,
      kind,
      // Serialised: one physical unit. Bulk: the unit row carries the
      // ordered quantity (bulk assets are a stock pool, not N rows).
      unitQuantity: kind === "bulk" ? li.quantity : 1,
      status: li.status,
    });
  }

  console.log(`Already have units: ${alreadyDone}`);
  console.log(`Need a unit row:    ${todo.length}`);
  const serialised = todo.filter((t) => t.kind === "serialised").length;
  console.log(`  serialised: ${serialised}   bulk: ${todo.length - serialised}`);
  console.log();

  if (todo.length === 0) {
    console.log("✓ Nothing to backfill.");
    return;
  }

  if (!apply) {
    console.log("(Dry run — no changes made. Re-run with --apply to write.)");
    return;
  }

  console.log("Applying in 5 seconds. Ctrl-C to abort…");
  await new Promise((r) => setTimeout(r, 5000));

  let created = 0;
  for (const li of lineItems) {
    if (li._count.units > 0) continue;
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction — another run / writer may have
      // created the unit since the scan above.
      const existing = await tx.projectLineItemUnit.count({
        where: { lineItemId: li.id },
      });
      if (existing > 0) return;

      const isBulk = !!li.bulkAssetId;
      await tx.projectLineItemUnit.create({
        data: {
          organizationId: li.organizationId,
          lineItemId: li.id,
          ordinal: 1,
          assetId: li.assetId,
          bulkAssetId: li.bulkAssetId,
          quantity: isBulk ? li.quantity : 1,
          returnedQuantity: isBulk
            ? li.returnedQuantity
            : li.status === "RETURNED"
              ? 1
              : 0,
          status: li.status,
          prepStatus: li.prepStatus,
          prepContainer: li.prepContainer,
          checkedOutAt: li.checkedOutAt,
          checkedOutById: li.checkedOutById,
          returnedAt: li.returnedAt,
          returnedById: li.returnedById,
          returnCondition: li.returnCondition,
          returnStatus: li.returnStatus,
          returnNotes: li.returnNotes,
        },
      });

      // Recompute the order-line rollup counters from its units.
      const units = await tx.projectLineItemUnit.findMany({
        where: { lineItemId: li.id },
        select: {
          quantity: true,
          prepStatus: true,
          returnCondition: true,
          returnStatus: true,
        },
      });
      const sum = (pred: (u: (typeof units)[number]) => boolean) =>
        units.filter(pred).reduce((n, u) => n + u.quantity, 0);
      await tx.projectLineItem.update({
        where: { id: li.id },
        data: {
          assignedQuantity: units.reduce((n, u) => n + u.quantity, 0),
          packedQuantity: sum((u) => u.prepStatus === "PACKED"),
          damagedQuantity: sum((u) => u.returnCondition === "DAMAGED"),
          lostQuantity: sum((u) => u.returnStatus === "LOST"),
        },
      });
      created++;
    });
  }

  console.log(`✓ Created ${created} unit rows and updated their line counters.`);
  if (created !== todo.length) {
    console.log(
      `  (${todo.length - created} were already populated by the time we wrote — concurrent run, safe to ignore.)`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error("\nBackfill failed:", err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
