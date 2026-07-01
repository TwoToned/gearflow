import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";

/**
 * BROWSER-facing composite for the ASSET detail page (Phase 2 native reads).
 * Returns everything getAsset needs as RAW docs (asset + model/category/supplier/
 * parent/location, asset & model media + files, child assets + their models, child
 * bulk children + their bulk assets/models, ≤20 usage line items + projects, test-
 * tag, maintenance links + records, model bulk accessories + their bulk
 * assets/models) so the client reconstructs the getAsset shape from ONE live
 * subscription. Gated on requireOrgPermission(asset, read). scanLogs omitted (no
 * page consumer). Returns null when the asset is missing / cross-org.
 */
async function readAssetDetail(ctx: QueryCtx, assetId: string, orgId: string) {
  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).unique();
  if (!asset || asset.organizationId !== orgId) return null;

  const uniq = (arr: Array<string | undefined | null>): string[] => [
    ...new Set(arr.filter((x): x is string => !!x)),
  ];
  const pr = <T>(rows: Promise<T | null>[]) => Promise.all(rows);
  const inOrg = <T extends { organizationId?: string | null }>(arr: (T | null)[]) =>
    arr.filter((d): d is T => d !== null && d.organizationId === orgId);

  const [assetMedia, modelMedia, childAssetDocs, childBulkDocs, lineItemsAll, testTags, maintLinks, modelAccessories] =
    await Promise.all([
      ctx.db.query("assetMedia").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect(),
      asset.modelId
        ? ctx.db.query("modelMedia").withIndex("by_modelId", (q) => q.eq("modelId", asset.modelId!)).collect()
        : Promise.resolve([]),
      ctx.db.query("assets").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", assetId)).collect(),
      ctx.db.query("assetBulkChildren").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", assetId)).collect(),
      ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect(),
      ctx.db.query("testTagAssets").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect(),
      ctx.db.query("maintenanceRecordAssets").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect(),
      asset.modelId
        ? ctx.db.query("modelBulkAccessories").withIndex("by_modelId", (q) => q.eq("modelId", asset.modelId!)).collect()
        : Promise.resolve([]),
    ]);

  const [model, supplier, parentAsset, location] = await Promise.all([
    asset.modelId ? ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", asset.modelId!)).unique() : Promise.resolve(null),
    asset.supplierId ? ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", asset.supplierId!)).unique() : Promise.resolve(null),
    asset.parentAssetId ? ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", asset.parentAssetId!)).unique() : Promise.resolve(null),
    asset.locationId ? ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", asset.locationId!)).unique() : Promise.resolve(null),
  ]);
  const category = model?.categoryId
    ? await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", model.categoryId!)).unique()
    : null;

  // ≤20 most-recent usage line items (mirror getAsset's sort + slice).
  const lineItems = [...lineItemsAll]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 20)
    .filter((r) => r.organizationId === orgId);

  // Bulk assets referenced by child bulk children + model accessories.
  const refBulkIds = uniq([...childBulkDocs.map((c) => c.bulkAssetId), ...modelAccessories.map((a) => a.bulkAssetId)]);
  const bulkAssets = inOrg(await pr(refBulkIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())));

  // Models referenced by child assets + child-bulk/model-accessory bulk assets.
  const refModelIds = uniq([
    ...childAssetDocs.map((a) => a.modelId),
    ...bulkAssets.map((b) => b.modelId),
  ]);
  const models = inOrg(await pr(refModelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique())));

  const refProjectIds = uniq(lineItems.map((r) => r.projectId));
  const projects = inOrg(await pr(refProjectIds.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique())));

  const refMaintIds = uniq(maintLinks.map((l) => l.maintenanceRecordId));
  const maintenanceRecords = inOrg(await pr(refMaintIds.map((id) => ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", id)).unique())));

  const refFileIds = uniq([...assetMedia.map((m) => m.fileId), ...modelMedia.map((m) => m.fileId)]);
  const files = inOrg(await pr(refFileIds.map((id) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique())));

  return {
    asset,
    model: model && model.organizationId === orgId ? model : null,
    category: category && category.organizationId === orgId ? category : null,
    supplier: supplier && supplier.organizationId === orgId ? supplier : null,
    parentAsset: parentAsset && parentAsset.organizationId === orgId ? parentAsset : null,
    location: location && location.organizationId === orgId ? location : null,
    assetMedia,
    modelMedia,
    childAssets: childAssetDocs.filter((c) => c.organizationId === orgId),
    childBulkChildren: childBulkDocs.filter((c) => c.organizationId === orgId),
    lineItems,
    testTags,
    maintenanceLinks: maintLinks,
    modelAccessories,
    bulkAssets,
    models,
    projects,
    maintenanceRecords,
    files,
  };
}

export const bundle = query({
  args: { assetId: v.string(), orgId: v.string() },
  handler: async (ctx, { assetId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "asset", "read");
    return readAssetDetail(ctx, assetId, orgId);
  },
});
