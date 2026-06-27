import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * ONE-round-trip read of everything `buildProjectEquipmentTree` needs to rebuild a
 * project's equipment tree. Replaces ~10 separate server→Convex queries (3
 * sequential waves: line items/categories/groups → units/models/suppliers/orgCats →
 * assets/bulks/kits) with a SINGLE query whose reads are all backend-local
 * (microseconds, no network between them). This is the round-trip-count fix for the
 * project + warehouse detail composites — the actual driver of "clicking a project
 * takes forever" at this app's small data scale.
 *
 * Returns RAW docs; the JS reconstruction (mappers + reconstructScope + attach)
 * stays in src/lib unchanged, so this is parity-by-construction with the old
 * per-table reads (same index reads, same org filter).
 */
export const bundle = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    // Service-only: this bundle returns `units` (projectLineItemUnits), which are
    // service-only — the only caller is the getProject server action (service
    // token). Do NOT relax to requireOrgRead (would expose units to user tokens).
    await requireService(ctx);

    const [lineItems, projectCategories, groups] = await Promise.all([
      ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
      ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ]);

    const lineItemIds = lineItems.map((li) => li.id);
    const units = (
      await Promise.all(
        lineItemIds.map((id) =>
          ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", id)).collect(),
        ),
      )
    ).flat();

    const uniq = (arr: Array<string | undefined | null>): string[] => [
      ...new Set(arr.filter((x): x is string => !!x)),
    ];
    const refAssetIds = uniq([...lineItems.map((li) => li.assetId), ...units.map((u) => u.assetId)]);
    const refBulkIds = uniq([...lineItems.map((li) => li.bulkAssetId), ...units.map((u) => u.bulkAssetId)]);
    const refKitIds = uniq(lineItems.map((li) => li.kitId));

    const [assetDocs, bulkDocs, kitDocs, models, suppliers, categories] = await Promise.all([
      Promise.all(refAssetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      Promise.all(refBulkIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      Promise.all(refKitIds.map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("suppliers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ]);

    return {
      lineItems,
      projectCategories,
      groups,
      units,
      // Org-filter the by-id reads to match the old getAssetsByIds/etc. helpers.
      assets: assetDocs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId),
      bulkAssets: bulkDocs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId),
      kits: kitDocs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId),
      models,
      suppliers,
      categories,
    };
  },
});
