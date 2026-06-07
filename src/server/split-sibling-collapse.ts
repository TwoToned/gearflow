/**
 * Apply-side of the Phase 3.8 split-sibling collapse migration.
 *
 * The pure plan / equivalence-key logic lives in
 * `src/lib/split-sibling-collapse.ts`. This module owns the
 * transactional writes: moving units, repointing CheckRecord /
 * DamageEvent / ProjectService FKs, deactivating the sibling row, and
 * writing the LineItemMergeMap audit row.
 *
 * Lives outside `"use server"` so the script and integration tests can
 * drive it directly.
 *
 * See docs/designs/line-item-fulfillment-model.md (Phase 2b).
 */

import { prisma } from "@/lib/prisma";
import {
  planAll,
  type CollapseRow,
  type GroupPlan,
} from "@/lib/split-sibling-collapse";
import { nextOrdinal } from "@/lib/line-item-units";
import { syncLineItemRollup } from "@/lib/line-item-fulfillment";

export interface CollapseRunStats {
  groupsTotal: number;
  groupsMergeable: number;
  groupsFlagged: number;
  rowsMergedAway: number;
  unitsMoved: number;
  checkRecordsRepointed: number;
  damageEventsRepointed: number;
  servicesRepointed: number;
  /** Echoed back for logging — caller-supplied. */
  runId: string;
}

export interface CollapseRunResult {
  stats: CollapseRunStats;
  plans: GroupPlan[];
  /** Plans where flags.length === 0. */
  mergeable: GroupPlan[];
  flagged: GroupPlan[];
}

/** Snapshot of the columns the planner needs. */
const CANDIDATE_SELECT = {
  id: true,
  organizationId: true,
  projectId: true,
  type: true,
  modelId: true,
  assetId: true,
  bulkAssetId: true,
  kitId: true,
  isKitChild: true,
  parentLineItemId: true,
  pricingMode: true,
  description: true,
  quantity: true,
  unitPrice: true,
  pricingType: true,
  duration: true,
  discount: true,
  priceOverridden: true,
  overrideReason: true,
  sortOrder: true,
  groupName: true,
  categoryId: true,
  groupId: true,
  notes: true,
  isOptional: true,
  isContainerLineItem: true,
  isCustomItem: true,
  showSubhireOnDocs: true,
  supplierId: true,
  subhireOrderNumber: true,
  supplierOrderId: true,
  subHireId: true,
  subHireItemId: true,
  subHireGroupId: true,
  createdAt: true,
} as const;

export interface RunOptions {
  /** Pass true to actually mutate. Otherwise plan-only. */
  apply: boolean;
  /** Scope to one org. */
  organizationId?: string;
  /** Scope to one project (helpful for testing). */
  projectId?: string;
  /** Stamped on every LineItemMergeMap row. */
  runId: string;
}

/**
 * Find every split-sibling group in scope, plan the merges, and
 * (if `apply`) execute them group by group. Each group runs in its own
 * transaction so one pathological group fails alone.
 */
export async function runCollapse(opts: RunOptions): Promise<CollapseRunResult> {
  const candidates = await prisma.projectLineItem.findMany({
    where: {
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      type: "EQUIPMENT",
      OR: [{ assetId: { not: null } }, { bulkAssetId: { not: null } }],
      isKitChild: false,
      // Skip already-merged-away rows.
      NOT: { AND: [{ status: "CANCELLED" }, { quantity: 0 }] },
    },
    select: CANDIDATE_SELECT,
    orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const plans = planAll(candidates as unknown as CollapseRow[]);
  const mergeable = plans.filter((p) => p.flags.length === 0);
  const flagged = plans.filter((p) => p.flags.length > 0);

  const stats: CollapseRunStats = {
    groupsTotal: plans.length,
    groupsMergeable: mergeable.length,
    groupsFlagged: flagged.length,
    rowsMergedAway: 0,
    unitsMoved: 0,
    checkRecordsRepointed: 0,
    damageEventsRepointed: 0,
    servicesRepointed: 0,
    runId: opts.runId,
  };

  if (!opts.apply) {
    // Dry-run still reports what WOULD merge.
    for (const p of mergeable) stats.rowsMergedAway += p.moves.length;
    return { stats, plans, mergeable, flagged };
  }

  for (const plan of mergeable) {
    // Re-find canonical's org each iteration — cheaper than building a
    // map and clearer for the audit row.
    const canonical = await prisma.projectLineItem.findUnique({
      where: { id: plan.canonicalId },
      select: { organizationId: true },
    });
    if (!canonical) continue;
    await mergeGroup(plan, canonical.organizationId, opts.runId, stats);
  }

  return { stats, plans, mergeable, flagged };
}

/**
 * Execute one merge group atomically. Exported for the integration test.
 */
export async function mergeGroup(
  plan: GroupPlan,
  organizationId: string,
  runId: string,
  stats: CollapseRunStats,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const canonicalUnits = await tx.projectLineItemUnit.findMany({
      where: { lineItemId: plan.canonicalId },
      select: { ordinal: true },
    });
    const usedOrdinals = new Set(canonicalUnits.map((u) => u.ordinal));

    let quantityAdded = 0;

    for (const move of plan.moves) {
      // Look up the sibling's existing unit (Phase 2a backfill creates
      // one per asset). Absent ⇒ pre-Phase-2a or kit child — repoint
      // FKs anyway, just skip the lineItemUnitId enrichment.
      let unit: { id: string } | null = null;
      if (move.assetId) {
        unit = await tx.projectLineItemUnit.findUnique({
          where: {
            lineItemId_assetId: {
              lineItemId: move.siblingId,
              assetId: move.assetId,
            },
          },
          select: { id: true },
        });
      } else if (move.bulkAssetId) {
        unit = await tx.projectLineItemUnit.findFirst({
          where: {
            lineItemId: move.siblingId,
            bulkAssetId: move.bulkAssetId,
          },
          select: { id: true },
        });
      }

      let movedUnitId: string | null = null;
      if (unit) {
        let ord = nextOrdinal(
          [...usedOrdinals].map((o) => ({ ordinal: o })),
        );
        // Defensive: nextOrdinal returns max+1; loop in case of races.
        while (usedOrdinals.has(ord)) ord += 1;
        usedOrdinals.add(ord);

        await tx.projectLineItemUnit.update({
          where: { id: unit.id },
          data: { lineItemId: plan.canonicalId, ordinal: ord },
        });
        movedUnitId = unit.id;
        stats.unitsMoved += 1;
      }

      // Repoint CheckRecord — first the matching-asset rows get
      // lineItemUnitId filled too; remaining rows just get the FK
      // updated.
      if (movedUnitId && (move.assetId || move.bulkAssetId)) {
        const matched = await tx.checkRecord.updateMany({
          where: {
            lineItemId: move.siblingId,
            ...(move.assetId
              ? { assetId: move.assetId }
              : { bulkAssetId: move.bulkAssetId }),
          },
          data: { lineItemId: plan.canonicalId, lineItemUnitId: movedUnitId },
        });
        stats.checkRecordsRepointed += matched.count;
      }
      const remaining = await tx.checkRecord.updateMany({
        where: { lineItemId: move.siblingId },
        data: { lineItemId: plan.canonicalId },
      });
      stats.checkRecordsRepointed += remaining.count;

      if (movedUnitId && (move.assetId || move.bulkAssetId)) {
        const matched = await tx.damageEvent.updateMany({
          where: {
            lineItemId: move.siblingId,
            ...(move.assetId
              ? { assetId: move.assetId }
              : { bulkAssetId: move.bulkAssetId }),
          },
          data: { lineItemId: plan.canonicalId, lineItemUnitId: movedUnitId },
        });
        stats.damageEventsRepointed += matched.count;
      }
      const remainingDmg = await tx.damageEvent.updateMany({
        where: { lineItemId: move.siblingId },
        data: { lineItemId: plan.canonicalId },
      });
      stats.damageEventsRepointed += remainingDmg.count;

      const serviceMove = await tx.projectService.updateMany({
        where: { lineItemId: move.siblingId },
        data: { lineItemId: plan.canonicalId },
      });
      stats.servicesRepointed += serviceMove.count;

      // Audit row — permanent. Never auto-cleaned.
      await tx.lineItemMergeMap.create({
        data: {
          organizationId,
          oldLineItemId: move.siblingId,
          canonicalLineItemId: plan.canonicalId,
          movedUnitId,
          checkRecordsRepointed: 0, // per-row counts aggregate at stats level
          damageEventsRepointed: 0,
          serviceRepointed: serviceMove.count > 0,
          notes: `${runId} | key=${plan.key}`,
        },
      });

      // Deactivate the sibling: keep the row for audit, drop its
      // booking footprint so every reader treats it as gone.
      await tx.projectLineItem.update({
        where: { id: move.siblingId },
        data: {
          assetId: null,
          bulkAssetId: null,
          quantity: 0,
          status: "CANCELLED",
          notes: `[merged into ${plan.canonicalId} on ${new Date().toISOString()} (${runId})]`,
        },
      });
      stats.rowsMergedAway += 1;
      quantityAdded += move.quantity;
    }

    await tx.projectLineItem.update({
      where: { id: plan.canonicalId },
      data: { quantity: { increment: quantityAdded } },
    });
    await syncLineItemRollup(tx, plan.canonicalId);
  });
}
