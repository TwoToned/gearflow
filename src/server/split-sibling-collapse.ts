/**
 * Apply-side of the Phase 3.8 split-sibling collapse migration.
 *
 * The pure plan / equivalence-key logic lives in
 * `src/lib/split-sibling-collapse.ts`. This module owns the
 * transactional writes: moving units, repointing CheckRecord /
 * ProjectService FKs, deactivating the sibling row, and
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
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

export interface CollapseRunStats {
  groupsTotal: number;
  groupsMergeable: number;
  groupsFlagged: number;
  rowsMergedAway: number;
  unitsMoved: number;
  checkRecordsRepointed: number;
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
  // projectLineItem is Convex-only (Phase C). Read candidates from Convex and
  // replicate the Prisma `where` filters + ordering in JS.
  const convex = await getConvexClient();
  let rawCandidates;
  if (opts.projectId) {
    if (!opts.organizationId) {
      throw new Error("runCollapse requires organizationId when scoping by projectId (Convex listByProject is org-scoped)");
    }
    rawCandidates = await convex.query(api.projectLineItems.listByProject, {
      projectId: opts.projectId,
      orgId: opts.organizationId,
    });
  } else if (opts.organizationId) {
    rawCandidates = await convex.query(api.projectLineItems.list, { orgId: opts.organizationId });
  } else {
    throw new Error("runCollapse requires organizationId or projectId (no cross-org Convex line-item query exists post-flip)");
  }

  const candidates = rawCandidates
    .filter(
      (r) =>
        (!opts.organizationId || r.organizationId === opts.organizationId) &&
        (!opts.projectId || r.projectId === opts.projectId) &&
        r.type === "EQUIPMENT" &&
        (r.assetId != null || r.bulkAssetId != null) &&
        !r.isKitChild &&
        // Skip already-merged-away rows.
        !(r.status === "CANCELLED" && (r.quantity ?? 0) === 0),
    )
    .sort(
      (a, b) =>
        (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0) ||
        (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
        (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );

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
    servicesRepointed: 0,
    runId: opts.runId,
  };

  if (!opts.apply) {
    // Dry-run still reports what WOULD merge.
    for (const p of mergeable) stats.rowsMergedAway += p.moves.length;
    return { stats, plans, mergeable, flagged };
  }

  // Resolve canonical orgs from the already-fetched candidate set (Convex
  // read above) rather than a fresh per-iteration Prisma lookup.
  const orgByLineId = new Map(candidates.map((c) => [c.id, c.organizationId]));
  for (const plan of mergeable) {
    const canonicalOrg = orgByLineId.get(plan.canonicalId);
    if (!canonicalOrg) continue;
    await mergeGroup(plan, canonicalOrg, opts.runId, stats);
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
  const now = Date.now();
  const convex = await getConvexClient();

  // 1. Move units + repoint checkRecords + write lineItemMergeMap + deactivate
  //    siblings + bump canonical quantity, all atomically in-mutation.
  await convex.mutation(api.projectLineItems.mergeGroup, {
    organizationId,
    canonicalId: plan.canonicalId,
    key: plan.key,
    runId,
    moves: plan.moves.map((m) => ({
      siblingId: m.siblingId,
      ...(m.assetId ? { assetId: m.assetId } : {}),
      ...(m.bulkAssetId ? { bulkAssetId: m.bulkAssetId } : {}),
      quantity: m.quantity,
    })),
    now,
  });

  // 2. Repoint ProjectService FKs — projectService is NOT flipped (stays Prisma).
  //    Done in the action since the Convex mergeGroup mutation doesn't touch it.
  let servicesRepointed = 0;
  for (const move of plan.moves) {
    const serviceMove = await prisma.projectService.updateMany({
      where: { lineItemId: move.siblingId },
      data: { lineItemId: plan.canonicalId },
    });
    servicesRepointed += serviceMove.count;
  }

  // 3. Stats. The Convex mutation doesn't return per-row counts, so the
  //    unit-moved / check-records-repointed counters can't be tracked exactly
  //    here — approximate from the plan (one unit moved per move at most) and
  //    use the actual projectService count. rowsMergedAway is exact.
  stats.unitsMoved += plan.moves.filter((m) => m.assetId || m.bulkAssetId).length;
  stats.servicesRepointed += servicesRepointed;
  stats.rowsMergedAway += plan.moves.length;
}
