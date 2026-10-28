import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Read for ModelCustomAccessory (Convex table "modelCustomAccessories") — the
 * free-text twin of `modelBulkAccessories.listByModelId`. Writes live in
 * `modelCustomAccessoriesWrites.ts`. Rows come back in the picker's
 * `ModelAccessoryDetail` shape: `bulkAssetId` carries the line-plan key
 * ("m:<id>") and `assetTag` the typed name, so the add-form / Edit Item pickers
 * render them with no special case.
 */
export const listByModelId = query({
  args: { modelId: v.string(), organizationId: v.string() },
  handler: async (ctx, { modelId, organizationId }) => {
    await requireOrgPermission(ctx, organizationId, "model", "read");
    const rows = await ctx.db
      .query("modelCustomAccessories")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .filter((q) => q.eq(q.field("organizationId"), organizationId))
      .collect();
    rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return rows;
  },
});

export const agentOps: AgentOpsAnnotations = {
  listByModelId: { summary: "List a model's free-text (not-in-inventory) accessories, sorted by sortOrder.", danger: "low", mcpTier: 3 },
};
