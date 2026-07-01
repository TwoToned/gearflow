import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";


/**
 * BROWSER-facing composite for the WAREHOUSE detail page (Phase 2 native reads).
 * Returns everything getProjectForWarehouse needs as RAW docs so the client
 * reconstructs `{ ...project, lineItems, client, location }` from ONE live
 * subscription (replacing the version-vector doorbell → getProjectForWarehouse
 * refetch). Gated on requireOrgPermission(project, read).
 *
 * Referenced-only: assets/bulks point-read by the ids the lines AND units
 * reference; kits/models/suppliers by line refs; categories by referenced models;
 * model/kit check-item counts computed for referenced models/kits only. Returns
 * `null` when the project is missing / not in the org / a template (the page shows
 * its not-found state — getProjectForWarehouse throws on those).
 */
async function readWarehouseDetail(ctx: QueryCtx, projectId: string, orgId: string) {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).unique();
  if (!project || project.organizationId !== orgId || project.isTemplate === true) return null;

  const lineItems = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();
  const lineItemIds = lineItems.map((li) => li.id);

  const unitArrays = await Promise.all(
    lineItemIds.map((id) =>
      ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", id)).collect(),
    ),
  );
  const units = unitArrays.flat().filter((u) => u.organizationId === orgId);

  const uniq = (arr: Array<string | undefined | null>): string[] => [
    ...new Set(arr.filter((x): x is string => !!x)),
  ];
  // assets/bulks referenced on BOTH lines and units (the warehouse attach pipeline).
  const refAssetIds = uniq([...lineItems.map((li) => li.assetId), ...units.map((u) => u.assetId)]);
  const refBulkIds = uniq([...lineItems.map((li) => li.bulkAssetId), ...units.map((u) => u.bulkAssetId)]);
  const refKitIds = uniq(lineItems.map((li) => li.kitId));
  const refModelIds = uniq(lineItems.map((li) => li.modelId));
  const refSupplierIds = uniq(lineItems.map((li) => li.supplierId));

  const pr = <T>(rows: Promise<T | null>[]) => Promise.all(rows);
  const [assetDocs, bulkDocs, kitDocs, modelDocs, supplierDocs] = await Promise.all([
    pr(refAssetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(refBulkIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(refKitIds.map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(refModelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(refSupplierIds.map((id) => ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
  ]);

  const inOrg = <T extends { organizationId?: string | null }>(arr: (T | null)[]) =>
    arr.filter((d): d is T => d !== null && d.organizationId === orgId);

  const models = inOrg(modelDocs);
  const refCategoryIds = uniq(models.map((m) => m.categoryId));
  const categoryDocs = await pr(
    refCategoryIds.map((id) => ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
  );

  // Referenced-only check-item counts (model + kit).
  const kits = inOrg(kitDocs);
  const [modelCountEntries, kitCountEntries] = await Promise.all([
    Promise.all(
      models.map(async (m) => {
        const rows = await ctx.db.query("modelCheckItems").withIndex("by_modelId", (q) => q.eq("modelId", m.id)).collect();
        return [m.id, rows.filter((r) => r.organizationId === orgId).length] as const;
      }),
    ),
    Promise.all(
      kits.map(async (k) => {
        const rows = await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", k.id)).collect();
        return [k.id, rows.filter((r) => r.organizationId === orgId).length] as const;
      }),
    ),
  ]);

  const client = project.clientId
    ? await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", project.clientId!)).unique()
    : null;
  const location = project.locationId
    ? await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", project.locationId!)).unique()
    : null;

  return {
    project,
    lineItems,
    units,
    assets: inOrg(assetDocs),
    bulkAssets: inOrg(bulkDocs),
    kits,
    models,
    suppliers: inOrg(supplierDocs),
    orgCategories: inOrg(categoryDocs),
    modelCheckCounts: Object.fromEntries(modelCountEntries) as Record<string, number>,
    kitCheckCounts: Object.fromEntries(kitCountEntries) as Record<string, number>,
    client: client && client.organizationId === orgId ? client : null,
    location: location && location.organizationId === orgId ? location : null,
  };
}

export const bundle = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    return readWarehouseDetail(ctx, projectId, orgId);
  },
});
