import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";

/**
 * BROWSER-facing native replacement for getRecentActivity (Phase 3): the recent
 * scan / test-and-tag / maintenance feed. The scan-log + test-record reads are
 * BOUNDED to the newest 10 via org+time composite indexes
 * (by_organizationId_scannedAt / by_organizationId_testDate) — NOT a whole-org
 * scan-log collect. User names resolve from the Convex `users` mirror (no Prisma
 * join). Returns the same `{ logs, testRecords, maintenanceRecords }` shape the
 * page's buildActivityTimeline consumes (thin DTOs of the read fields). Gated on
 * requireOrgRead.
 */

async function userNames(ctx: QueryCtx, ids: string[]): Promise<Map<string, { id: string; name: string }>> {
  const map = new Map<string, { id: string; name: string }>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (u) map.set(id, { id: u.id, name: u.name });
    }),
  );
  return map;
}

async function modelNames(ctx: QueryCtx, ids: string[]): Promise<Map<string, { name: string }>> {
  const map = new Map<string, { name: string }>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (m) map.set(id, { name: m.name });
    }),
  );
  return map;
}

export const bundle = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);

    // ── newest 10 scan logs (bounded via composite index) ──
    const scanLogs = await ctx.db
      .query("assetScanLogs")
      .withIndex("by_organizationId_scannedAt", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(10);

    // ── newest 10 test records (bounded via composite index) ──
    const testTagRecords = await ctx.db
      .query("testTagRecords")
      .withIndex("by_organizationId_testDate", (q) => q.eq("organizationId", orgId))
      .order("desc")
      .take(10);

    // ── newest 10 maintenance records (small table; sort updatedAt desc) ──
    const maintenanceAll = await ctx.db
      .query("maintenanceRecords")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    const maintenanceRecords = [...maintenanceAll]
      .sort((a, b) => (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime))
      .slice(0, 10);

    // ── referenced entities (point reads) ──
    const assetIds = scanLogs.map((l) => l.assetId).filter((x): x is string => !!x);
    const bulkIds = scanLogs.map((l) => l.bulkAssetId).filter((x): x is string => !!x);
    const projectIds = scanLogs.map((l) => l.projectId).filter((x): x is string => !!x);
    const testAssetIds = testTagRecords.map((r) => r.testTagAssetId).filter((x): x is string => !!x);

    // Maintenance asset links (take 3 per record) + their assets.
    const linkArrays = await Promise.all(
      maintenanceRecords.map((m) =>
        ctx.db.query("maintenanceRecordAssets").withIndex("by_maintenanceRecordId", (q) => q.eq("maintenanceRecordId", m.id)).collect(),
      ),
    );
    const linksByRecord = new Map(maintenanceRecords.map((m, i) => [m.id, linkArrays[i].slice(0, 3)]));
    const maintAssetIds = linkArrays.flat().map((l) => l.assetId).filter((x): x is string => !!x);

    const [assets, bulkAssets, projectDocs, testAssets] = await Promise.all([
      Promise.all([...new Set([...assetIds, ...maintAssetIds])].map((id) => ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      Promise.all([...new Set(bulkIds)].map((id) => ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      Promise.all([...new Set(projectIds)].map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
      Promise.all([...new Set(testAssetIds)].map((id) => ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique())),
    ]);
    const assetMap = new Map(assets.filter((a): a is NonNullable<typeof a> => a != null).map((a) => [a.id, a]));
    const bulkMap = new Map(bulkAssets.filter((b): b is NonNullable<typeof b> => b != null).map((b) => [b.id, b]));
    const projectMap = new Map(projectDocs.filter((p): p is NonNullable<typeof p> => p != null).map((p) => [p.id, p]));
    const testAssetMap = new Map(testAssets.filter((a): a is NonNullable<typeof a> => a != null).map((a) => [a.id, a]));

    const modelIds = [
      ...assets.filter(Boolean).map((a) => a!.modelId),
      ...bulkAssets.filter(Boolean).map((b) => b!.modelId),
    ].filter((x): x is string => !!x);
    const models = await modelNames(ctx, modelIds);

    const users = await userNames(ctx, [
      ...scanLogs.map((l) => l.scannedById),
      ...testTagRecords.map((r) => r.testedById),
      ...maintenanceRecords.map((m) => m.reportedById).filter((x): x is string => !!x),
    ]);

    const assetWithModel = (id: string | undefined | null) => {
      if (!id) return null;
      const a = assetMap.get(id);
      if (!a) return null;
      return { id: a.id, assetTag: a.assetTag, model: a.modelId ? models.get(a.modelId) ?? null : null };
    };

    return {
      logs: scanLogs.map((l) => ({
        id: l.id,
        scannedAt: l.scannedAt ?? null,
        action: l.action ?? null,
        asset: assetWithModel(l.assetId),
        bulkAsset: l.bulkAssetId
          ? (() => {
              const b = bulkMap.get(l.bulkAssetId!);
              return b ? { id: b.id, assetTag: b.assetTag, model: b.modelId ? models.get(b.modelId) ?? null : null } : null;
            })()
          : null,
        project: l.projectId ? (() => { const p = projectMap.get(l.projectId!); return p ? { id: p.id, name: p.name } : null; })() : null,
        scannedBy: users.get(l.scannedById) ?? null,
      })),
      testRecords: testTagRecords.map((r) => {
        const tta = r.testTagAssetId ? testAssetMap.get(r.testTagAssetId) : undefined;
        return {
          id: r.id,
          testDate: r.testDate ?? null,
          result: r.result ?? null,
          testTagAsset: tta ? { testTagId: tta.testTagId, description: tta.description ?? null } : null,
          testedBy: users.get(r.testedById) ?? null,
        };
      }),
      maintenanceRecords: maintenanceRecords.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status ?? null,
        updatedAt: m.updatedAt ?? m._creationTime,
        reportedBy: m.reportedById ? users.get(m.reportedById) ?? null : null,
        assets: (linksByRecord.get(m.id) ?? []).map((l) => ({
          id: l.id,
          maintenanceRecordId: l.maintenanceRecordId,
          assetId: l.assetId,
          asset: assetWithModel(l.assetId),
        })),
      })),
    };
  },
});
