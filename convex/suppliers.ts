import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";

/**
 * Thin CRUD for Supplier (Convex table "suppliers"). GENERATED — Phase 2/5.
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
      .query("suppliers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Asset + order counts per supplier (supplierId → { assets, orders }) for the
 * suppliers table — browser-native replacement for the getSupplierCounts server
 * action. Tallies every org asset and supplier order that has a supplierId,
 * matching countSupplierAssetsAndOrders (no isActive filter). Fetched ONE-SHOT by
 * the table (counts have no liveness need), so this is not a reactive org-wide
 * subscription (Appendix B).
 */
export const counts = query({
  args: { orgId: v.string() },
  returns: v.record(v.string(), v.object({ assets: v.number(), orders: v.number() })),
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const out: Record<string, { assets: number; orders: number }> = {};
    const ensure = (id: string) => (out[id] ??= { assets: 0, orders: 0 });

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const a of assets) if (a.supplierId) ensure(a.supplierId).assets++;

    const orders = await ctx.db
      .query("supplierOrders")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    for (const o of orders) if (o.supplierId) ensure(o.supplierId).orders++;

    return out;
  },
});

// ─── Browser-direct tab reads (Phase 3 — replace getSupplierAssets /
// getSupplierSubhires; getSuppliers/getSuppliersPaginated were dead — reactive hooks). ──

/** A supplier's assets (tag asc), paginated, with the model name attached. */
export const assetsPage = query({
  args: { orgId: v.string(), supplierId: v.string(), page: v.number(), pageSize: v.number() },
  handler: async (ctx, { orgId, supplierId, page, pageSize }) => {
    await requireOrgRead(ctx, orgId);
    const filtered = (await ctx.db.query("assets").withIndex("by_supplierId", (q) => q.eq("supplierId", supplierId)).collect())
      .filter((a) => a.organizationId === orgId && a.isActive !== false)
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag));
    const total = filtered.length;
    const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const models = new Map((await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect()).map((m) => [m.id, m]));
    return { assets: rows.map((a) => ({ ...a, model: a.modelId ? models.get(a.modelId) ?? null : null })), total };
  },
});

/** A supplier's sub-hire line items (createdAt desc), paginated, with project + model. */
export const subhiresPage = query({
  args: { orgId: v.string(), supplierId: v.string(), page: v.number(), pageSize: v.number() },
  handler: async (ctx, { orgId, supplierId, page, pageSize }) => {
    await requireOrgRead(ctx, orgId);
    const matching = (await ctx.db.query("projectLineItems").withIndex("by_supplierId", (q) => q.eq("supplierId", supplierId)).collect())
      .filter((li) => li.organizationId === orgId && li.subHireId != null)
      .sort((a, b) => (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity));
    const total = matching.length;
    const rows = matching.slice((page - 1) * pageSize, page * pageSize);
    const projById = new Map((await ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect()).map((p) => [p.id, p]));
    const models = new Map((await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect()).map((m) => [m.id, m]));
    return {
      lineItems: rows.map((li) => {
        const p = projById.get(li.projectId);
        return { ...li, project: p ? { id: p.id, name: p.name, projectNumber: p.projectNumber ?? null, status: p.status ?? "" } : null, model: li.modelId ? models.get(li.modelId) ?? null : null };
      }),
      total,
    };
  },
});

/**
 * Supplier DETAIL composite for the supplier detail + new-order pages — browser-native
 * replacement for the getSupplierById server action. Returns the mapped supplier (Prisma
 * row shape: null/default coercion + ISO dates, matching mapSupplier + serialize) plus
 * `_count` of its assets / orders / referencing line items. Every count is index-scoped
 * to the supplier and org re-checked (the by_supplierId indexes are global). Throws
 * "Supplier not found" for a missing / cross-org id, matching the server action.
 */
export const detail = query({
  args: { orgId: v.string(), id: v.string() },
  returns: v.object({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    contactName: v.union(v.string(), v.null()),
    email: v.union(v.string(), v.null()),
    phone: v.union(v.string(), v.null()),
    website: v.union(v.string(), v.null()),
    address: v.union(v.string(), v.null()),
    latitude: v.union(v.number(), v.null()),
    longitude: v.union(v.number(), v.null()),
    notes: v.union(v.string(), v.null()),
    accountNumber: v.union(v.string(), v.null()),
    paymentTerms: v.union(v.string(), v.null()),
    defaultLeadTime: v.union(v.string(), v.null()),
    tags: v.array(v.string()),
    isActive: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
    _count: v.object({ assets: v.number(), orders: v.number(), lineItems: v.number() }),
  }),
  handler: async (ctx, { orgId, id }) => {
    await requireOrgRead(ctx, orgId);
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("Supplier not found");

    // Counts — index-scoped to the supplier, org re-checked (by_supplierId is global).
    const assets = (
      await ctx.db.query("assets").withIndex("by_supplierId", (q) => q.eq("supplierId", id)).collect()
    ).filter((a) => a.organizationId === orgId).length;
    const orders = (
      await ctx.db
        .query("supplierOrders")
        .withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", orgId).eq("supplierId", id))
        .collect()
    ).length;
    const lineItems = (
      await ctx.db.query("projectLineItems").withIndex("by_supplierId", (q) => q.eq("supplierId", id)).collect()
    ).filter((li) => li.organizationId === orgId).length;

    return {
      id: doc.id,
      organizationId: doc.organizationId,
      name: doc.name,
      contactName: doc.contactName ?? null,
      email: doc.email ?? null,
      phone: doc.phone ?? null,
      website: doc.website ?? null,
      address: doc.address ?? null,
      latitude: doc.latitude ?? null,
      longitude: doc.longitude ?? null,
      notes: doc.notes ?? null,
      accountNumber: doc.accountNumber ?? null,
      paymentTerms: doc.paymentTerms ?? null,
      defaultLeadTime: doc.defaultLeadTime ?? null,
      tags: doc.tags ?? [],
      isActive: doc.isActive ?? true,
      createdAt: new Date(doc.createdAt ?? 0).toISOString(),
      updatedAt: new Date(doc.updatedAt ?? 0).toISOString(),
      _count: { assets, orders, lineItems },
    };
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    notes: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultLeadTime: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("suppliers", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    notes: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultLeadTime: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("suppliers", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      website: v.optional(v.string()),
      address: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      notes: v.optional(v.string()),
      accountNumber: v.optional(v.string()),
      paymentTerms: v.optional(v.string()),
      defaultLeadTime: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("suppliers not found: " + id);
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
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("suppliers not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
