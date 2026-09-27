import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { resolveVersionId, versionRows } from "./lib/versionScope";

/**
 * Reads for ProjectContainer (#1296 packing containers — build plan phase
 * 1a). Writes live in `projectContainersWrites.ts` (phase 1b).
 */

export const listForProject = query({
  // Optional versionId, defaulting to the project's live version — same
  // shape every versioned-table read takes (#1228).
  args: { orgId: v.string(), projectId: v.string(), versionId: v.optional(v.string()) },
  handler: async (ctx, { orgId, projectId, versionId }) => {
    await requireOrgReadFor(ctx, orgId, "warehouse");
    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
    if (!project || project.organizationId !== orgId) return [];

    const resolvedVersionId = resolveVersionId(project, versionId);
    const containers = (await versionRows(ctx, "projectContainers", resolvedVersionId)).filter(
      (c) => c.organizationId === orgId,
    );

    // One `by_containerId` range per container — bounded by the version's
    // container count, not the project's line-item count.
    const withCounts = await Promise.all(
      containers.map(async (c) => {
        const units = (
          await ctx.db
            .query("projectLineItemUnits")
            .withIndex("by_containerId", (q) => q.eq("containerId", c.id))
            .collect()
        ).filter((u) => u.organizationId === orgId && u.status !== "CANCELLED");
        return { ...c, unitCount: units.length };
      }),
    );

    return withCounts.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForProject: { summary: "List a project's packing containers, each with its current unit count.", danger: "low", mcpTier: 2 },
};
