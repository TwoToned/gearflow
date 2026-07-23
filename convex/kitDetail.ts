import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { pick, USER_PUBLIC_FIELDS, FILE_URL_FIELDS } from "./lib/dto";
import { getKitByCuid } from "./lib/kits";

/**
 * BROWSER-facing composite for the KIT detail page (Phase 2 native reads). Returns
 * everything getKit needs as RAW docs (members + their assets/models, ≤20 recent
 * usage line items + their projects, ≤20 recent scan logs + their users/projects,
 * media + files, location, category) so the client reconstructs the getKit shape
 * from ONE live subscription. Gated on requireOrgPermission(kit, read).
 *
 * Referenced-only point reads; maintenanceRecords intentionally omitted (the kit
 * page never renders them). Returns null when the kit is missing / cross-org.
 */
async function readKitDetail(ctx: QueryCtx, kitId: string, orgId: string) {
  const kit = await getKitByCuid(ctx, kitId);
  if (!kit || kit.organizationId !== orgId) return null;

  const [serialized, bulk, lineItemsAll, scanLogsAll, media] = await Promise.all([
    ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect(),
    ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect(),
    ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect(),
    ctx.db.query("assetScanLogs").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect(),
    ctx.db.query("kitMedia").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect(),
  ]);

  // ≤20 most-recent usage line items + scan logs (mirror getKit's sort + slice).
  const lineItems = [...lineItemsAll]
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 20)
    .filter((r) => r.organizationId === orgId);
  const scanLogs = [...scanLogsAll]
    .sort((a, b) => (b.scannedAt ?? 0) - (a.scannedAt ?? 0))
    .slice(0, 20)
    .filter((r) => r.organizationId === orgId);

  const uniq = (arr: Array<string | undefined | null>): string[] => [
    ...new Set(arr.filter((x): x is string => !!x)),
  ];
  const pr = <T>(rows: Promise<T | null>[]) => Promise.all(rows);

  const [assetDocs, bulkDocs] = await Promise.all([
    pr(uniq(serialized.map((s) => s.assetId)).map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(uniq(bulk.map((b) => b.bulkAssetId)).map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
  ]);
  const inOrg = <T extends { organizationId?: string | null }>(arr: (T | null)[]) =>
    arr.filter((d): d is T => d !== null && d.organizationId === orgId);
  const assets = inOrg(assetDocs);
  const bulkAssets = inOrg(bulkDocs);

  const refModelIds = uniq([...assets.map((a) => a.modelId), ...bulkAssets.map((b) => b.modelId)]);
  const refProjectIds = uniq([...lineItems.map((r) => r.projectId), ...scanLogs.map((r) => r.projectId)]);
  const refUserIds = uniq(scanLogs.map((r) => r.scannedById));
  const refFileIds = uniq(media.map((m) => m.fileId));

  const [modelDocs, projectDocs, userDocs, fileDocs] = await Promise.all([
    pr(refModelIds.map((id) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(refProjectIds.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(refUserIds.map((id) => ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    pr(refFileIds.map((id) => ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
  ]);

  const location = kit.locationId
    ? await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", kit.locationId!)).unique()
    : null;
  const category = kit.categoryId
    ? await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", kit.categoryId!)).unique()
    : null;

  return {
    kit,
    serializedItems: serialized,
    bulkItems: bulk,
    lineItems,
    scanLogs,
    media,
    assets,
    bulkAssets,
    models: inOrg(modelDocs),
    projects: inOrg(projectDocs),
    // Allowlist DTOs (§3.5): the kit page needs only the scanner's { id, name } and
    // the media file URLs — never `users` PII (email/role/…) or the file storageKey.
    users: userDocs
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => pick(u, USER_PUBLIC_FIELDS)),
    files: inOrg(fileDocs).map((f) => pick(f, FILE_URL_FIELDS)),
    location: location && location.organizationId === orgId ? location : null,
    category: category && category.organizationId === orgId ? category : null,
  };
}

export const bundle = query({
  args: { kitId: v.string(), orgId: v.string() },
  handler: async (ctx, { kitId, orgId }) => {
    await requireOrgPermission(ctx, orgId, "kit", "read");
    return readKitDetail(ctx, kitId, orgId);
  },
});
