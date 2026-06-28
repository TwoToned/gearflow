import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";

/**
 * BROWSER-facing composite for the project EQUIPMENT EDITING TAB (Phase 5 native
 * reads). Returns, as RAW docs, everything the tab's six server-action reads
 * (getProjectCategories / getUncategorizedLineItems / getUncategorized{SubHire,
 * Project}Groups / getSubHires) need, so the client reconstructs all of them from
 * ONE live subscription instead of re-fetching six server actions on every change
 * (the old useProjectEquipmentLiveSync doorbell → refetch path, the source of the
 * slow cross-tab propagation). Gated on requireOrgPermission(project, read).
 *
 * Overbooking is NOT here — it stays on overbooking.bundle (already browser-safe)
 * and computeOverbookedStatus (kept as-is; see equipment-tab-reconstruct).
 */
async function readEquipmentTab(ctx: QueryCtx, projectId: string, orgId: string) {
  const [lineItems, categories, groups, subHires] = await Promise.all([
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);

  // Category slots: one indexed read per category (typically ≤10).
  const slotArrays = await Promise.all(
    categories.map((c) =>
      ctx.db.query("categorySlots").withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", c.id)).collect(),
    ),
  );
  const categorySlots = slotArrays.flat();

  // Sub-hire groups + items: per sub-hire.
  const subHireIds = subHires.map((s) => s.id);
  const [shGroupArrays, shItemArrays] = await Promise.all([
    Promise.all(subHireIds.map((id) => ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", id)).collect())),
    Promise.all(subHireIds.map((id) => ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", id)).collect())),
  ]);
  const subHireGroups = shGroupArrays.flat();
  const subHireItems = shItemArrays.flat();

  // Referenced assets/bulks/kits (point reads by id, like projectEquipment.bundle).
  const uniq = (arr: Array<string | undefined | null>): string[] => [
    ...new Set(arr.filter((x): x is string => !!x)),
  ];
  const refAssetIds = uniq(lineItems.map((li) => li.assetId));
  const refBulkIds = uniq(lineItems.map((li) => li.bulkAssetId));
  const refKitIds = uniq(lineItems.map((li) => li.kitId));

  const [assetDocs, bulkDocs, kitDocs, models, suppliers, orgCategories] = await Promise.all([
    Promise.all(refAssetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    Promise.all(refBulkIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    Promise.all(refKitIds.map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ctx.db.query("suppliers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
  ]);

  const inOrg = <T extends { organizationId?: string | null }>(arr: (T | null)[]) =>
    arr.filter((d): d is T => d !== null && d.organizationId === orgId);

  return {
    lineItems,
    categories,
    groups,
    categorySlots,
    subHires,
    subHireGroups,
    subHireItems,
    assets: inOrg(assetDocs),
    bulkAssets: inOrg(bulkDocs),
    kits: inOrg(kitDocs),
    models,
    suppliers,
    orgCategories,
  };
}

export const bundle = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    return readEquipmentTab(ctx, projectId, orgId);
  },
});
