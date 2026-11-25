import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assetHistoryReason, assetHistoryText } from "./lib/assetHistory";
import { getAuthContext, isAgentNoFinancials, redactFields, requireOrgPermission } from "./lib/auth";
import { ASSET_COST_FIELDS, MODEL_COST_FIELDS } from "./lib/gearCostFields";
import { pick, FILE_META_FIELDS } from "./lib/dto";

/** Last completed service and open repairs, from this unit's LINK rows (CHECKOFF rows are PM progress, not a job on it). */
function maintenanceFacts(links: Doc<"maintenanceRecordAssets">[], all: Doc<"maintenanceRecords">[]) {
  const linked = new Set(links.filter((l) => (l.kind ?? "LINK") === "LINK").map((l) => l.maintenanceRecordId));
  const records = all.filter((r) => linked.has(r.id));
  const done = records
    .filter((r) => r.type === "PREVENTATIVE" && r.status === "COMPLETED" && r.completedDate != null)
    .map((r) => r.completedDate!);
  return {
    lastServiceAt: done.length ? Math.max(...done) : null,
    openRepairs: records.filter((r) => r.type === "REPAIR" && r.status !== "COMPLETED" && r.status !== "CANCELLED").length,
  };
}

const JOB_HISTORY_CAP = 60;
const CHECK_WINDOW = 30;
const SCAN_WINDOW = 5;

/**
 * The facts `assetHealth()` and the Overview read that are not already docs in the
 * bundle (UX Phase 12). All bounded and org-checked; nothing is stored. `canDelete` is the
 * server's own history rule (`assetHistoryReason`), so the Retire dialog's Delete
 * button and `deleteNative` can never disagree.
 */
async function readHealthFacts(
  ctx: QueryCtx,
  orgId: string,
  a: {
    asset: Doc<"assets">;
    modelId: string | null;
    maintLinks: Doc<"maintenanceRecordAssets">[];
    maintenanceRecords: Doc<"maintenanceRecords">[];
    lineItems: Doc<"projectLineItems">[];
    projects: Doc<"projects">[];
    jobsTruncated: boolean;
  },
) {
  const assetId = a.asset.id;
  const [schedules, checks, scans, history] = await Promise.all([
    a.modelId
      ? ctx.db.query("serviceSchedules").withIndex("by_organizationId_modelId", (q) => q.eq("organizationId", orgId).eq("modelId", a.modelId!)).take(20)
      : Promise.resolve([]),
    ctx.db.query("checkRecords").withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", assetId)).order("desc").take(CHECK_WINDOW),
    ctx.db.query("assetScanLogs").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).order("desc").take(SCAN_WINDOW),
    assetHistoryReason(ctx, orgId, { assetId }),
  ]);

  const { lastServiceAt, openRepairs } = maintenanceFacts(a.maintLinks, a.maintenanceRecords);
  const prepOrReturn = checks.filter((c) => c.context === "PREP" || c.context === "RETURN");
  const newest = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  const lastScanAt = newest([
    ...scans.filter((s) => s.organizationId === orgId).map((s) => s.scannedAt ?? 0),
    ...checks.map((c) => c.performedAt ?? 0),
  ].filter((n) => n > 0));

  // Out on a job: the job's end date is when the unit is due back.
  const active = a.lineItems.find((li) => li.status === "CHECKED_OUT" && !li.returnedAt);
  const dueBackAt = active ? a.projects.find((p) => p.id === active.projectId)?.rentalEndDate ?? null : null;

  return {
    serviceSchedules: schedules
      .filter((s) => s.isActive !== false)
      .map((s) => ({ intervalMonths: s.intervalMonths, anchorDate: s.anchorDate })),
    lastServiceAt,
    jobsTruncated: a.jobsTruncated,
    openRepairs,
    hasPrepOrReturnCheck: prepOrReturn.length > 0,
    lastCheckResult: prepOrReturn[0]?.result ?? null,
    lastScanAt,
    dueBackAt,
    /** The Delete gate, answered by the server's one rule (`assetHistoryReason`), the same one `deleteNative` enforces. */
    canDelete: history == null,
    deleteBlockedBy: history,
    deleteBlockedText: history ? assetHistoryText(history) : null,
  };
}

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

  // The newest JOB_HISTORY_CAP usage line items (org filter first, so a foreign row never takes a slot),
  // with `jobsTruncated` so the History tab says when there are more than it shows (Q-8).
  const lineItemsOrg = lineItemsAll.filter((r) => r.organizationId === orgId).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const lineItems = lineItemsOrg.slice(0, JOB_HISTORY_CAP);
  const jobsTruncated = lineItemsOrg.length > JOB_HISTORY_CAP;

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
  // Allowlist DTO (§3.5): media rendering needs the URLs + display metadata; never
  // the file `storageKey` (the S3/blob object key) or `uploadedById`.
  const files = inOrg(await pr(refFileIds.map((id) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique()))).map((f) =>
    pick(f, FILE_META_FIELDS),
  );

  const facts = await readHealthFacts(ctx, orgId, {
    asset, modelId: asset.modelId ?? null, maintLinks, maintenanceRecords, lineItems, projects, jobsTruncated,
  });

  return {
    facts,
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
    const detail = await readAssetDetail(ctx, assetId, orgId);
    if (!detail || !(await isAgentNoFinancials(ctx, await getAuthContext(ctx)))) return detail;
    // A `noFinancials` key never sees what the unit or its model COST: ABSENT, never zeroed.
    const noModelCost = <M extends Record<string, unknown> | null>(m: M): M => (m ? redactFields(m, MODEL_COST_FIELDS) : m);
    return {
      ...detail,
      asset: redactFields(detail.asset, ASSET_COST_FIELDS),
      model: noModelCost(detail.model),
      models: detail.models.map((m) => redactFields(m, MODEL_COST_FIELDS)),
    };
  },
});
