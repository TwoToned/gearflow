/**
 * One-shot reconcile of BulkAsset.availableQuantity against authoritative joins.
 *
 * Why: `availableQuantity` is a denormalized field that prior code paths
 * mutated inconsistently (notably kit checkout/checkin didn't touch bulk
 * quantities at all). Production data has drifted. This script computes the
 * true value from joins and reports the drift, optionally fixing it.
 *
 * Invariant we enforce:
 *
 *     availableQuantity = totalQuantity
 *       − Σ(ProjectLineItem.quantity where bulkAssetId=X
 *           AND status IN (PREPPED, CHECKED_OUT)
 *           AND isKitChild = false)
 *       − Σ(KitBulkItem.quantity for kits with status=CHECKED_OUT
 *           that contain this bulk)
 *
 * Usage:
 *   npx tsx scripts/reconcile-bulk-availability.ts              # dry-run, prints drift
 *   npx tsx scripts/reconcile-bulk-availability.ts --apply       # writes the fix
 *   npx tsx scripts/reconcile-bulk-availability.ts --org <id>    # limit to one org
 *
 * Safety: dry-run by default. --apply prompts a 5-second countdown before
 * mutating. The update wraps every fix in a transaction.
 */

import { prisma } from "../src/lib/prisma";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgArgIndex = args.indexOf("--org");
const orgFilter = orgArgIndex >= 0 ? args[orgArgIndex + 1] : null;

interface Drift {
  organizationId: string;
  bulkAssetId: string;
  assetTag: string;
  total: number;
  currentAvailable: number;
  expectedAvailable: number;
  delta: number;
  directlyConsumed: number;
  kitConsumed: number;
}

async function main() {
  console.log("BulkAsset availability reconcile");
  console.log("─".repeat(60));
  console.log(`Mode: ${apply ? "APPLY (will mutate)" : "dry-run"}`);
  if (orgFilter) console.log(`Org filter: ${orgFilter}`);
  console.log();

  const bulkAssets = await prisma.bulkAsset.findMany({
    where: orgFilter ? { organizationId: orgFilter } : {},
    select: {
      id: true,
      organizationId: true,
      assetTag: true,
      totalQuantity: true,
      availableQuantity: true,
    },
    orderBy: [{ organizationId: "asc" }, { assetTag: "asc" }],
  });

  console.log(`Checking ${bulkAssets.length} bulk assets…\n`);

  const drifts: Drift[] = [];

  for (const ba of bulkAssets) {
    // Direct consumption: standalone line items (not kit children) in active states
    const directRows = await prisma.projectLineItem.aggregate({
      where: {
        bulkAssetId: ba.id,
        isKitChild: false,
        status: { in: ["PREPPED", "CHECKED_OUT"] },
      },
      _sum: { quantity: true },
    });
    const directlyConsumed = directRows._sum.quantity ?? 0;

    // Kit consumption: KitBulkItem.quantity summed over kits with status CHECKED_OUT
    // that hold this bulk asset.
    const kitRows = await prisma.kitBulkItem.findMany({
      where: {
        bulkAssetId: ba.id,
        kit: { status: "CHECKED_OUT" },
      },
      select: { quantity: true },
    });
    const kitConsumed = kitRows.reduce((sum, r) => sum + r.quantity, 0);

    const expectedAvailable = ba.totalQuantity - directlyConsumed - kitConsumed;
    const delta = ba.availableQuantity - expectedAvailable;

    if (delta !== 0) {
      drifts.push({
        organizationId: ba.organizationId,
        bulkAssetId: ba.id,
        assetTag: ba.assetTag,
        total: ba.totalQuantity,
        currentAvailable: ba.availableQuantity,
        expectedAvailable,
        delta,
        directlyConsumed,
        kitConsumed,
      });
    }
  }

  if (drifts.length === 0) {
    console.log("✓ All bulk assets are reconciled. No drift detected.");
    return;
  }

  console.log(`⚠ ${drifts.length} bulk assets with drift:\n`);
  console.log(
    "tag".padEnd(20) +
      "total".padStart(7) +
      "current".padStart(9) +
      "expected".padStart(10) +
      "delta".padStart(7) +
      "  direct/kit",
  );
  console.log("─".repeat(80));
  for (const d of drifts) {
    console.log(
      d.assetTag.padEnd(20) +
        String(d.total).padStart(7) +
        String(d.currentAvailable).padStart(9) +
        String(d.expectedAvailable).padStart(10) +
        (d.delta > 0 ? `+${d.delta}` : String(d.delta)).padStart(7) +
        `   ${d.directlyConsumed}/${d.kitConsumed}`,
    );
  }
  console.log();

  const totalDelta = drifts.reduce((sum, d) => sum + Math.abs(d.delta), 0);
  console.log(`Total absolute drift across all bulk assets: ${totalDelta} units`);
  console.log();

  if (!apply) {
    console.log("(Dry run — no changes made. Re-run with --apply to fix.)");
    return;
  }

  console.log("Applying fixes in 5 seconds. Ctrl-C to abort…");
  await new Promise((r) => setTimeout(r, 5000));

  let updated = 0;
  for (const d of drifts) {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction to avoid races with live writes
      const current = await tx.bulkAsset.findUnique({
        where: { id: d.bulkAssetId },
        select: { availableQuantity: true },
      });
      if (!current) return;
      if (current.availableQuantity === d.expectedAvailable) return; // already fixed by another writer
      await tx.bulkAsset.update({
        where: { id: d.bulkAssetId },
        data: { availableQuantity: d.expectedAvailable },
      });
      updated++;
    });
  }

  console.log(`✓ Fixed ${updated} bulk assets.`);
  if (updated !== drifts.length) {
    console.log(
      `  (${drifts.length - updated} were already at expected value by the time we wrote — likely concurrent writers, safe to ignore.)`,
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error("\nReconcile failed:", err);
    return prisma.$disconnect().finally(() => process.exit(1));
  });
