import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { bumpAssetCounters } from "./lib/counters";
import { adjustBulkAvailability } from "./lib/inventory";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Kit (Convex table "kits"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("kits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Paginated KIT list — browser-native replacement for KitsPage's useKits/
 * useLocations/useCategories whole-org live subscriptions + client-side
 * filter/sort/paginate (Finding #1, docs/designs/perf-convex-efficiency-2026-06.md).
 * Always excludes archived (isActive: false) and prep (isPrep: true) kits,
 * matching the old getKits where-clause. category/location are resolved
 * server-side; member-item counts + primary photo stay a separate cross-domain
 * merge (kit media/counts still live in Prisma) — unchanged.
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    condition: v.optional(v.string()),
    locationId: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    tagsHasSome: v.optional(v.array(v.string())),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgRead(ctx, a.orgId);
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    const sortBy = a.sortBy ?? "assetTag";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const [rows, categories, locations] = await Promise.all([
      ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
      ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(),
    ]);
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const categoryNameFor = (id: string | null | undefined) => (id ? categoryMap.get(id)?.name : undefined);
    const locationNameFor = (id: string | null | undefined) => (id ? locationMap.get(id)?.name : undefined);

    const filtered = rows.filter((k) => {
      if (k.isActive === false) return false;
      if (k.isPrep === true) return false;
      if (a.status && k.status !== a.status) return false;
      if (a.condition && k.condition !== a.condition) return false;
      if (a.locationId && k.locationId !== a.locationId) return false;
      if (a.categoryId && k.categoryId !== a.categoryId) return false;
      if (a.tagsHasSome && a.tagsHasSome.length > 0 && !(k.tags ?? []).some((t) => a.tagsHasSome!.includes(t))) return false;
      if (a.search && !matchesSearch([k.assetTag, k.name, k.description], a.search)) return false;
      return true;
    });

    const keyFn = (k: typeof rows[number]): unknown => {
      if (sortBy === "category") return categoryNameFor(k.categoryId);
      if (sortBy === "location") return locationNameFor(k.locationId);
      return (k as unknown as Record<string, unknown>)[sortBy];
    };
    const sorted = [...filtered].sort((x, y) => compareValues(keyFn(x), keyFn(y), dir));
    const { items: pageRows, total, totalPages } = paginateItems(sorted, page, pageSize);

    const items = pageRows.map((k) => ({
      ...k,
      category: k.categoryId ? categoryMap.get(k.categoryId) ?? null : null,
      location: k.locationId ? locationMap.get(k.locationId) ?? null : null,
    }));

    return { items, total, page, pageSize, totalPages };
  },
});

/**
 * Per-kit member counts + primary photo (kitId → { serializedItems, bulkItems,
 * media }) for the kits table — browser-native replacement for the getKitCounts
 * server action. Parity: counts kitSerializedItems + kitBulkItems by kitId
 * (countKitMembers); media = the kit's PHOTO+isPrimary kitMedia row's file
 * url/thumbnailUrl (buildPrimaryPhotoMap), org-scoped file resolve. Fetched
 * ONE-SHOT by the table (no liveness need) → not a reactive org-wide subscription
 * (Appendix B).
 */
export const counts = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    type Entry = { serializedItems: number; bulkItems: number; media: { url: string | null; thumbnailUrl: string | null } | null };
    const out: Record<string, Entry> = {};
    const ensure = (id: string) => (out[id] ??= { serializedItems: 0, bulkItems: 0, media: null });

    const serialized = await ctx.db
      .query("kitSerializedItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const s of serialized) if (s.kitId) ensure(s.kitId).serializedItems++;

    const bulk = await ctx.db
      .query("kitBulkItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const b of bulk) if (b.kitId) ensure(b.kitId).bulkItems++;

    // Primary photo per kit (PHOTO + isPrimary), file resolved org-scoped.
    const media = await ctx.db
      .query("kitMedia")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const m of media) {
      if (m.type !== "PHOTO" || !m.isPrimary) continue;
      const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).unique();
      const resolved = file && file.organizationId === orgId ? file : null;
      ensure(m.kitId).media = { url: resolved?.url ?? null, thumbnailUrl: resolved?.thumbnailUrl ?? null };
    }

    return out;
  },
});

/**
 * Kit deletability preview for the delete-kit dialog — browser-native replacement
 * for the `canDeleteKit` server action. Returns whether the kit can be archived /
 * hard-deleted plus the count of referencing project line items. The decision logic
 * is a byte-for-byte port of `computeKitDeletability` (src/lib/kits-read.ts, pinned
 * by kits-read.test.ts); the kit is org-re-checked (by_cuid is global) and the
 * line-item count is org-filtered (by_kitId is global).
 */
export const deletability = query({
  args: { orgId: v.string(), id: v.string() },
  returns: v.object({
    canArchive: v.boolean(),
    canHardDelete: v.boolean(),
    referencingLineItems: v.number(),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, { orgId, id }) => {
    await requireOrgRead(ctx, orgId);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!kit || kit.organizationId !== orgId) throw new ConvexError("Kit not found");

    const referencingLineItems = (
      await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", id)).collect()
    ).filter((r) => r.organizationId === orgId).length;

    const status = kit.status ?? "AVAILABLE";
    const isActive = kit.isActive ?? true;

    // Archive is allowed whenever the kit is AVAILABLE (matches archiveKit guard).
    const canArchive = status === "AVAILABLE" && isActive;
    // Hard delete adds: no ProjectLineItem references, AVAILABLE status.
    const canHardDelete = status === "AVAILABLE" && isActive && referencingLineItems === 0;

    let reason: string | undefined;
    if (!canArchive) {
      reason =
        status !== "AVAILABLE"
          ? `Kit status is ${status} — only AVAILABLE kits can be archived or deleted.`
          : "Kit is already archived.";
    } else if (!canHardDelete) {
      reason = `Kit is referenced by ${referencingLineItems} project line item${referencingLineItems === 1 ? "" : "s"}. Archive it instead, or remove it from those projects first.`;
    }

    return { canArchive, canHardDelete, referencingLineItems, reason };
  },
});

/**
 * Batch point-read kits by cuid, scoped to one org — lets a composite read only
 * the kits its line items reference (e.g. buildProjectEquipmentTree) instead of
 * getKitsByOrg (every kit in the org). Cross-org ids are dropped.
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("kits.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId);
  },
});

/**
 * Serialized assets eligible to add to a kit — browser-native replacement for the
 * getAvailableAssetsForKit server action. Active + AVAILABLE + not already in a kit
 * (+ optional model filter), assetTag ASC, model attached. One-shot picker read.
 */
export const availableAssets = query({
  args: { orgId: v.string(), modelId: v.optional(v.string()) },
  handler: async (ctx, { orgId, modelId }) => {
    await requireOrgRead(ctx, orgId);
    const [assets, models] = await Promise.all([
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ]);
    const modelMap = new Map(models.map((m) => [m.id, m]));
    return assets
      .filter((a) => a.isActive !== false && (a.status ?? "AVAILABLE") === "AVAILABLE" && (a.kitId ?? null) === null && (!modelId || a.modelId === modelId))
      .sort((a, b) => (a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0))
      .map((a) => ({ ...a, model: a.modelId ? modelMap.get(a.modelId) ?? null : null }));
  },
});

/**
 * Bulk assets with available quantity — browser-native replacement for
 * getAvailableBulkAssetsForKit. Active + ACTIVE + availableQuantity > 0, assetTag
 * ASC, model attached. One-shot picker read.
 */
export const availableBulkAssets = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const [bulk, models] = await Promise.all([
      ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ]);
    const modelMap = new Map(models.map((m) => [m.id, m]));
    return bulk
      .filter((b) => b.isActive !== false && (b.status ?? "ACTIVE") === "ACTIVE" && (b.availableQuantity ?? 0) > 0)
      .sort((a, b) => (a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0))
      .map((b) => ({ ...b, model: b.modelId ? modelMap.get(b.modelId) ?? null : null }));
  },
});

export const getByAssetTag = query({
  args: { organizationId: v.string(), assetTag: v.string() },
  handler: async (ctx, { organizationId, assetTag }) => {
    await requireOrgRead(ctx, organizationId);
    return await ctx.db
      .query("kits")
      .withIndex("by_organizationId_assetTag", (q) => q.eq("organizationId", organizationId).eq("assetTag", assetTag))
      .unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetTag: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(enums.KitStatus),
    condition: v.optional(enums.AssetCondition),
    locationId: v.optional(v.string()),
    weight: v.optional(v.number()),
    caseType: v.optional(v.string()),
    caseDimensions: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    customFieldValues: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    checkMode: v.optional(enums.KitCheckMode),
    isPrep: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("kits", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    assetTag: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    status: v.optional(enums.KitStatus),
    condition: v.optional(enums.AssetCondition),
    locationId: v.optional(v.string()),
    weight: v.optional(v.number()),
    caseType: v.optional(v.string()),
    caseDimensions: v.optional(v.string()),
    image: v.optional(v.string()),
    images: v.optional(v.array(v.string())),
    barcode: v.optional(v.string()),
    qrCode: v.optional(v.string()),
    notes: v.optional(v.string()),
    purchaseDate: v.optional(v.number()),
    purchasePrice: v.optional(v.number()),
    customFieldValues: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
    checkMode: v.optional(enums.KitCheckMode),
    isPrep: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("kits", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      assetTag: v.optional(v.string()),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      categoryId: v.optional(v.string()),
      status: v.optional(enums.KitStatus),
      condition: v.optional(enums.AssetCondition),
      locationId: v.optional(v.string()),
      weight: v.optional(v.number()),
      caseType: v.optional(v.string()),
      caseDimensions: v.optional(v.string()),
      image: v.optional(v.string()),
      images: v.optional(v.array(v.string())),
      barcode: v.optional(v.string()),
      qrCode: v.optional(v.string()),
      notes: v.optional(v.string()),
      purchaseDate: v.optional(v.number()),
      purchasePrice: v.optional(v.number()),
      customFieldValues: v.optional(v.any()),
      tags: v.optional(v.array(v.string())),
      checkMode: v.optional(enums.KitCheckMode),
      isPrep: v.optional(v.boolean()),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kits not found: " + id);
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
    const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("kits not found: " + id);
    // Revenue allocation has no FK to cascade through (Convex-only table). Without
    // this, a recreated kit reusing the id would inherit the old kit's split.
    const allocations = await ctx.db
      .query("kitRevenueAllocations")
      .withIndex("by_kitId", (q) => q.eq("kitId", id))
      .collect();
    for (const a of allocations) await ctx.db.delete(a._id);
    await ctx.db.delete(doc._id);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// Kit composition: each Prisma $transaction (member write + asset/bulk status)
// becomes one atomic Convex mutation. The asset-availability guards (asset must
// be AVAILABLE / unkitted) live INSIDE the mutation so two kits can't grab the
// same asset (the check + write are serializable; OCC retries the loser).
// ─────────────────────────────────────────────────────────────────────────────

export async function getKitGuarded(ctx: MutationCtx, kitId: string, organizationId: string) {
  const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).unique();
  if (!kit || kit.organizationId !== organizationId) throw new ConvexError("Kit not found");
  if (kit.status !== "AVAILABLE") throw new ConvexError("Items can only be added to/removed from AVAILABLE kits");
  return kit;
}

/** Set kitId + the kit's location on an asset (clearing location if the kit has none). */
export async function assignAssetToKit(
  ctx: MutationCtx,
  asset: NonNullable<Awaited<ReturnType<typeof getAssetDoc>>>,
  kitId: string,
  kitLocationId: string | undefined,
  now: number,
) {
  if (kitLocationId != null) {
    await ctx.db.patch(asset._id, { kitId, locationId: kitLocationId, updatedAt: now });
  } else {
    const { _id, _creationTime, locationId: _l, ...rest } = asset;
    await ctx.db.replace(_id, { ...rest, kitId, updatedAt: now });
  }
}

/** Release an asset back to inventory (kitId cleared, status AVAILABLE). */
export async function releaseAsset(ctx: MutationCtx, assetId: string, now: number) {
  const asset = await getAssetDoc(ctx, assetId);
  if (!asset) return;
  const { _id, _creationTime, kitId: _k, ...rest } = asset;
  await ctx.db.replace(_id, { ...rest, status: "AVAILABLE", updatedAt: now });
  // §3.6 dashboard counter: releasing a checked-out kit asset back to AVAILABLE.
  await bumpAssetCounters(ctx, asset.organizationId, asset, { isActive: asset.isActive, status: "AVAILABLE" });
}

export async function getAssetDoc(ctx: MutationCtx, id: string) {
  return await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
}

export const addSerializedItem = mutation({
  args: {
    organizationId: v.string(),
    kitId: v.string(),
    assetId: v.string(),
    position: v.optional(v.string()),
    notes: v.optional(v.string()),
    addedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await getKitGuarded(ctx, a.kitId, a.organizationId);
    const asset = await getAssetDoc(ctx, a.assetId);
    if (!asset || asset.organizationId !== a.organizationId) throw new ConvexError("Asset not found");
    if (asset.status !== "AVAILABLE") throw new ConvexError("Asset is not AVAILABLE");
    if (asset.kitId) throw new ConvexError("Asset is already assigned to another kit");
    if (asset.parentAssetId) throw new ConvexError("Asset is an accessory of another asset — detach it first");
    const id = createId();
    await ctx.db.insert("kitSerializedItems", {
      id, organizationId: a.organizationId, kitId: a.kitId, assetId: a.assetId,
      position: a.position, notes: a.notes, addedById: a.addedById, addedAt: a.now,
    });
    await assignAssetToKit(ctx, asset, a.kitId, kit.locationId, a.now);
    return { id };
  },
});

export const addSerializedItems = mutation({
  args: {
    organizationId: v.string(),
    kitId: v.string(),
    items: v.array(v.object({ assetId: v.string(), position: v.optional(v.string()) })),
    addedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await getKitGuarded(ctx, a.kitId, a.organizationId);
    const created: string[] = [];
    for (const it of a.items) {
      const asset = await getAssetDoc(ctx, it.assetId);
      if (!asset || asset.organizationId !== a.organizationId) throw new ConvexError("Asset not found");
      if (asset.status !== "AVAILABLE") throw new ConvexError(`Asset ${asset.assetTag} is not AVAILABLE`);
      if (asset.kitId) throw new ConvexError(`Asset ${asset.assetTag} is already in another kit`);
      if (asset.parentAssetId) throw new ConvexError(`Asset ${asset.assetTag} is an accessory — detach it first`);
      const id = createId();
      await ctx.db.insert("kitSerializedItems", {
        id, organizationId: a.organizationId, kitId: a.kitId, assetId: it.assetId,
        position: it.position, addedById: a.addedById, addedAt: a.now,
      });
      await assignAssetToKit(ctx, asset, a.kitId, kit.locationId, a.now);
      created.push(id);
    }
    return { ids: created };
  },
});

export const removeSerializedItem = mutation({
  args: { organizationId: v.string(), kitId: v.string(), assetId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await getKitGuarded(ctx, a.kitId, a.organizationId);
    const member = await ctx.db
      .query("kitSerializedItems")
      .withIndex("by_organizationId_assetId", (q) => q.eq("organizationId", a.organizationId).eq("assetId", a.assetId))
      .unique();
    if (!member) throw new ConvexError("Kit item not found");
    await ctx.db.delete(member._id);
    await releaseAsset(ctx, a.assetId, a.now);
    return { id: member.id };
  },
});

export const addBulkItem = mutation({
  args: {
    organizationId: v.string(),
    kitId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    position: v.optional(v.string()),
    notes: v.optional(v.string()),
    addedById: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await getKitGuarded(ctx, a.kitId, a.organizationId);
    const id = createId();
    await ctx.db.insert("kitBulkItems", {
      id, organizationId: a.organizationId, kitId: a.kitId, bulkAssetId: a.bulkAssetId,
      quantity: a.quantity, position: a.position, notes: a.notes, addedById: a.addedById, addedAt: a.now,
    });
    // Guarded decrement (throws + rolls back if insufficient).
    await adjustBulkAvailability(ctx, a.organizationId, [{ bulkAssetId: a.bulkAssetId, delta: -a.quantity }]);
    return { id };
  },
});

export const removeBulkItem = mutation({
  args: { organizationId: v.string(), kitId: v.string(), bulkItemId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    await getKitGuarded(ctx, a.kitId, a.organizationId);
    const member = await ctx.db.query("kitBulkItems").withIndex("by_cuid", (q) => q.eq("id", a.bulkItemId)).unique();
    if (!member || member.organizationId !== a.organizationId) throw new ConvexError("Bulk item not found");
    if (member.kitId !== a.kitId) throw new ConvexError("Bulk item does not belong to this kit");
    await ctx.db.delete(member._id);
    await adjustBulkAvailability(ctx, a.organizationId, [{ bulkAssetId: member.bulkAssetId, delta: member.quantity }]);
    return { bulkAssetId: member.bulkAssetId };
  },
});

/** Release all members + (archive: soft-delete / delete: hard-delete) the kit, atomically. */
export async function releaseKitMembers(ctx: MutationCtx, kitId: string, organizationId: string, now: number) {
  // by_kitId is GLOBAL — org-filter the member rows (defense-in-depth; a kitId maps
  // to one org, but never release/delete a foreign-org row).
  const serialized = (await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect())
    .filter((m) => m.organizationId === organizationId);
  for (const m of serialized) {
    await releaseAsset(ctx, m.assetId, now);
    await ctx.db.delete(m._id);
  }
  const bulk = (await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect())
    .filter((m) => m.organizationId === organizationId);
  for (const m of bulk) {
    await adjustBulkAvailability(ctx, organizationId, [{ bulkAssetId: m.bulkAssetId, delta: m.quantity }]);
    await ctx.db.delete(m._id);
  }
}

export const archiveCascade = mutation({
  args: { organizationId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", a.kitId)).unique();
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    if (kit.status !== "AVAILABLE") throw new ConvexError("Only AVAILABLE kits can be archived");
    await releaseKitMembers(ctx, a.kitId, a.organizationId, a.now);
    await ctx.db.patch(kit._id, { isActive: false, status: "RETIRED", updatedAt: a.now });
    return { id: a.kitId };
  },
});

export const deleteCascade = mutation({
  args: { organizationId: v.string(), kitId: v.string(), now: v.number() },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", a.kitId)).unique();
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    if (kit.status !== "AVAILABLE") throw new ConvexError("Only AVAILABLE kits can be deleted");
    await releaseKitMembers(ctx, a.kitId, a.organizationId, a.now);
    await ctx.db.delete(kit._id);
    return { id: a.kitId };
  },
});
