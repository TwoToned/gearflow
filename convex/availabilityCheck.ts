import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * ONE-round-trip read for `checkAvailability` (the "after choosing a model"
 * availability check). Reads model + active assets + active bulk assets + this
 * model's line items + all org projects + the model's bulk-accessory COUNT, all
 * backend-local. Replaces ~6 server→Convex queries in 3 sequential waves (incl. a
 * fully-sequential trailing accessories read). Raw docs; the JS stock/conflict math
 * in checkAvailability is unchanged (parity-by-construction).
 *
 * requireService: it aggregates `modelBulkAccessories` (a service-only read) and is
 * only ever called by the checkAvailability server action (service token).
 */
export const checkBundle = query({
  args: { modelId: v.string(), orgId: v.string() },
  handler: async (ctx, { modelId, orgId }) => {
    await requireService(ctx);

    const [modelDoc, assetsRaw, bulksRaw, lineRaw, accessories] = await Promise.all([
      ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).unique(),
      ctx.db.query("assets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
      ctx.db.query("bulkAssets").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
      ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect(),
      ctx.db
        .query("modelBulkAccessories")
        .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
        .filter((q) => q.eq(q.field("organizationId"), orgId))
        .collect(),
    ]);

    // Resolve each model accessory's bulk-asset tag + model name for the add-form
    // picker (issue #794) — the same detail level models.ts's bulkAccessories shape
    // returns, so the picker can show "4x PowerCON cable" not a bare bulkAssetId.
    const accessoryDetails = await Promise.all(
      accessories.map(async (a) => {
        const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", a.bulkAssetId)).unique();
        const baModel = ba?.modelId
          ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", ba.modelId!)).unique()
          : null;
        return {
          id: a.id,
          bulkAssetId: a.bulkAssetId,
          quantity: a.quantity,
          inclusion: (a.inclusion ?? "DEFAULT") as "DEFAULT" | "OPTIONAL",
          assetTag: ba?.assetTag ?? a.bulkAssetId,
          modelName: baModel?.name ?? null,
        };
      }),
    );

    // projectLineItems.listByModelId org-filters; match it.
    const lines = lineRaw.filter((r) => r.organizationId === orgId);
    // REFERENCED-ONLY projects: the consumer (line-items.ts) builds a projectById
    // map and looks each line's project up by id, so it only needs the projects
    // these line items reference — not the whole org projects table this previously
    // .collect()'d on every availability check. by_cuid is global → org-recheck.
    const projectIds = [...new Set(lines.map((li) => li.projectId))];
    const projectDocs = await Promise.all(
      projectIds.map((pid) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", pid)).unique()),
    );

    return {
      // getModelById did not org-filter; we do (org-correct + closes a cross-org
      // model read — modelId is always same-org in practice).
      model: modelDoc && modelDoc.organizationId === orgId ? modelDoc : null,
      // getActiveAssetsByModel / getActiveBulkAssetsByModel: isActive !== false.
      activeAssets: assetsRaw.filter((a) => a.isActive !== false),
      activeBulkAssets: bulksRaw.filter((b) => b.isActive !== false),
      lines,
      projects: projectDocs.filter((p): p is NonNullable<typeof p> => !!p && p.organizationId === orgId),
      bulkAccessoryCount: accessories.length,
      accessories: accessoryDetails,
    };
  },
});
