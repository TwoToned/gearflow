import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { getKitByCuid } from "./lib/kits";

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
  const [rawLineItems, rawCategories, rawGroups, rawSubHires] = await Promise.all([
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectCategories").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);

  // `requireOrgPermission` validates the CALLER's org, not the project's — and it
  // short-circuits entirely for the service token. `projectId` is caller-supplied,
  // so without this filter a foreign projectId returns another org's equipment.
  // Everything below derives from these four, so filtering here covers the whole
  // bundle (slots come from categories; sub-hire groups/items from subHires).
  const ownedBy = <T extends { organizationId: string }>(rows: T[]) =>
    rows.filter((r) => r.organizationId === orgId);

  const lineItems = ownedBy(rawLineItems);
  const categories = ownedBy(rawCategories);
  const groups = ownedBy(rawGroups);
  const subHires = ownedBy(rawSubHires);

  // Category slots: one indexed read per category (typically ≤10).
  const slotArrays = await Promise.all(
    categories.map((c) =>
      ctx.db.query("categorySlots").withIndex("by_projectCategoryId", (q) => q.eq("projectCategoryId", c.id)).collect(),
    ),
  );
  const categorySlots = slotArrays.flat();

  // Per-unit fulfillment rows (which specific serial is prepped/deployed/returned
  // on each line) — one indexed read per line item, mirroring the pull-sheet /
  // getProjectForWarehouse reconstructs. Feeds the equipment tab's per-unit asset
  // display; `ownedBy` re-asserts org ownership (belt-and-braces; units carry
  // `organizationId`). Every status is kept — RETURNED units are the "what went
  // out" history and must survive check-in + close-out in this view.
  const unitArrays = await Promise.all(
    lineItems.map((li) =>
      ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", li.id)).collect(),
    ),
  );
  const units = ownedBy(unitArrays.flat());

  // Sub-hire groups + items: per sub-hire.
  const subHireIds = subHires.map((s) => s.id);
  const [shGroupArrays, shItemArrays] = await Promise.all([
    Promise.all(subHireIds.map((id) => ctx.db.query("subHireGroups").withIndex("by_subHireId", (q) => q.eq("subHireId", id)).collect())),
    Promise.all(subHireIds.map((id) => ctx.db.query("subHireItems").withIndex("by_subHireId", (q) => q.eq("subHireId", id)).collect())),
  ]);
  const subHireGroups = shGroupArrays.flat();
  const subHireItems = shItemArrays.flat();

  // Referenced-only point reads (by id), NEVER whole-org catalog loads — the
  // attach maps key by id, so loading exactly what the project references yields
  // identical attachments to the old whole-org load (parity-by-construction) at
  // O(referenced) cost. assets/bulks/kits referenced by line items; models by
  // line items; suppliers by line items AND sub-hires; categories by the
  // referenced models' categoryId (resolveAttachedModel nests the model's
  // category). This mirrors getProjectCategories' refIdsFromLineItems fix, and
  // extends referenced-only to models/suppliers/categories too.
  const uniq = (arr: Array<string | undefined | null>): string[] => [
    ...new Set(arr.filter((x): x is string => !!x)),
  ];
  // Assets/bulks referenced by LINE-level FKs AND by per-unit fulfillment rows.
  // A multi-quantity serialised line keeps its serials on `projectLineItemUnits`
  // (its own `assetId` is null), so without the unit ids here those assets are
  // never loaded and their tag resolves to null — the per-unit serials render
  // blank on the equipment tab. Include both.
  const refAssetIds = uniq([
    ...lineItems.map((li) => li.assetId),
    ...units.map((u) => u.assetId),
  ]);
  const refBulkIds = uniq([
    ...lineItems.map((li) => li.bulkAssetId),
    ...units.map((u) => u.bulkAssetId),
  ]);
  const refKitIds = uniq(lineItems.map((li) => li.kitId));
  const refModelIds = uniq(lineItems.map((li) => li.modelId));
  const refSupplierIds = uniq([
    ...lineItems.map((li) => li.supplierId),
    ...subHires.map((s) => s.supplierId),
  ]);

  // Per-table point reads (each keeps its full Doc type — the attach maps and the
  // client reconstruction read concrete fields like id/categoryId/assetTag).
  const byCuid = <T>(rows: Promise<T | null>[]) => Promise.all(rows);
  const [assetDocs, bulkDocs, kitDocs, modelDocs, supplierDocs] = await Promise.all([
    byCuid(refAssetIds.map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    byCuid(refBulkIds.map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    byCuid(refKitIds.map((id) => getKitByCuid(ctx, id))),
    byCuid(refModelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    byCuid(refSupplierIds.map((id) => ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
  ]);

  const inOrg = <T extends { organizationId?: string | null }>(arr: (T | null)[]) =>
    arr.filter((d): d is T => d !== null && d.organizationId === orgId);

  const models = inOrg(modelDocs);
  const suppliers = inOrg(supplierDocs);

  // Categories referenced by the (in-org) models, point-read by id.
  const refCategoryIds = uniq(models.map((m) => m.categoryId));
  const categoryDocs = await Promise.all(
    refCategoryIds.map((id) => ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
  );

  return {
    lineItems,
    units,
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
}

export const bundle = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "project", "read");
    return readEquipmentTab(ctx, projectId, orgId);
  },
});
