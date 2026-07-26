import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for Category (Convex table "categories"). GENERATED — Phase 2/5.
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
      .query("categories")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: categories is a small bounded per-org set — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Per-category model + kit counts (categoryId → { models, kits }) for the category
 * manager — browser-native replacement for the getCategoryCounts server action.
 * Tallies every org model and kit that has a categoryId (parity with
 * buildModelKitCounts, no filter). Fetched ONE-SHOT by the manager (counts have no
 * liveness need), so this is not a reactive org-wide subscription (Appendix B).
 */
export const counts = query({
  args: { orgId: v.string() },
  returns: v.record(v.string(), v.object({ models: v.number(), kits: v.number() })),
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const out: Record<string, { models: number; kits: number }> = {};
    const ensure = (id: string) => (out[id] ??= { models: 0, kits: 0 });

    const models = await ctx.db
      .query("models")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation: per-org tallies need the full set — see docs/exceptions.md R-8.3.3
      .collect();
    for (const m of models) if (m.categoryId) ensure(m.categoryId).models++;

    const kits = await ctx.db
      .query("kits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation: per-org tallies need the full set — see docs/exceptions.md R-8.3.3
      .collect();
    for (const k of kits) if (k.categoryId) ensure(k.categoryId).kits++;

    return out;
  },
});

// ─── Browser-direct composite reads (Phase 3 — replace getCategory +
// searchContainerAssets in src/server/categories.ts). getCategories/getCategoryTree
// were dead (pickers use the reactive useCategories hook). ──────────────────────

/**
 * The category detail composite: parent, children (+ counts), kits (+ member counts),
 * active models (+ asset count + primary photo), and own counts. Rebuilds the deep
 * Prisma include from the org's Convex domain lists (all org-scoped by requireOrgRead).
 */
export const detail = query({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const cats = await ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: categories is a small bounded per-org set (tree) — see docs/exceptions.md R-8.3.3
    const category = cats.find((c) => c.id === id);
    if (!category) throw new ConvexError("Category not found");

    const [models, kits, assets, media] = await Promise.all([
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: category-detail aggregation over the org set — revisit with a category index if large
      ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: category-detail aggregation over the org set — revisit with a category index if large
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: category-detail aggregation over the org set — revisit with a category index if large
      ctx.db.query("modelMedia").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: category-detail aggregation over the org set — revisit with a category index if large
    ]);

    // modelKitCounts[catId] = { models, kits }; childCounts[catId] = # children.
    const mk = new Map<string, { models: number; kits: number }>();
    const ensureMk = (cid: string) => { let e = mk.get(cid); if (!e) { e = { models: 0, kits: 0 }; mk.set(cid, e); } return e; };
    for (const m of models) if (m.categoryId) ensureMk(m.categoryId).models++;
    for (const k of kits) if (k.categoryId) ensureMk(k.categoryId).kits++;
    const childCounts = new Map<string, number>();
    for (const c of cats) if (c.parentId) childCounts.set(c.parentId, (childCounts.get(c.parentId) ?? 0) + 1);

    // Active-asset count per model + primary photo per model.
    const assetCount = new Map<string, number>();
    for (const a of assets) if (a.isActive !== false && a.modelId) assetCount.set(a.modelId, (assetCount.get(a.modelId) ?? 0) + 1);
    const photo = new Map<string, { url: string | null; thumbnailUrl: string | null }>();
    for (const md of media) {
      if (md.type !== "PHOTO" || !md.isPrimary) continue;
      const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", md.fileId)).unique();
      const resolved = file && file.organizationId === orgId ? file : null;
      photo.set(md.modelId, { url: resolved?.url ?? null, thumbnailUrl: resolved?.thumbnailUrl ?? null });
    }

    const parent = category.parentId ? cats.find((c) => c.id === category.parentId) ?? null : null;
    const children = cats
      .filter((c) => c.parentId === id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
      .map((c) => ({ ...c, _count: { models: mk.get(c.id)?.models ?? 0, kits: mk.get(c.id)?.kits ?? 0, children: childCounts.get(c.id) ?? 0 } }));

    const catKits = kits.filter((k) => k.categoryId === id).sort((a, b) => a.name.localeCompare(b.name));
    const kitsOut = [];
    for (const k of catKits) {
      const [ser, bulk] = await Promise.all([
        ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", k.id)).collect(),
        ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", k.id)).collect(),
      ]);
      // by_kitId is a global index — org-filter the member rows (defense-in-depth).
      const serN = ser.filter((r) => r.organizationId === orgId).length;
      const bulkN = bulk.filter((r) => r.organizationId === orgId).length;
      kitsOut.push({ ...k, _count: { serializedItems: serN, bulkItems: bulkN } });
    }

    const modelsOut = models
      .filter((m) => m.categoryId === id && m.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => {
        const p = photo.get(m.id);
        return { ...m, _count: { assets: assetCount.get(m.id) ?? 0 }, media: p ? [{ url: p.url, thumbnailUrl: p.thumbnailUrl }] : [] };
      });

    const ownCounts = mk.get(id) ?? { models: 0, kits: 0 };
    return {
      ...category,
      parent,
      children,
      kits: kitsOut,
      models: modelsOut,
      _count: { models: ownCounts.models, kits: ownCounts.kits, children: childCounts.get(id) ?? 0 },
    };
  },
});

/** Collect a category + all its descendant ids (parentId walk). */
function collectDescendants(cats: { id: string; parentId?: string | null }[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const c of cats) if (c.parentId) { const l = byParent.get(c.parentId) ?? []; l.push(c.id); byParent.set(c.parentId, l); }
  const ids = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const child of byParent.get(cur) ?? []) if (!ids.has(child)) { ids.add(child); stack.push(child); }
  }
  return ids;
}

/**
 * Search assets in the org's configured container category (orgSettings.prepKitCategoryId
 * + descendants). Returns up to 20 picker options. Empty when no container category is set.
 */
export const containerAssetSearch = query({
  args: { orgId: v.string(), query: v.optional(v.string()) },
  handler: async (ctx, { orgId, query: search }) => {
    await requireOrgRead(ctx, orgId);
    const settingsRow = await ctx.db.query("orgSettings").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).first();
    let rootCatId: string | undefined;
    if (settingsRow?.settings) {
      try { rootCatId = (JSON.parse(settingsRow.settings) as { prepKitCategoryId?: string }).prepKitCategoryId; } catch { rootCatId = undefined; }
    }
    if (!rootCatId) return [];

    const cats = await ctx.db.query("categories").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: bounded per-org catalog/config map (enrichment) — see docs/exceptions.md R-8.3.3
    const categoryIds = collectDescendants(cats, rootCatId);
    const models = await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(); // r9.8-ok: bounded per-org catalog/config map (enrichment) — see docs/exceptions.md R-8.3.3
    const modelById = new Map(models.map((m) => [m.id, m]));

    const q = (search ?? "").toLowerCase();
    const assets = await ctx.db.query("assets").withIndex("by_organizationId", (q2) => q2.eq("organizationId", orgId)).collect(); // r9.8-ok: asset picker: scans the org asset set for container candidates — accepted, revisit with a status/category index if large
    const matched = assets
      .filter((a) => {
        const model = a.modelId ? modelById.get(a.modelId) : undefined;
        if (!model?.categoryId || !categoryIds.has(model.categoryId)) return false;
        if (!q) return true;
        const name = model.name?.toLowerCase() ?? "";
        return a.assetTag.toLowerCase().includes(q) || (a.customName ?? "").toLowerCase().includes(q) || name.includes(q);
      })
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag))
      .slice(0, 20);

    return matched.map((a) => {
      const modelName = a.modelId ? modelById.get(a.modelId)?.name : undefined;
      return {
        value: a.customName || a.assetTag,
        label: a.customName ? `${a.customName} (${a.assetTag})` : `${modelName} — ${a.assetTag}`,
        assetId: a.id,
        assetTag: a.assetTag,
        modelId: a.modelId ?? null,
      };
    });
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    parentId: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    suggestedCrewRoles: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("categories", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    parentId: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    suggestedCrewRoles: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("categories", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      parentId: v.optional(v.string()),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      suggestedCrewRoles: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("categories not found: " + id);
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
    const doc = await ctx.db.query("categories").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("categories not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
