import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadDocFor } from "./lib/auth";
import {
  overlappingProjectIds,
  collectHereAssetRefs,
  buildOverlapByAsset,
  toConflictProject,
  filterSwapCandidateAssets,
  collectBookedAssetIds,
  type CLine,
  type CUnit,
  type CProject,
  type CAsset,
} from "./lib/reservationConflicts";

/**
 * Reservation-conflict DETECTION reads (Phase 3 browser-direct — replaces the
 * getProjectConflicts/getSwapCandidates server actions in
 * src/server/reservation-conflicts.ts). Both derive + authorize the org from the fetched
 * anchor row (project / line item) via `requireOrgReadDoc` — so the browser passes only
 * the entity id, never a client-supplied orgId. Conflict detection is inherently
 * org-wide (it must see every booking), so these collect the org's line items / units /
 * assets / projects / models by `by_organizationId`; they're ONE-SHOT reads (the
 * conflicts banner has no liveness need — Appendix B), never a reactive subscription.
 * A bounded/paginated read here would silently miss conflicts outside the fetched
 * page, which is worse than a slow query for a safety-critical double-booking check —
 * so this is a real, dated §15 exception rather than pagination: see
 * docs/exceptions.md R-8.3.3 reservationConflicts-orgGraph.
 */

/** Collect the org-wide inputs both queries need, keyed for O(1) lookup. */
async function loadOrgGraph(ctx: QueryCtx, orgId: string) {
  const [lineItems, units, assets, projects, models] = await Promise.all([
    ctx.db.query("projectLineItems").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 reservationConflicts-orgGraph
    ctx.db.query("projectLineItemUnits").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 reservationConflicts-orgGraph
    ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 reservationConflicts-orgGraph
    ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 reservationConflicts-orgGraph
    ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: see docs/exceptions.md R-8.3.3 reservationConflicts-orgGraph
  ]);
  return {
    lineItems: lineItems as CLine[],
    units: units as CUnit[],
    assets: assets as CAsset[],
    projects: projects as CProject[],
    assetMap: new Map(assets.map((a) => [a.id, a as CAsset])),
    projectMap: new Map(projects.map((p) => [p.id, p as CProject])),
    modelMap: new Map(models.map((m) => [m.id, { name: m.name }])),
  };
}

/** Every double-booked asset on the project. Empty when it has no window or no conflicts. */
export const projectConflicts = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    await requireOrgReadDocFor(ctx, project, "project"); // authorizes + confirms the project is in the caller's org — Phase 2 read bootstrap (#998)
    if (!project) return [];
    const startMs = project.rentalStartDate ?? null;
    const endMs = project.rentalEndDate ?? null;
    if (startMs == null || endMs == null) return [];

    const orgId = project.organizationId;
    const g = await loadOrgGraph(ctx, orgId);

    const here = collectHereAssetRefs(projectId, g.lineItems, g.units, g.assetMap, g.modelMap);
    if (here.length === 0) return [];

    const assetIds = new Set(here.map((r) => r.assetId));
    const conflictProjectIds = overlappingProjectIds(g.projects, startMs, endMs, projectId);
    if (conflictProjectIds.size === 0) return [];

    const overlapByAsset = buildOverlapByAsset(assetIds, conflictProjectIds, g.lineItems, g.units);

    const conflicts = [];
    const seen = new Set<string>();
    for (const r of here) {
      const overlap = overlapByAsset.get(r.assetId);
      if (!overlap) continue;
      const conflictProject = g.projectMap.get(overlap.projectId);
      if (!conflictProject) continue;
      const key = `${r.lineItemId}:${r.assetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({
        lineItemId: r.lineItemId,
        assetId: r.assetId,
        assetTag: r.assetTag,
        modelId: r.modelId ?? "",
        modelName: r.modelName,
        conflictingProject: toConflictProject(conflictProject),
        conflictingLineItemId: overlap.id,
      });
    }
    return conflicts;
  },
});

/** Free same-model assets the conflicting line item could swap to. */
export const swapCandidates = query({
  args: { lineItemId: v.string() },
  handler: async (ctx, { lineItemId }) => {
    const lineItem = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
    await requireOrgReadDocFor(ctx, lineItem, "project"); // authorizes + confirms the line item is in the caller's org — Phase 2 read bootstrap (#998)
    if (!lineItem || !lineItem.modelId) return [];

    const orgId = lineItem.organizationId;
    const g = await loadOrgGraph(ctx, orgId);

    const lineItemProject = g.projectMap.get(lineItem.projectId) ?? null;
    if (!lineItemProject?.rentalStartDate || !lineItemProject.rentalEndDate) return [];
    const startMs = lineItemProject.rentalStartDate;
    const endMs = lineItemProject.rentalEndDate;

    const assets = filterSwapCandidateAssets(g.assets, lineItem.modelId);
    if (assets.length === 0) return [];

    const candidateAssetIds = new Set(assets.map((a) => a.id));
    const conflictProjectIds = overlappingProjectIds(g.projects, startMs, endMs, "");
    const bookedIds = conflictProjectIds.size
      ? collectBookedAssetIds(candidateAssetIds, conflictProjectIds, lineItemId, g.lineItems, g.units)
      : new Set<string>();

    return assets
      .filter((a) => a.id !== lineItem.assetId && !bookedIds.has(a.id))
      .map((a) => ({
        assetId: a.id,
        assetTag: a.assetTag,
        serialNumber: a.serialNumber ?? null,
        customName: a.customName ?? null,
        status: a.status ?? "",
      }));
  },
});
