import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Location (Convex table "locations"). GENERATED — Phase 2/5.
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
      .query("locations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

// ─── Browser-direct reads (Phase 3 — replace getLocations + getLocation) ────────

/** Minimal location list (id/name/type) for pickers/selectors. name asc. */
export const listSimple = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
    return locs
      .map((l) => ({ id: l.id, name: l.name, type: l.type ?? "WAREHOUSE" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/**
 * The location detail composite: parent, children (+ asset/bulk counts), the location's
 * assets/bulkAssets/kits (active, tag-asc, 50) with model names, projects (createdAt desc,
 * 20) with client names, media gallery (file-resolved), and relation counts. Rebuilt from
 * the org Convex lists; every join org-scoped. Dates → ISO strings (matches the deleted
 * action's serialized shape).
 */
export const detail = query({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const locs = await ctx.db.query("locations").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect();
    const self = locs.find((l) => l.id === id);
    if (!self) return null; // parity with the deleted getLocation (graceful not-found UI)

    const [assets, bulk, kits, projects, models] = await Promise.all([
      ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("kits").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
      ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ]);
    const modelName = new Map(models.map((m) => [m.id, m.name]));

    const assetsHere = assets.filter((a) => a.locationId === id);
    const bulkHere = bulk.filter((b) => b.locationId === id);
    const kitsHere = kits.filter((k) => k.locationId === id);
    const projectsHere = projects.filter((p) => p.locationId === id);
    const childrenAll = locs.filter((l) => l.parentId === id);

    const _count = { assets: assetsHere.length, bulkAssets: bulkHere.length, kits: kitsHere.length, children: childrenAll.length, projects: projectsHere.length };

    const parentRow = self.parentId ? locs.find((l) => l.id === self.parentId) : undefined;
    const parent = parentRow ? { id: parentRow.id, name: parentRow.name, address: parentRow.address ?? null, latitude: parentRow.latitude ?? null, longitude: parentRow.longitude ?? null } : null;

    const children = [...childrenAll].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({
      id: c.id, name: c.name,
      _count: { assets: assets.filter((a) => a.locationId === c.id).length, bulkAssets: bulk.filter((b) => b.locationId === c.id).length },
    }));

    const byTag = (a: { assetTag: string }, b: { assetTag: string }) => (a.assetTag < b.assetTag ? -1 : a.assetTag > b.assetTag ? 1 : 0);
    const assetsOut = assetsHere.filter((a) => a.isActive !== false).sort(byTag).slice(0, 50)
      .map((a) => ({ id: a.id, assetTag: a.assetTag, status: a.status ?? "AVAILABLE", model: a.modelId ? { name: modelName.get(a.modelId) ?? "" } : null }));
    const bulkOut = bulkHere.filter((b) => b.isActive !== false).sort(byTag).slice(0, 50)
      .map((b) => ({ id: b.id, assetTag: b.assetTag, status: b.status ?? "ACTIVE", model: b.modelId ? { name: modelName.get(b.modelId) ?? "" } : null }));
    const kitsOut = kitsHere.filter((k) => k.isActive !== false).sort(byTag).slice(0, 50)
      .map((k) => ({ id: k.id, assetTag: k.assetTag, name: k.name, status: k.status ?? "AVAILABLE" }));

    const projectsOut = [];
    for (const p of [...projectsHere].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 20)) {
      let client: { name: string } | null = null;
      if (p.clientId) {
        const c = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", p.clientId as string)).first();
        client = c && c.organizationId === orgId ? { name: c.name } : { name: "" };
      }
      projectsOut.push({ id: p.id, projectNumber: p.projectNumber, name: p.name, status: p.status ?? "DRAFT", client, createdAt: new Date(p.createdAt ?? 0).toISOString() });
    }

    // Media gallery (locationMedia by_locationId, sortOrder asc, file resolved org-scoped).
    const mediaRows = (await ctx.db.query("locationMedia").withIndex("by_locationId", (q) => q.eq("locationId", id)).collect())
      .filter((m) => m.organizationId === orgId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const media = [];
    for (const m of mediaRows) {
      const f = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).first();
      const file = f && f.organizationId === orgId ? { id: f.id, url: f.url, thumbnailUrl: f.thumbnailUrl ?? null, fileName: f.fileName, fileSize: f.fileSize, mimeType: f.mimeType } : null;
      media.push({ id: m.id, organizationId: m.organizationId, fileId: m.fileId, type: m.type ?? "DOCUMENT", displayName: m.displayName ?? null, sortOrder: m.sortOrder ?? 0, createdAt: new Date(m.createdAt ?? 0).toISOString(), file });
    }

    return {
      id: self.id, organizationId: self.organizationId, name: self.name,
      address: self.address ?? null, latitude: self.latitude ?? null, longitude: self.longitude ?? null,
      type: self.type ?? "WAREHOUSE", isDefault: self.isDefault ?? false, parentId: self.parentId ?? null,
      notes: self.notes ?? null, tags: self.tags ?? [],
      createdAt: new Date(self.createdAt ?? 0).toISOString(), updatedAt: new Date(self.updatedAt ?? 0).toISOString(),
      parent, children, assets: assetsOut, bulkAssets: bulkOut, kits: kitsOut, projects: projectsOut, media, _count,
    };
  },
});

/**
 * Asset + bulk-asset + kit counts per location (locationId → { assets, bulkAssets,
 * kits }) for the locations table — browser-native replacement for the
 * getLocationCounts server action. Tallies every org asset/bulkAsset/kit that has a
 * locationId (parity with the action, no filter). Fetched ONE-SHOT by the table
 * (counts have no liveness need) → not a reactive org-wide subscription (Appendix B).
 */
export const counts = query({
  args: { orgId: v.string() },
  returns: v.record(
    v.string(),
    v.object({ assets: v.number(), bulkAssets: v.number(), kits: v.number() }),
  ),
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const out: Record<string, { assets: number; bulkAssets: number; kits: number }> = {};
    const ensure = (id: string) => (out[id] ??= { assets: 0, bulkAssets: 0, kits: 0 });

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const a of assets) if (a.locationId) ensure(a.locationId).assets++;

    const bulkAssets = await ctx.db
      .query("bulkAssets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const b of bulkAssets) if (b.locationId) ensure(b.locationId).bulkAssets++;

    const kits = await ctx.db
      .query("kits")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const k of kits) if (k.locationId) ensure(k.locationId).kits++;

    return out;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    type: v.optional(enums.LocationType),
    isDefault: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("locations", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    type: v.optional(enums.LocationType),
    isDefault: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("locations", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      address: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      type: v.optional(enums.LocationType),
      isDefault: v.optional(v.boolean()),
      parentId: v.optional(v.string()),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("locations not found: " + id);
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
    const doc = await ctx.db.query("locations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("locations not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
