import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireService, requireOrgPermission } from "./lib/auth";

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
async function readBundle(ctx: QueryCtx, projectId: string, orgId: string) {
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
    Promise.all(refKitIds.map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
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
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireService(ctx);
    return readBundle(ctx, projectId, orgId);
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
 * action already returns to that user). See docs/designs/convex-native-read-layer.md
 * §3.3/§3.5. Org+project scoping is enforced by the indexed reads + the org filter.
 *
 * Not consumed yet — the equipment-tab cutover (Phase 1d) wires `useQuery` onto this
 * behind a feature flag; until then this is additive and inert.
 */
export const browserBundle = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    return readBundle(ctx, projectId, orgId);
  },
});
