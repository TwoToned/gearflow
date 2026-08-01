import { v, ConvexError } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import { getProjectWindow } from "./lib/projectWindow";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { candidateBoardProjects } from "./lib/overbookingBoard";
import { fetchCandidateProjects, fetchGearData } from "./overbookingBoard";
import {
  computeProjectGearReadiness,
  computeProjectCrewReadiness,
  computeProjectPricingReadiness,
  type ReadinessGearSection,
} from "./lib/projectReadiness";

/**
 * Lines and groups a lifecycle lock forced to $0, with a usable label on each.
 *
 * Model names are resolved only for the rows that will actually be listed: an
 * unpriced line usually has no hand-typed description (it was added by picking
 * a model), and a checklist row reading "Line item" tells nobody anything —
 * the same fallback chain `buildFinanceLines` resolves for finance documents,
 * for the same reason. `by_cuid` is GLOBAL, so each resolved model is
 * org-checked before its name is trusted (R-8.4.3); a foreign-org id falls
 * through to the generic label rather than leaking that org's model name.
 */
async function readPricingReadiness(ctx: QueryCtx, orgId: string, projectId: string) {
  const [ownLines, ownGroups] = await Promise.all([
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);
  const scopedLines = ownLines.filter((li) => li.organizationId === orgId);

  const namedModelIds = [
    ...new Set(
      scopedLines
        .filter((li) => li.pricedUnderLock && !li.isKitChild && !li.description && li.modelId)
        .map((li) => li.modelId!),
    ),
  ];
  const modelDocs = await Promise.all(
    namedModelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
  );
  const modelNameById = new Map(
    modelDocs.filter((m) => m && m.organizationId === orgId).map((m) => [m!.id, m!.name]),
  );

  return computeProjectPricingReadiness(
    projectId,
    scopedLines.map((li) => ({
      id: li.id,
      projectId: li.projectId,
      description: li.description ?? null,
      modelName: li.modelId ? modelNameById.get(li.modelId) ?? null : null,
      pricedUnderLock: li.pricedUnderLock ?? false,
      isKitChild: li.isKitChild ?? false,
      status: li.status ?? null,
    })),
    ownGroups
      .filter((g) => g.organizationId === orgId)
      .map((g) => ({ id: g.id, projectId: g.projectId, title: g.title, pricedUnderLock: g.pricedUnderLock ?? false })),
  );
}

/**
 * "Is this project ready to go out the door?" — the read behind the project
 * Overview tab's Readiness checklist (#1061).
 *
 * Three sections in one round trip, so the checklist is one subscription
 * rather than four: gear shortage on the models THIS project books, crew that
 * hasn't confirmed plus services still under-staffed, and lines/groups a
 * lifecycle lock forced to $0 and nobody has priced since.
 *
 * Two further checks the panel renders are deliberately NOT computed here —
 * they already have exactly one home each and duplicating either would be an
 * R-3.1 defect:
 *   - double-booked serialized assets → `reservationConflicts.projectConflicts`
 *     (which also owns the swap-to-a-free-asset action)
 *   - stale auto-pricing → `lineItemWrites.projectPricingStaleness`
 * The panel subscribes to those two alongside this query.
 *
 * Unlike `overbookingBoard.confirmImpact`, this reports the project's ACTUAL
 * status rather than simulating `CONFIRMED` — the checklist describes what is
 * true now, and the confirm-time dialog keeps owning "what would change if you
 * confirmed". Reads are the same bounded, referenced-only shape the org board
 * uses (R-9.8): candidate projects are the two range-scans bounded by this
 * project's own window end, and everything else is a `by_projectId` lookup.
 */
export const forProject = query({
  args: { orgId: v.string(), projectId: v.string() },
  handler: async (ctx, { orgId, projectId }) => {
    await requireOrgReadFor(ctx, orgId, "project");

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    // `by_cuid` is a GLOBAL index — the org check is what stops a cross-tenant
    // read here (R-8.4.3), not the guard above (which authorizes the CALLER's
    // org, not the row's).
    if (!project || project.organizationId !== orgId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Project not found." });
    }

    const { start, end } = getProjectWindow(project);

    // ── Gear ────────────────────────────────────────────────────────────────
    // A dateless project has no window to compare other bookings against, so
    // there is nothing truthful the gear section can say — it reports empty
    // rather than guessing, and the checklist renders that as "no dates set"
    // instead of a false all-clear.
    let gear: ReadinessGearSection = { hard: [], pencilled: [], hardQty: 0, pencilledQty: 0 };
    if (start != null && end != null) {
      const range = { start, end };
      const projectDocsById = await fetchCandidateProjects(ctx, orgId, end);
      projectDocsById.set(project.id, project); // present even if its window predates the scan bound
      const candidates = candidateBoardProjects([...projectDocsById.values()], range);
      const { lineItems, models, assets, bulkAssetsForModels } = await fetchGearData(
        ctx,
        orgId,
        candidates.map((p) => p.id),
      );
      gear = computeProjectGearReadiness(projectId, range, candidates, lineItems, models, assets, bulkAssetsForModels);
    }

    // ── Crew ────────────────────────────────────────────────────────────────
    const [assignments, services] = await Promise.all([
      ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ]);
    const crew = computeProjectCrewReadiness(
      projectId,
      assignments.filter((a) => a.organizationId === orgId),
      services.filter((s) => s.organizationId === orgId),
      { id: project.id, name: project.name, projectNumber: project.projectNumber },
    );

    const pricing = await readPricingReadiness(ctx, orgId, projectId);

    return {
      hasWindow: start != null && end != null,
      window: start != null && end != null ? { start, end } : null,
      gear,
      crew,
      pricing,
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  forProject: {
    summary: "Readiness checks for one project: gear shortage, unconfirmed crew, understaffed services, unpriced lines.",
    danger: "low",
    mcpTier: 1,
  },
};
