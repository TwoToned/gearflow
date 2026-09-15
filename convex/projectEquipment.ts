import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireService, requireOrgPermission } from "./lib/auth";
import { getKitByCuid } from "./lib/kits";
import { resolveVersionId, versionRows } from "./lib/versionScope";

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
const EMPTY_EQUIPMENT_BUNDLE = {
  lineItems: [], projectCategories: [], groups: [], units: [], assets: [],
  bulkAssets: [], kits: [], models: [], suppliers: [], categories: [],
};

async function readBundle(ctx: QueryCtx, projectId: string, orgId: string, versionId?: string) {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  // Missing/cross-org project: graceful empty, same as the old by_projectId
  // reads (no version id to resolve without a project row).
  if (!project || project.organizationId !== orgId) return EMPTY_EQUIPMENT_BUNDLE;
  // #1228: the VIEWED version, defaulting to live.
  const targetVersionId = resolveVersionId(project, versionId);
  const [lineItems, projectCategories, groups] = await Promise.all([
    versionRows(ctx, "projectLineItems", targetVersionId),
    versionRows(ctx, "projectCategories", targetVersionId),
    versionRows(ctx, "projectGroups", targetVersionId),
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
  const refModelIds = uniq(lineItems.map((li) => li.modelId));
  const refSupplierIds = uniq(lineItems.map((li) => li.supplierId));

  // Referenced-only point reads (by id), NEVER whole-org catalog collects — the tree
  // reconstruction keys models/suppliers/categories by id (project-equipment-reconstruct
  // builds Maps by id; a category is resolved ONLY via model.categoryId), so loading
  // exactly what the project references is parity-by-construction. This mirrors
  // equipmentTab.ts and stops browserBundle re-reading the whole org models/suppliers/
  // categories tables on ANY of those changing (it's a reactive subscription).
  const [assetDocs, bulkDocs, kitDocs, modelDocs, supplierDocs] = await Promise.all([
    Promise.all(refAssetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    Promise.all(refBulkIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    Promise.all(refKitIds.map((id) => getKitByCuid(ctx, id))),
    Promise.all(refModelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    Promise.all(refSupplierIds.map((id) => ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
  ]);

  const inOrg = <T extends { organizationId?: string | null }>(arr: (T | null)[]): T[] =>
    arr.filter((d): d is T => d !== null && d.organizationId === orgId);

  const models = inOrg(modelDocs);
  const suppliers = inOrg(supplierDocs);
  // Categories referenced by the (in-org) models' categoryId — the ONLY lookup the
  // reconstruction performs (projectCategories carry their own name; no FK to categories).
  const refCategoryIds = uniq(models.map((m) => m.categoryId));
  const categoryDocs = await Promise.all(
    refCategoryIds.map((id) => ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
  );
  const categories = inOrg(categoryDocs);

  return {
    lineItems,
    projectCategories,
    groups,
    units,
    assets: inOrg(assetDocs),
    bulkAssets: inOrg(bulkDocs),
    kits: inOrg(kitDocs),
    models,
    suppliers,
    categories,
  };
}

/**
 * SERVICE-only bundle — the existing read path (getProject server action, service
 * token). Returns `units`, which historically motivated the service-only gate.
 */
export const bundle = query({
  args: { projectId: v.string(), orgId: v.string(), versionId: v.optional(v.string()) },
  handler: async (ctx, { projectId, orgId, versionId }) => {
    await requireService(ctx);
    return readBundle(ctx, projectId, orgId, versionId);
  },
});

/**
 * BROWSER-facing bundle for the native read-layer cutover (Phase 1c). Identical
 * shape to `bundle` (so the existing src reconstruction consumes it unchanged), but
 * gated on `requireOrgPermission(orgId, "project", "read")` instead of the service
 * token — i.e. it enforces, inside Convex, the SAME permission the `getProject`
 * server action checks via `requirePermission`. This is stronger than the old
 * generated-CRUD org-scope (which is why exposing `units` here is safe: only a user
 * who may read this project's equipment receives it — exactly what the server
 * action already returns to that user). Org+project scoping is enforced by the indexed reads + the org filter.
 *
 * Not consumed yet — the equipment-tab cutover (Phase 1d) wires `useQuery` onto this
 * behind a feature flag; until then this is additive and inert.
 */
export const browserBundle = query({
  args: { projectId: v.string(), orgId: v.string(), versionId: v.optional(v.string()) },
  handler: async (ctx, { projectId, orgId, versionId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    return readBundle(ctx, projectId, orgId, versionId);
  },
});
