/**
 * Bounded ctx.db reads shared by the overbooking board query layer
 * (`convex/overbookingBoard.ts`), `convex/projectReadiness.ts`, and the
 * confirm/date-move impact previews (`convex/lib/overbookingConfirmImpact.ts`).
 * Extracted to its own module (not `convex/lib/overbookingBoard.ts`, which is
 * pure/no-ctx.db by design) so that lib file and `convex/overbookingBoard.ts`
 * can each depend on this without a circular import between them.
 */
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { liveRows } from "./versionScope";

/** Mirrors convex/overbooking.ts's own MIN_TS — see that file's comment for why
 *  an unbounded-below range scan needs this floor (undefined sorts before all
 *  numbers in a Convex index). */
const MIN_TS = -8_640_000_000_000_000;

/**
 * Candidate projects — TWO range-scans unioned, same shape as overbooking.ts's
 * `bundle` (WS2 #941): rental-index scan (unbounded below — also sweeps in
 * every projectStartDate-unset row, since undefined sorts first) UNION
 * projectStartDate-index scan (MIN_TS-bounded, backfilled rows only). Both
 * candidate sets are then refined by the PURE getProjectWindow overlap check
 * in `candidateBoardProjects`.
 */
export async function fetchCandidateProjects(ctx: QueryCtx, orgId: string, rangeEnd: number) {
  const projectDocsById = new Map<string, Doc<"projects">>();
  for await (const p of ctx.db
    .query("projects")
    .withIndex("by_organizationId_rentalStartDate", (q) => q.eq("organizationId", orgId).lte("rentalStartDate", rangeEnd))) {
    projectDocsById.set(p.id, p);
  }
  for await (const p of ctx.db
    .query("projects")
    .withIndex("by_organizationId_projectStartDate", (q) => q.eq("organizationId", orgId).gt("projectStartDate", MIN_TS).lte("projectStartDate", rangeEnd))) {
    projectDocsById.set(p.id, p);
  }
  return projectDocsById;
}

/** Line items for candidate projects only (referenced-only) + the models/assets/
 *  bulkAssets those line items reference (also referenced-only). LIVE-ONLY
 *  (#1228) — the overbooking board reads the live plan. */
export async function fetchGearData(
  ctx: QueryCtx,
  orgId: string,
  candidateProjectIds: string[],
  projectDocsById: Map<string, Doc<"projects">>,
) {
  const lineItemGroups = await Promise.all(
    candidateProjectIds.map(async (pid) => {
      const p = projectDocsById.get(pid);
      return p ? liveRows(ctx, p, "projectLineItems") : [];
    }),
  );
  const lineItems = lineItemGroups.flat().filter((li) => li.organizationId === orgId);

  const referencedModelIds = [...new Set(lineItems.map((li) => li.modelId).filter((id): id is string => !!id))];
  const [modelDocs, assetGroups, bulkGroups] = await Promise.all([
    Promise.all(referencedModelIds.map((mid) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).unique())),
    Promise.all(referencedModelIds.map((mid) => ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
    Promise.all(referencedModelIds.map((mid) => ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect())),
  ]);
  return {
    lineItems,
    referencedModelIds,
    models: modelDocs.filter((m): m is NonNullable<typeof m> => !!m && m.organizationId === orgId),
    assets: assetGroups.flat().filter((a) => a.organizationId === orgId),
    bulkAssetsForModels: bulkGroups.flat().filter((b) => b.organizationId === orgId),
  };
}
