import type { QueryCtx } from "../_generated/server";

/**
 * "Does this asset have history?" — the ONE rule behind D32's Delete gate (UX
 * Phase 12). A unit may only be deleted while it is a bare row; once it has been
 * on a job, serviced, tested, checked or scanned, Retire is the only way out,
 * because Delete would destroy that record. `assetDetail.bundle` hands the UI the
 * same answer (`canDelete`), `deleteNative` enforces it, so the dialog's button
 * state and the server can never disagree (R-3.1, R-9.3).
 *
 * Existence checks only (`take(3)`, never `collect`), each over an index. `by_*Id`
 * indexes are global, so every candidate row is org-checked.
 *
 * Retire / edit audit rows are deliberately NOT history: an edited asset is still
 * a bare asset. A T&T registration the system created is not history either; a
 * recorded TEST is.
 */
export type AssetHistoryReason =
  | "JOB"
  | "MAINTENANCE"
  | "TEST_AND_TAG"
  | "CHECK"
  | "SCAN"
  | "KIT"
  | "ACCESSORY";

const REASON_TEXT: Record<AssetHistoryReason, string> = {
  JOB: "it has been on a job",
  MAINTENANCE: "it has maintenance records",
  TEST_AND_TAG: "it has test & tag records",
  CHECK: "it has check records",
  SCAN: "it has scan history",
  KIT: "it is part of a kit",
  ACCESSORY: "it has accessories attached",
};

export const assetHistoryText = (r: AssetHistoryReason) => REASON_TEXT[r];

type Target = { assetId: string } | { bulkAssetId: string };

const inOrg = (rows: { organizationId?: string }[], orgId: string) => rows.some((r) => r.organizationId === orgId);

/** The first reason this unit has history, or `null` for a bare row. */
export async function assetHistoryReason(
  ctx: QueryCtx,
  orgId: string,
  target: Target,
): Promise<AssetHistoryReason | null> {
  if ("assetId" in target) return serialisedReason(ctx, orgId, target.assetId);
  return bulkReason(ctx, orgId, target.bulkAssetId);
}

async function serialisedReason(ctx: QueryCtx, orgId: string, id: string): Promise<AssetHistoryReason | null> {
  const db = ctx.db;
  const [lines, units, maint, checks, scans, kit, kids, bulkKids, tt] = await Promise.all([
    db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("projectLineItemUnits").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("maintenanceRecordAssets").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("checkRecords").withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id)).take(1),
    db.query("assetScanLogs").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("kitSerializedItems").withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id)).take(1),
    db.query("assets").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id)).take(3),
    db.query("assetBulkChildren").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id)).take(3),
    db.query("testTagAssets").withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id)).take(5),
  ]);
  if (inOrg(lines, orgId) || inOrg(units, orgId)) return "JOB";
  if (await maintenanceInOrg(ctx, orgId, maint)) return "MAINTENANCE";
  if (await hasTestRecord(ctx, orgId, tt)) return "TEST_AND_TAG";
  if (checks.length > 0) return "CHECK";
  if (inOrg(scans, orgId)) return "SCAN";
  if (kit.length > 0) return "KIT";
  if (inOrg(kids, orgId) || inOrg(bulkKids, orgId)) return "ACCESSORY";
  return null;
}

async function bulkReason(ctx: QueryCtx, orgId: string, id: string): Promise<AssetHistoryReason | null> {
  const db = ctx.db;
  const [lines, units, maint, checks, scans, kit, tt, kids] = await Promise.all([
    db.query("projectLineItems").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("projectLineItemUnits").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("maintenanceRecordAssets").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("checkRecords").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("assetScanLogs").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("kitBulkItems").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("testTagAssets").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(5),
    db.query("assetBulkChildren").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
  ]);
  if (inOrg(lines, orgId) || inOrg(units, orgId)) return "JOB";
  if (await maintenanceInOrg(ctx, orgId, maint)) return "MAINTENANCE";
  if (await hasTestRecord(ctx, orgId, tt.filter((r) => r.organizationId === orgId))) return "TEST_AND_TAG";
  if (inOrg(checks, orgId)) return "CHECK";
  if (inOrg(scans, orgId)) return "SCAN";
  if (inOrg(kit, orgId)) return "KIT";
  if (inOrg(kids, orgId)) return "ACCESSORY";
  return null;
}

/** Links carry no org of their own: the record they point at does. */
async function maintenanceInOrg(ctx: QueryCtx, orgId: string, links: { maintenanceRecordId: string }[]) {
  for (const l of links) {
    const rec = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", l.maintenanceRecordId)).first();
    if (rec && rec.organizationId === orgId) return true;
  }
  return false;
}

/** A recorded TEST (not just the system-created registration) counts as history. */
async function hasTestRecord(ctx: QueryCtx, orgId: string, rows: { id: string; organizationId: string; lastTestDate?: number }[]) {
  for (const tt of rows) {
    if (tt.organizationId !== orgId) continue;
    if (tt.lastTestDate != null) return true;
    const rec = await ctx.db
      .query("testTagRecords")
      .withIndex("by_organizationId_testTagAssetId", (q) => q.eq("organizationId", orgId).eq("testTagAssetId", tt.id))
      .first();
    if (rec) return true;
  }
  return false;
}
