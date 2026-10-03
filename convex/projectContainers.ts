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

    // The container's own asset/bulk-asset tag (batched — same shape as
    // `assets.listByIds`/`bulkAssets.listByIds`, bounded by container count),
    // so a scan-to-activate flow (#1296 phase 2) can match a scanned tag to
    // a container without a second round trip. `null` for CUSTOM containers
    // (no asset backing them) or a stale/deleted asset reference.
    const assetIds = [...new Set(withCounts.filter((c) => c.kind === "ASSET" && c.assetId).map((c) => c.assetId as string))];
    const bulkAssetIds = [...new Set(withCounts.filter((c) => c.kind === "BULK_ASSET" && c.bulkAssetId).map((c) => c.bulkAssetId as string))];
    const [assetDocs, bulkAssetDocs] = await Promise.all([
      Promise.all(assetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      Promise.all(bulkAssetIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    ]);
    const assetTagById = new Map(assetDocs.filter((a): a is NonNullable<typeof a> => !!a).map((a) => [a.id, a.assetTag]));
    const bulkAssetTagById = new Map(bulkAssetDocs.filter((b): b is NonNullable<typeof b> => !!b).map((b) => [b.id, b.assetTag]));
    const withTags = withCounts.map((c) => ({
      ...c,
      tag:
        c.kind === "ASSET"
          ? (c.assetId ? assetTagById.get(c.assetId) ?? null : null)
          : c.kind === "BULK_ASSET"
            ? (c.bulkAssetId ? bulkAssetTagById.get(c.bulkAssetId) ?? null : null)
            : null,
    }));

    return withTags.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  },
});

export const agentOps: AgentOpsAnnotations = {
  listForProject: { summary: "List a project's packing containers, each with its current unit count and resolved asset tag.", danger: "low", mcpTier: 2 },
};
