import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireService, requireOrgRead, requireOrgReadDoc } from "./lib/auth";
import * as enums from "./lib/validators";

// ── Pure filter/sort helpers ported from src/lib/test-tag-read.ts (byte-for-byte;
//    epoch-ms dates on Convex docs, so the number branch handles nextDue/lastTest). ──
const TT_STATUS_RANK: Record<string, number> = { NOT_YET_TESTED: 0, CURRENT: 1, DUE_SOON: 2, OVERDUE: 3, FAILED: 4, RETIRED: 5 };
const TT_EQCLASS_RANK: Record<string, number> = { CLASS_I: 0, CLASS_II: 1, CLASS_II_DOUBLE_INSULATED: 2, LEAD_CORD_ASSEMBLY: 3 };
const TT_APPTYPE_RANK: Record<string, number> = { APPLIANCE: 0, CORD_SET: 1, EXTENSION_LEAD: 2, POWER_BOARD: 3, RCD_PORTABLE: 4, RCD_FIXED: 5, THREE_PHASE: 6, MICROWAVE: 7, OTHER: 8 };
const TT_ENUM_RANK: Record<string, Record<string, number>> = { status: TT_STATUS_RANK, equipmentClass: TT_EQCLASS_RANK, applianceType: TT_APPTYPE_RANK };
const TT_NULLABLE = new Set(["make", "modelName", "serialNumber", "location", "nextDueDate", "lastTestDate"]);
const TT_SORTABLE = new Set(["testTagId", "description", "status", "equipmentClass", "applianceType", "make", "modelName", "serialNumber", "location", "testIntervalMonths", "nextDueDate", "lastTestDate", "outletCount", "createdAt", "updatedAt"]);
const ttIns = (h: string | null | undefined, n: string) => (h ?? "").toLowerCase().includes(n.toLowerCase());
function ttCompare(a: unknown, b: unknown, key: string, order: "asc" | "desc"): number {
  const dir = order === "desc" ? -1 : 1;
  const aN = a == null, bN = b == null;
  if (aN || bN) {
    if (aN && bN) return 0;
    if (TT_NULLABLE.has(key)) { if (order === "asc") return aN ? 1 : -1; return aN ? -1 : 1; }
    return aN ? 1 : -1;
  }
  const rank = TT_ENUM_RANK[key];
  if (rank) { const ar = rank[a as string] ?? Number.MAX_SAFE_INTEGER; const br = rank[b as string] ?? Number.MAX_SAFE_INTEGER; return (ar - br) * dir; }
  if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
  return String(a).localeCompare(String(b)) * dir;
}
/** Resolve testedBy display names from the Convex `users` mirror (fallback: record.testerName). */
async function ttUserNames(ctx: QueryCtx, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const id of [...new Set(ids.filter(Boolean))]) {
    const u = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    out.set(id, u?.name ?? null);
  }
  return out;
}
const iso = (ms: number | null | undefined): string | null => (ms != null ? new Date(ms).toISOString() : null);

/**
 * Thin CRUD for TestTagAsset (Convex table "testTagAssets"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/**
 * Look up a single test tag asset by its human-facing `testTagId` within an org
 * (the scan / lookup flow). Uses the non-unique `by_organizationId_testTagId`
 * index, so return `.first()` — duplicates are possible across the dual-write
 * boundary and `.unique()` would throw.
 */
export const getByTestTagId = query({
  args: { orgId: v.string(), testTagId: v.string() },
  handler: async (ctx, { orgId, testTagId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_testTagId", (q) =>
        q.eq("organizationId", orgId).eq("testTagId", testTagId),
      )
      .first();
  },
});

/**
 * Alias of {@link getByTestTagId} kept for the scan-lookup consumer (Phase A).
 * Same `.first()`-not-`.unique()` safety on the non-unique dual-write index.
 */
export const getByOrgTestTagId = query({
  args: { orgId: v.string(), testTagId: v.string() },
  handler: async (ctx, { orgId, testTagId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_testTagId", (q) =>
        q.eq("organizationId", orgId).eq("testTagId", testTagId),
      )
      .first();
  },
});


/**
 * Find all FAILED or OVERDUE active test tag assets for the given org that
 * match any of the supplied asset or bulk-asset IDs. Used as the pre-flight
 * T&T compliance gate before warehouse checkout. Returns the blocked rows;
 * empty array = all clear.
 */
export const listBlockedForCheckout = query({
  args: {
    orgId: v.string(),
    assetIds: v.array(v.string()),
    bulkAssetIds: v.array(v.string()),
  },
  handler: async (ctx, { orgId, assetIds, bulkAssetIds }) => {
    await requireService(ctx);
    if (assetIds.length === 0 && bulkAssetIds.length === 0) return [];
    const assetSet = new Set(assetIds);
    const bulkSet = new Set(bulkAssetIds);
    // Use the by_organizationId_status composite index to scan only FAILED/OVERDUE
    const failed = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "FAILED"))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    const overdue = await ctx.db
      .query("testTagAssets")
      .withIndex("by_organizationId_status", (q) => q.eq("organizationId", orgId).eq("status", "OVERDUE"))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return [...failed, ...overdue].filter(
      (r) =>
        (r.assetId != null && assetSet.has(r.assetId)) ||
        (r.bulkAssetId != null && bulkSet.has(r.bulkAssetId)),
    );
  },
});

export const listByAssetId = query({
  args: { assetId: v.string() },
  handler: async (ctx, { assetId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("testTagAssets")
      .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
      .collect();
  },
});

// ───────────────────────── Browser-native reads (Phase 3) ─────────────────────────

const ttItemDates = <T extends Record<string, unknown>>(item: T) => ({
  ...item,
  nextDueDate: iso(item.nextDueDate as number | undefined),
  lastTestDate: iso(item.lastTestDate as number | undefined),
  createdAt: iso(item.createdAt as number | undefined),
  updatedAt: iso(item.updatedAt as number | undefined),
});

/** Paginated T&T-asset list — replaces getTestTagAssets. Filters/sorts/paginates
 *  (parity with listAssetMatchesFilters/compareTestTagAssets) + asset/bulk/profile
 *  joins + per-item testRecord count. */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    equipmentClass: v.optional(v.string()),
    applianceType: v.optional(v.string()),
    assetLinkType: v.optional(v.union(v.literal("all"), v.literal("serialized"), v.literal("bulk"), v.literal("standalone"))),
    isActive: v.optional(v.boolean()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgRead(ctx, a.orgId);
    const isActive = a.isActive ?? true;
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    const sortBy = TT_SORTABLE.has(a.sortBy ?? "") ? a.sortBy! : "testTagId";
    const order = a.sortOrder ?? "asc";

    const [items, records, orgAssets, orgBulk, profiles] = await Promise.all([
      ctx.db.query("testTagAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("testTagRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("testProfiles").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
    ]);
    const recordCounts = new Map<string, number>();
    for (const r of records) recordCounts.set(r.testTagAssetId, (recordCounts.get(r.testTagAssetId) ?? 0) + 1);
    const assetById = new Map(orgAssets.map((x) => [x.id, x]));
    const bulkById = new Map(orgBulk.map((x) => [x.id, x]));
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    const filtered = items.filter((item) => {
      if ((item.isActive ?? true) !== isActive) return false;
      if (a.status && (item.status ?? "NOT_YET_TESTED") !== a.status) return false;
      if (a.equipmentClass && item.equipmentClass !== a.equipmentClass) return false;
      if (a.applianceType && item.applianceType !== a.applianceType) return false;
      if (a.assetLinkType === "serialized") { if (item.assetId == null) return false; }
      else if (a.assetLinkType === "bulk") { if (item.bulkAssetId == null || item.assetId != null) return false; }
      else if (a.assetLinkType === "standalone") { if (item.assetId != null || item.bulkAssetId != null) return false; }
      if (a.search) {
        const hit = ttIns(item.testTagId, a.search) || ttIns(item.description, a.search) || ttIns(item.serialNumber, a.search) || ttIns(item.make, a.search) || ttIns(item.modelName, a.search);
        if (!hit) return false;
      }
      return true;
    });
    filtered.sort((x, y) => {
      const rec = x as Record<string, unknown>, recy = y as Record<string, unknown>;
      const primary = ttCompare(rec[sortBy], recy[sortBy], sortBy, order);
      if (primary !== 0) return primary;
      if (sortBy !== "testTagId") return ttCompare(x.testTagId, y.testTagId, "testTagId", "asc");
      return 0;
    });
    const total = filtered.length;
    const slice = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const mapped = slice.map((item) => {
      const la = item.assetId ? assetById.get(item.assetId) : null;
      const lb = item.bulkAssetId ? bulkById.get(item.bulkAssetId) : null;
      const prof = item.testProfileId ? profileById.get(item.testProfileId) : null;
      return {
        ...ttItemDates(item),
        asset: la ? { id: la.id, assetTag: la.assetTag, customName: la.customName ?? null } : null,
        bulkAsset: lb ? { id: lb.id, assetTag: lb.assetTag } : null,
        testProfile: prof ? { id: prof.id, name: prof.name } : null,
        _count: { testRecords: recordCounts.get(item.id) ?? 0 },
      };
    });
    return { items: mapped, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  },
});

async function ttRecordsFor(ctx: QueryCtx, orgId: string, testTagAssetId: string, take: number) {
  const recs = (await ctx.db.query("testTagRecords")
    .withIndex("by_organizationId_testTagAssetId", (q) => q.eq("organizationId", orgId).eq("testTagAssetId", testTagAssetId)).collect())
    .sort((a, b) => (b.testDate ?? 0) - (a.testDate ?? 0));
  const total = recs.length;
  const recent = recs.slice(0, take);
  const userNames = await ttUserNames(ctx, recent.map((r) => r.testedById));
  const withSubs = [];
  for (const r of recent) {
    const subs = (await ctx.db.query("subTestRecords").withIndex("by_testTagRecordId_sortOrder", (q) => q.eq("testTagRecordId", r.id)).collect());
    withSubs.push({ ...r, testDate: iso(r.testDate), testedBy: { id: r.testedById, name: userNames.get(r.testedById) ?? r.testerName ?? null }, subTestRecords: subs });
  }
  return { total, records: withSubs };
}

/** Single T&T asset with recent records (10) + linked asset/bulk(+model) — replaces getTestTagAsset. */
export const detail = query({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const item = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!item || item.organizationId !== orgId) return null;

    const { total, records } = await ttRecordsFor(ctx, orgId, id, 10);
    const profile = item.testProfileId ? await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", item.testProfileId!)).unique() : null;
    const resolvedProfile = profile && profile.organizationId === orgId ? profile : null;
    const withProfileRecords = records.map((r) => {
      const p = r.testProfileId ? (r.testProfileId === resolvedProfile?.id ? resolvedProfile : null) : null;
      return { ...r, testProfile: p ? { id: p.id, name: p.name } : null };
    });
    const la = item.assetId ? await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", item.assetId!)).unique() : null;
    const lb = item.bulkAssetId ? await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", item.bulkAssetId!)).unique() : null;
    const asset = la && la.organizationId === orgId ? la : null;
    const bulk = lb && lb.organizationId === orgId ? lb : null;
    const modelOf = async (mid: string | undefined) => {
      if (!mid) return null;
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).unique();
      return m && m.organizationId === orgId ? m : null;
    };
    return {
      ...ttItemDates(item),
      asset: asset ? { id: asset.id, assetTag: asset.assetTag, customName: asset.customName ?? null, serialNumber: asset.serialNumber ?? null, modelId: asset.modelId, model: await modelOf(asset.modelId) } : null,
      bulkAsset: bulk ? { id: bulk.id, assetTag: bulk.assetTag, totalQuantity: bulk.totalQuantity ?? null, modelId: bulk.modelId, model: await modelOf(bulk.modelId) } : null,
      testProfile: resolvedProfile ? { id: resolvedProfile.id, name: resolvedProfile.name } : null,
      testRecords: withProfileRecords,
      _count: { testRecords: total },
    };
  },
});

/** Lookup by testTagId (incl. retired) + latest record — replaces lookupTestTagAsset. */
export const lookup = query({
  args: { orgId: v.string(), testTagId: v.string() },
  handler: async (ctx, { orgId, testTagId }) => {
    await requireOrgRead(ctx, orgId);
    const item = await ctx.db.query("testTagAssets")
      .withIndex("by_organizationId_testTagId", (q) => q.eq("organizationId", orgId).eq("testTagId", testTagId)).first();
    if (!item) return null;

    const { records } = await ttRecordsFor(ctx, orgId, item.id, 1);
    const fullProfile = item.testProfileId ? await ctx.db.query("testProfiles").withIndex("by_cuid", (q) => q.eq("id", item.testProfileId!)).unique() : null;
    const profile = fullProfile && fullProfile.organizationId === orgId ? fullProfile : null;
    const la = item.assetId ? await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", item.assetId!)).unique() : null;
    const lb = item.bulkAssetId ? await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", item.bulkAssetId!)).unique() : null;
    const asset = la && la.organizationId === orgId ? la : null;
    const bulk = lb && lb.organizationId === orgId ? lb : null;
    let assetModel = null;
    if (asset?.modelId) { const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", asset.modelId)).unique(); assetModel = m && m.organizationId === orgId ? m : null; }
    return {
      ...ttItemDates(item),
      asset: asset ? { id: asset.id, assetTag: asset.assetTag, customName: asset.customName ?? null, modelId: asset.modelId, model: assetModel } : null,
      bulkAsset: bulk ? { id: bulk.id, assetTag: bulk.assetTag } : null,
      testProfile: profile,
      testRecords: records,
    };
  },
});

/** Dashboard tallies + recent tests + overdue/due-soon item lists — replaces getTestTagDashboardStats. */
export const dashboardStats = query({
  args: { orgId: v.string(), nowMs: v.number() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const [items, records, orgAssets, orgBulk] = await Promise.all([
      ctx.db.query("testTagAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("testTagRecords").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ]);
    const active = items.filter((a) => a.isActive === true);
    const countBy = (s: string) => active.filter((a) => a.status === s).length;
    const stats = {
      total: active.length,
      overdue: countBy("OVERDUE"), dueSoon: countBy("DUE_SOON"), current: countBy("CURRENT"),
      failed: countBy("FAILED"), notYetTested: countBy("NOT_YET_TESTED"),
      retired: items.filter((a) => a.status === "RETIRED").length,
    };
    const assetByTT = new Map(items.map((a) => [a.id, a]));
    const recentRecords = [...records].sort((a, b) => (b.testDate ?? 0) - (a.testDate ?? 0)).slice(0, 20);
    const userNames = await ttUserNames(ctx, recentRecords.map((r) => r.testedById));
    const recentTests = recentRecords.map((r) => {
      const tt = assetByTT.get(r.testTagAssetId);
      return { ...r, testDate: iso(r.testDate), testTagAsset: tt ? { testTagId: tt.testTagId, description: tt.description } : null, testedBy: { id: r.testedById, name: userNames.get(r.testedById) ?? r.testerName ?? null } };
    });
    const assetById = new Map(orgAssets.map((a) => [a.id, a]));
    const bulkById = new Map(orgBulk.map((b) => [b.id, b]));
    const byNextDueAsc = (a: { nextDueDate?: number }, b: { nextDueDate?: number }) => {
      const an = a.nextDueDate == null, bn = b.nextDueDate == null;
      if (an && bn) return 0; if (an) return 1; if (bn) return -1;
      return (a.nextDueDate as number) - (b.nextDueDate as number);
    };
    const attach = (item: typeof active[number]) => {
      const a = item.assetId ? assetById.get(item.assetId) : null;
      const b = item.bulkAssetId ? bulkById.get(item.bulkAssetId) : null;
      return { ...ttItemDates(item), asset: a ? { id: a.id, assetTag: a.assetTag } : null, bulkAsset: b ? { id: b.id, assetTag: b.assetTag } : null };
    };
    const overdueItems = active.filter((a) => a.status === "OVERDUE").sort(byNextDueAsc).slice(0, 50).map(attach);
    const dueSoonItems = active.filter((a) => a.status === "DUE_SOON").sort(byNextDueAsc).slice(0, 50).map(attach);
    return { ...stats, recentTests, overdueItems, dueSoonItems };
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    testTagId: v.string(),
    description: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    make: v.optional(v.string()),
    modelName: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    testIntervalMonths: v.optional(v.number()),
    status: v.optional(enums.TestTagStatus),
    lastTestDate: v.optional(v.number()),
    nextDueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    testProfileId: v.optional(v.string()),
    outletCount: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("testTagAssets", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    testTagId: v.string(),
    description: v.string(),
    equipmentClass: v.optional(enums.EquipmentClass),
    applianceType: v.optional(enums.ApplianceType),
    make: v.optional(v.string()),
    modelName: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    location: v.optional(v.string()),
    testIntervalMonths: v.optional(v.number()),
    status: v.optional(enums.TestTagStatus),
    lastTestDate: v.optional(v.number()),
    nextDueDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    testProfileId: v.optional(v.string()),
    outletCount: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("testTagAssets", args);
    return { _id, created: true };
  },
});

/**
 * Create N test tag assets in ONE array mutation (bulk single-call invariant,
 * Phase 3) — replaces the server firing one `createIfMissing` round-trip per
 * reserved tag id when batch-creating from a bulk asset. `organizationId` is
 * stamped from the ARG onto every row (a caller can't smuggle a per-row org),
 * and each row is inserted only if its id is new (idempotent on retry).
 * Returns how many were created.
 */
export const createManyIfMissing = mutation({
  args: {
    organizationId: v.string(),
    rows: v.array(
      v.object({
        id: v.string(),
        testTagId: v.string(),
        description: v.string(),
        equipmentClass: v.optional(enums.EquipmentClass),
        applianceType: v.optional(enums.ApplianceType),
        make: v.optional(v.string()),
        modelName: v.optional(v.string()),
        serialNumber: v.optional(v.string()),
        location: v.optional(v.string()),
        testIntervalMonths: v.optional(v.number()),
        status: v.optional(enums.TestTagStatus),
        lastTestDate: v.optional(v.number()),
        nextDueDate: v.optional(v.number()),
        notes: v.optional(v.string()),
        assetId: v.optional(v.string()),
        bulkAssetId: v.optional(v.string()),
        testProfileId: v.optional(v.string()),
        outletCount: v.optional(v.number()),
        isActive: v.optional(v.boolean()),
        createdAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { organizationId, rows }) => {
    await requireService(ctx);
    let created = 0;
    for (const r of rows) {
      const existing = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", r.id)).unique();
      if (existing) continue;
      await ctx.db.insert("testTagAssets", { ...r, organizationId });
      created++;
    }
    return { created };
  },
});

/**
 * Retire N test tag assets in ONE array mutation (bulk single-call invariant,
 * Phase 3) — replaces the server firing one `update` round-trip per orphaned /
 * dangling id in the backfill sweep. Each id is fetched via the GLOBAL by_cuid
 * index and re-checked against the arg `organizationId` (skip on missing OR
 * cross-tenant), then patched to RETIRED/inactive. Returns how many were retired.
 */
export const retireMany = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    now: v.number(),
  },
  handler: async (ctx, { organizationId, ids, now }) => {
    await requireService(ctx);
    let retired = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue;
      await ctx.db.patch(doc._id, { status: "RETIRED", isActive: false, updatedAt: now });
      retired++;
    }
    return { retired };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      testTagId: v.optional(v.string()),
      description: v.optional(v.string()),
      equipmentClass: v.optional(enums.EquipmentClass),
      applianceType: v.optional(enums.ApplianceType),
      make: v.optional(v.string()),
      modelName: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      location: v.optional(v.string()),
      testIntervalMonths: v.optional(v.number()),
      status: v.optional(enums.TestTagStatus),
      lastTestDate: v.optional(v.number()),
      nextDueDate: v.optional(v.number()),
      notes: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      testProfileId: v.optional(v.string()),
      outletCount: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagAssets not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("testTagAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("testTagAssets not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
