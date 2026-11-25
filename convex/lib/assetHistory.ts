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
  | "ACCESSORY"
  | "ORDER"
  | "MEDIA"
  | "CASE"
  | "MODEL_ACCESSORY";

const REASON_TEXT: Record<AssetHistoryReason, string> = {
  JOB: "it has been on a job",
  MAINTENANCE: "it has maintenance records",
  TEST_AND_TAG: "it has test & tag records",
  CHECK: "it has check records",
  SCAN: "it has scan history",
  KIT: "it is part of a kit",
  ACCESSORY: "it has accessories attached",
  ORDER: "it is on a supplier order",
  MEDIA: "it has photos",
  CASE: "it is a case on a job",
  MODEL_ACCESSORY: "it is a default accessory of a model",
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
  const [lines, units, maint, checks, scans, kit, kids, bulkKids, tt, orderItems, media, cases] = await Promise.all([
    db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("projectLineItemUnits").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("maintenanceRecordAssets").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("checkRecords").withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id)).take(1),
    db.query("assetScanLogs").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("kitSerializedItems").withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id)).take(1),
    db.query("assets").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id)).take(3),
    db.query("assetBulkChildren").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", id)).take(3),
    db.query("testTagAssets").withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", orgId).eq("assetId", id)).take(5),
    db.query("supplierOrderItems").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("assetMedia").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
    db.query("projectContainers").withIndex("by_assetId", (q) => q.eq("assetId", id)).take(3),
  ]);
  // (`projectLineItemUnits.parentUnitAssetId` has no index: an accessory unit under this
  // unit sits on a job line, which the JOB rule above already covers.)
  return firstReason([
    ["JOB", () => inOrg(lines, orgId) || inOrg(units, orgId)],
    ["CASE", () => inOrg(cases, orgId)],
    ["MAINTENANCE", () => maintenanceInOrg(ctx, orgId, maint)],
    ["TEST_AND_TAG", () => hasTestRecord(ctx, orgId, tt)],
    ["CHECK", () => checks.length > 0],
    ["SCAN", () => inOrg(scans, orgId)],
    ["KIT", () => kit.length > 0],
    ["ACCESSORY", () => inOrg(kids, orgId) || inOrg(bulkKids, orgId)],
    ["ORDER", () => orderItemsInOrg(ctx, orgId, orderItems)],
    ["MEDIA", () => inOrg(media, orgId)],
  ]);
}

/** The first rule that holds, in order; `null` = a bare row. */
async function firstReason(rules: [AssetHistoryReason, () => boolean | Promise<boolean>][]): Promise<AssetHistoryReason | null> {
  for (const [reason, holds] of rules) if (await holds()) return reason;
  return null;
}

async function bulkReason(ctx: QueryCtx, orgId: string, id: string): Promise<AssetHistoryReason | null> {
  const db = ctx.db;
  const [lines, units, maint, checks, scans, kit, tt, kids, cases, modelAcc] = await Promise.all([
    db.query("projectLineItems").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("projectLineItemUnits").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("maintenanceRecordAssets").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("checkRecords").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("assetScanLogs").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("kitBulkItems").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("testTagAssets").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(5),
    db.query("assetBulkChildren").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("projectContainers").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
    db.query("modelBulkAccessories").withIndex("by_bulkAssetId", (q) => q.eq("bulkAssetId", id)).take(3),
  ]);
  return firstReason([
    ["JOB", () => inOrg(lines, orgId) || inOrg(units, orgId)],
    ["CASE", () => inOrg(cases, orgId)],
    ["MAINTENANCE", () => maintenanceInOrg(ctx, orgId, maint)],
    ["TEST_AND_TAG", () => hasTestRecord(ctx, orgId, tt)],
    ["CHECK", () => inOrg(checks, orgId)],
    ["SCAN", () => inOrg(scans, orgId)],
    ["KIT", () => inOrg(kit, orgId)],
    ["ACCESSORY", () => inOrg(kids, orgId)],
    ["MODEL_ACCESSORY", () => inOrg(modelAcc, orgId)],
  ]);
}

/** Links carry no org of their own: the record they point at does. */
async function maintenanceInOrg(ctx: QueryCtx, orgId: string, links: { maintenanceRecordId: string }[]) {
  for (const l of links) {
    const rec = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", l.maintenanceRecordId)).first();
    if (rec && rec.organizationId === orgId) return true;
  }
  return false;
}

/** An order line carries no org of its own: the order does. */
async function orderItemsInOrg(ctx: QueryCtx, orgId: string, items: { orderId: string }[]) {
  for (const it of items) {
    const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", it.orderId)).first();
    if (order && order.organizationId === orgId) return true;
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
