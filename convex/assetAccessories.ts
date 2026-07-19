import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * Serialized assets eligible to become an accessory of `parentAssetId` (Phase 3 —
 * replaces getAvailableAccessoryAssets). AVAILABLE, not in a kit, not already an
 * accessory, not the parent itself, and not itself an accessory-parent (one level deep).
 * tag-asc, with the model name attached.
 */
export const availableSerialized = query({
  args: { orgId: v.string(), parentAssetId: v.string() },
  handler: async (ctx, { orgId, parentAssetId }) => {
    await requireOrgRead(ctx, orgId);
    const [assets, bulkChildren, models] = await Promise.all([
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: picker: scans the org set for candidates — accepted, revisit with a narrower index if large
      ctx.db.query("assetBulkChildren").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: picker: scans the org set for candidates — accepted, revisit with a narrower index if large
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: picker: scans the org set for candidates — accepted, revisit with a narrower index if large
    ]);
    const modelName = new Map(models.map((m) => [m.id, m.name]));

    // Every asset id that some asset / bulk-child points at as its parent.
    const parentIds = new Set<string>();
    for (const a of assets) if (a.parentAssetId) parentIds.add(a.parentAssetId);
    for (const c of bulkChildren) if (c.parentAssetId) parentIds.add(c.parentAssetId);

    return assets
      .filter((a) =>
        a.isActive !== false &&
        a.status === "AVAILABLE" &&
        !a.kitId &&
        !a.parentAssetId &&
        a.id !== parentAssetId &&
        !parentIds.has(a.id),
      )
      .sort((x, y) => x.assetTag.localeCompare(y.assetTag))
      .map((a) => ({ ...a, model: a.modelId ? { name: modelName.get(a.modelId) ?? "" } : null }));
  },
});
