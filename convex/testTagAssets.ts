import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

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
