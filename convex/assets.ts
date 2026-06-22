import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Asset (Convex table "assets"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const getByAssetTag = query({
  args: { organizationId: v.string(), assetTag: v.string() },
  handler: async (ctx, { organizationId, assetTag }) => {
    await requireOrgRead(ctx, organizationId);
    return await ctx.db
      .query("assets")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", organizationId).eq("assetTag", assetTag))
      .unique();
  },
});

export const listByModel = query({
  args: { modelId: v.string(), orgId: v.string() },
  handler: async (ctx, { modelId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("assets")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .collect();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("assets", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    modelId: v.string(),
    assetTag: v.string(),
    serialNumber: v.optional(v.string()),
    customName: v.optional(v.string()),
    status: v.optional(enums.AssetStatus),
    condition: v.optional(enums.AssetCondition),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    purchaseSupplier: v.optional(v.string()),
    supplierId: v.optional(v.string()),
    purchaseOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    warrantyExpiry: v.optional(v.number()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.string()),
    customFieldValues: v.optional(v.any()),
    lastTestAndTagDate: v.optional(v.number()),
    nextTestAndTagDate: v.optional(v.number()),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    kitId: v.optional(v.string()),
    parentAssetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("assets", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      modelId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      customName: v.optional(v.string()),
      status: v.optional(enums.AssetStatus),
      condition: v.optional(enums.AssetCondition),
      purchaseDate: v.optional(v.number()),
      purchasePrice: v.optional(v.number()),
      purchaseSupplier: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      purchaseOrderNumber: v.optional(v.string()),
      supplierOrderId: v.optional(v.string()),
      warrantyExpiry: v.optional(v.number()),
      notes: v.optional(v.string()),
      locationId: v.optional(v.string()),
      customFieldValues: v.optional(v.any()),
      lastTestAndTagDate: v.optional(v.number()),
      nextTestAndTagDate: v.optional(v.number()),
      barcode: v.optional(v.string()),
      qrCode: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      kitId: v.optional(v.string()),
      parentAssetId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
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
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const ASSET_NEVER_CLEAR = new Set(["id", "organizationId", "modelId", "assetTag"]);

// Patchable asset fields (= update.patch minus organizationId). Reused by
// patchAsset + bulkUpdate so the clear-to-null pattern stays consistent.
const assetSet = v.object({
  modelId: v.optional(v.string()),
  assetTag: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  customName: v.optional(v.string()),
  status: v.optional(enums.AssetStatus),
  condition: v.optional(enums.AssetCondition),
  purchaseDate: v.optional(v.number()),
  purchasePrice: v.optional(v.number()),
  purchaseSupplier: v.optional(v.string()),
  supplierId: v.optional(v.string()),
  purchaseOrderNumber: v.optional(v.string()),
  supplierOrderId: v.optional(v.string()),
  warrantyExpiry: v.optional(v.number()),
  notes: v.optional(v.string()),
  locationId: v.optional(v.string()),
  customFieldValues: v.optional(v.any()),
  lastTestAndTagDate: v.optional(v.number()),
  nextTestAndTagDate: v.optional(v.number()),
  barcode: v.optional(v.string()),
  qrCode: v.optional(v.string()),
  images: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
  kitId: v.optional(v.string()),
  parentAssetId: v.optional(v.string()),
});

/**
 * Clear-to-null patch (crewMembers.patchMember pattern): `set` applies values,
 * every name in `clear[]` is removed from the doc. Needed because the generated
 * `update` can't unset an optional field (e.g. clear kitId on kit removal, clear
 * locationId, unlink parentAssetId/supplierId).
 */
export const patchAsset = mutation({
  args: { id: v.string(), set: assetSet, clear: v.array(v.string()) },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("assets not found: " + id);
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set);
      return doc._id;
    }
    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = { ...rest, ...set };
    for (const k of clear) {
      if (ASSET_NEVER_CLEAR.has(k)) continue;
      delete merged[k];
    }
    await ctx.db.replace(doc._id, merged as typeof rest);
    return doc._id;
  },
});

/**
 * Apply the same `set` (+ optional `clear`) to many assets in one transaction —
 * the Convex equivalent of `asset.updateMany` (bulk edit, warehouse force-return
 * → AVAILABLE + location, maintenance hold/release). Cross-org / missing ids are
 * skipped. Returns the count updated.
 */
export const bulkUpdate = mutation({
  args: {
    organizationId: v.string(),
    ids: v.array(v.string()),
    set: assetSet,
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { organizationId, ids, set, clear }) => {
    await requireService(ctx);
    const cl = clear ?? [];
    let n = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc || doc.organizationId !== organizationId) continue;
      if (cl.length === 0) {
        await ctx.db.patch(doc._id, set);
      } else {
        const { _id, _creationTime, ...rest } = doc;
        const merged: Record<string, unknown> = { ...rest, ...set };
        for (const k of cl) {
          if (ASSET_NEVER_CLEAR.has(k)) continue;
          delete merged[k];
        }
        await ctx.db.replace(doc._id, merged as typeof rest);
      }
      n++;
    }
    return n;
  },
});

// ── CUSTOM (Phase C H) — child-asset lookup ──
export const listByParentAssetId = query({
  args: { parentAssetId: v.string(), orgId: v.string() },
  handler: async (ctx, { parentAssetId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return (await ctx.db.query("assets").withIndex("by_parentAssetId", (q) => q.eq("parentAssetId", parentAssetId)).collect())
      .filter((r) => r.organizationId === orgId);
  },
});
