import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { getKitByCuid } from "./lib/kits";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * #1080/#1101 — the Equipment tab's version-viewing "bundle assembly" read.
 * Mirrors `convex/equipmentTab.ts`'s `readEquipmentTab` almost exactly, with
 * ONE difference: the project-owned rows (`lineItems`/`categories`/`groups`/
 * `categorySlots`/`subHires`/`subHireGroups`/`subHireItems`) come from a
 * captured snapshot's entries instead of the live tables, while the
 * REFERENCE rows (`assets`/`bulkAssets`/`kits`/`models`/`suppliers`/
 * `orgCategories`) are still resolved from CURRENT tables by id — those are
 * static reference data (a model's name), not "live availability", so
 * resolving them fresh is consistent with how the live tab already works,
 * not a new kind of liveness leaking into a frozen version.
 *
 * This query does NOT reconstruct anything — no grouping, no `categorySlots`
 * interleaving, no attach-maps. It only assembles a bundle SHAPED like
 * `EquipmentTabBundleData` (`src/lib/equipment-tab-reconstruct.ts`). The
 * client calls the EXISTING, UNCHANGED `reconstructProjectCategories` /
 * `reconstructUncategorizedLineItems` / `reconstructUncategorizedSubHireGroups`
 * / `reconstructUncategorizedProjectGroups` against this bundle — the exact
 * same functions `use-native-equipment-tab.ts` calls for the LIVE bundle.
 * That split is deliberate, not incidental: the Convex bundler cannot resolve
 * `@/` path aliases, so `equipment-tab-reconstruct.ts` (which imports
 * `@/components/projects/equipment-rows`) can never be imported from a
 * `convex/*.ts` file — duplicating its ~130-line `categorySlots` interleaving
 * algorithm into `convex/` would violate R-3.1 the moment the two drift. See
 * FEATUREDOCS/70's "Phase 6" for the full picture.
 *
 * `units` (per-serial fulfillment rows, `projectLineItemUnits`) is always
 * `[]` here — which physical asset is deployed/returned on a line is
 * warehouse/fulfillment state, not a versioned business fact, the same
 * reasoning `restoreProjectSnapshot`'s `LINE_ITEM_WAREHOUSE_FIELDS` exclusion
 * already applies. `LineItemData.units` is optional, so the row components
 * render correctly without it.
 */
export const bundle = query({
  args: { projectId: v.string(), orgId: v.string(), snapshotId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      lineItems: v.array(v.any()),
      units: v.array(v.any()),
      categories: v.array(v.any()),
      groups: v.array(v.any()),
      categorySlots: v.array(v.any()),
      subHires: v.array(v.any()),
      subHireGroups: v.array(v.any()),
      subHireItems: v.array(v.any()),
      assets: v.array(v.any()),
      bulkAssets: v.array(v.any()),
      kits: v.array(v.any()),
      models: v.array(v.any()),
      suppliers: v.array(v.any()),
      orgCategories: v.array(v.any()),
    }),
  ),
  handler: async (ctx, { projectId, orgId, snapshotId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");

    // Org-check the parent snapshot row first — snapshotId alone doesn't
    // prove tenancy (by_snapshotId on projectSnapshotEntries is not itself
    // org-scoped), same rule projectLocksRead.snapshotEntries follows (R-8.4.3).
    const snapshot = await ctx.db.query("projectSnapshots").withIndex("by_cuid", (q) => q.eq("id", snapshotId)).first();
    if (!snapshot || snapshot.organizationId !== orgId || snapshot.projectId !== projectId) return null;

    const entries = (
      await ctx.db.query("projectSnapshotEntries").withIndex("by_snapshotId", (q) => q.eq("snapshotId", snapshotId)).collect()
    ).filter((e) => e.organizationId === orgId);

    const byType = (t: string): Record<string, unknown>[] =>
      entries.filter((e) => e.entityType === t).map((e) => e.data as Record<string, unknown>);

    const lineItems = byType("lineItem");
    const categories = byType("category");
    const groups = byType("group");
    const categorySlots = byType("categorySlot");
    const subHires = byType("subHire");
    const subHireGroups = byType("subHireGroup");
    const subHireItems = byType("subHireItem");

    // Referenced-only point reads — mirrors convex/equipmentTab.ts's
    // readEquipmentTab: load exactly what THIS snapshot's rows reference,
    // never a whole-org catalog scan.
    const uniq = (arr: Array<unknown>): string[] => [
      ...new Set(arr.filter((x): x is string => typeof x === "string" && x.length > 0)),
    ];
    const refAssetIds = uniq(lineItems.map((li) => li.assetId));
    const refBulkIds = uniq(lineItems.map((li) => li.bulkAssetId));
    const refKitIds = uniq(lineItems.map((li) => li.kitId));
    const refModelIds = uniq(lineItems.map((li) => li.modelId));
    const refSupplierIds = uniq([
      ...lineItems.map((li) => li.supplierId),
      ...subHires.map((s) => s.supplierId),
    ]);

    const byCuid = <T>(rows: Promise<T | null>[]) => Promise.all(rows);
    const [assetDocs, bulkDocs, kitDocs, modelDocs, supplierDocs] = await Promise.all([
      byCuid(refAssetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      byCuid(refBulkIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      byCuid(refKitIds.map((id) => getKitByCuid(ctx, id))),
      byCuid(refModelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      byCuid(refSupplierIds.map((id) => ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    ]);

    const inOrg = <T extends { organizationId?: string | null } | null>(arr: T[]) =>
      arr.filter((d): d is T & { organizationId: string } => d != null && d.organizationId === orgId);

    const models = inOrg(modelDocs);
    const suppliers = inOrg(supplierDocs);

    // Categories referenced by the (in-org) models, point-read by id — mirrors
    // readEquipmentTab's resolveAttachedModel category nesting.
    const refCategoryIds = uniq(models.map((m) => (m as unknown as { categoryId?: string }).categoryId));
    const categoryDocs = await Promise.all(
      refCategoryIds.map((id) => ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );

    return {
      lineItems,
      units: [],
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
      orgCategories: inOrg(categoryDocs),
    };
  },
});

export const agentOps: AgentOpsAnnotations = {
  bundle: {
    summary: "Assemble a captured version's Equipment tab bundle (categories/groups/line items/sub-hires) for read-only rendering.",
    danger: "low",
    mcpTier: 2,
  },
};
