import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { listProjectVersions } from "./lib/projectVersionState";
import { versionRows } from "./lib/versionScope";

/**
 * D1 (#1105) — the four "Get started" activation milestones. Every field is
 * DERIVED from live org state on every read, never stored (see FEATUREDOCS/72):
 * a user who adds five models by hand without ever opening the checklist finds
 * it already ticked, because there is nothing cached to desync from reality.
 *
 * "First" model/project is the OLDEST org row — Convex appends `_creationTime`
 * as the implicit final tiebreaker on every index, so `by_organizationId` in
 * ascending order (the default) already returns it; no new index needed.
 */

/** Defensive cap on the template-skipping scan below. This card is reactive
 *  on the dashboard's hot path, so an org that front-loads hundreds of
 *  templates before its first real project (bulk import, a heavy template
 *  library) shouldn't pay an ever-growing per-view read cost. Past the cap,
 *  the milestone reads as "not yet done" rather than erroring — the safe
 *  direction, since this card only exists for orgs still mid-activation; one
 *  that has genuinely piled up hundreds of templates has almost always
 *  already created a real project (and dismissed or completed this card)
 *  long before then. */
const MAX_TEMPLATE_SCAN = 200;

async function firstNonTemplateProject(ctx: QueryCtx, orgId: string) {
  const projects = ctx.db
    .query("projects")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .order("asc");
  let scanned = 0;
  for await (const project of projects) {
    if (project.isTemplate !== true) return project;
    if (++scanned >= MAX_TEMPLATE_SCAN) return null;
  }
  return null;
}

// VERSION-SCOPE: all-versions — a "has this org ever added equipment
// referencing a model" activation check should count a model reference in
// ANY version of the project, not just whatever is live right now (#1228
// Phase 0 spike classification, ported as-is). Org-checked via
// listProjectVersions (by_projectId_number is global).
async function hasLineItemReferencingModel(ctx: QueryCtx, orgId: string, projectId: string): Promise<boolean> {
  const versions = await listProjectVersions(ctx, orgId, projectId);
  for (const version of versions) {
    const lineItems = await versionRows(ctx, "projectLineItems", version.id);
    if (lineItems.some((li) => li.modelId != null)) return true;
  }
  return false;
}

/** A model's first milestone-2 unit can be either a serialized asset or a
 *  bulk row — checked separately since they're different tables, but the
 *  caller only needs "does at least one exist". */
async function hasAssetForModel(ctx: QueryCtx, modelId: string): Promise<boolean> {
  const [asset, bulk] = await Promise.all([
    ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).first(),
    ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).first(),
  ]);
  return asset != null || bulk != null;
}

export const state = query({
  args: { orgId: v.string() },
  returns: v.object({
    firstModelId: v.union(v.string(), v.null()),
    firstModelName: v.union(v.string(), v.null()),
    hasModel: v.boolean(),
    hasAssetOnFirstModel: v.boolean(),
    firstProjectId: v.union(v.string(), v.null()),
    firstProjectName: v.union(v.string(), v.null()),
    hasProject: v.boolean(),
    hasModelLineItemOnFirstProject: v.boolean(),
  }),
  handler: async (ctx, { orgId }) => {
    await requireOrgReadFor(ctx, orgId, "project"); // matches dashboardCounters' domain slice (#1001)

    const [firstModel, firstProject] = await Promise.all([
      ctx.db
        .query("models")
        .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
        .order("asc")
        .first(),
      firstNonTemplateProject(ctx, orgId),
    ]);

    const [hasAssetOnFirstModel, hasModelLineItemOnFirstProject] = await Promise.all([
      hasAssetForModel(ctx, firstModel?.id ?? MISSING_ID),
      hasLineItemReferencingModel(ctx, orgId, firstProject?.id ?? MISSING_ID),
    ]);

    return buildMilestoneState(firstModel, hasAssetOnFirstModel, firstProject, hasModelLineItemOnFirstProject);
  },
});

/** Never a real cuid — `hasAssetForModel`/`hasLineItemReferencingModel` take
 *  it as a harmless "match nothing" sentinel when there's no first
 *  model/project yet, so the two lookups can unconditionally run inside the
 *  same `Promise.all` as everything else instead of branching per-call
 *  (keeps `state`'s handler under the complexity ceiling). */
const MISSING_ID = "";

function buildMilestoneState(
  firstModel: { id: string; name: string } | null,
  hasAssetOnFirstModel: boolean,
  firstProject: { id: string; name: string } | null,
  hasModelLineItemOnFirstProject: boolean,
) {
  return {
    firstModelId: firstModel?.id ?? null,
    firstModelName: firstModel?.name ?? null,
    hasModel: firstModel != null,
    hasAssetOnFirstModel,
    firstProjectId: firstProject?.id ?? null,
    firstProjectName: firstProject?.name ?? null,
    hasProject: firstProject != null,
    hasModelLineItemOnFirstProject,
  };
}

export const agentOps: AgentOpsAnnotations = {
  state: { summary: "Read the caller's org progress through the four activation milestones (model, asset, project, line item).", danger: "low", mcpTier: 3 },
};
