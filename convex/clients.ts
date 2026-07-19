import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Client (Convex table "clients"). GENERATED — Phase 2/5.
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
      .query("clients")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Paginated CLIENT list — browser-native replacement for ClientTable's
 * useClients whole-org live subscription + client-side filter/sort/paginate
 * (Finding #1, docs/designs/perf-convex-efficiency-2026-06.md). Always
 * excludes archived (isActive: false) clients, matching the old behavior.
 * Project counts are cross-domain (projects still in Prisma) so they stay a
 * separate merge the caller applies after this query — unchanged.
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    type: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgRead(ctx, a.orgId);
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    const sortBy = a.sortBy ?? "name";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const rows = await ctx.db.query("clients").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(); // r9.8-ok: bounded per-org config/catalog set

    const filtered = rows.filter((c) => {
      if ((c.isActive ?? true) !== true) return false;
      if (a.type && c.type !== a.type) return false;
      if (a.search && !matchesSearch([c.name, c.contactName, c.contactEmail], a.search)) return false;
      return true;
    });

    const sorted = [...filtered].sort((x, y) =>
      compareValues((x as unknown as Record<string, unknown>)[sortBy], (y as unknown as Record<string, unknown>)[sortBy], dir),
    );
    const { items, total, totalPages } = paginateItems(sorted, page, pageSize);

    return { items, total, page, pageSize, totalPages };
  },
});

/**
 * Project-count-per-client map (clientId → count) for the clients table's
 * "Projects" column — the browser-native replacement for the getClientProjectCounts
 * server action. Tallies every org project that has a clientId (parity with the
 * action, which counted the whole projects.list including templates). Fetched
 * ONE-SHOT by the client (counts have no liveness need), so this is not a reactive
 * org-wide subscription (Appendix B).
 */
export const projectCounts = query({
  args: { orgId: v.string() },
  returns: v.record(v.string(), v.number()),
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — per-org tallies need the full set
      .collect();
    const counts: Record<string, number> = {};
    for (const p of projects) {
      if (p.clientId) counts[p.clientId] = (counts[p.clientId] ?? 0) + 1;
    }
    return counts;
  },
});

/**
 * Client DETAIL composite for the client detail page — browser-native replacement
 * for the getClient server action. Returns the client doc plus its recent projects
 * (each with a total line-item count) and its media gallery (files resolved). All
 * reads are CLIENT-scoped (by_clientId / by_projectId) with a per-row org re-check
 * on the global-index fetches — bounded, not org-wide, so this is safe as a reactive
 * subscription (Appendix B). Returns null if the client is missing / in another org.
 */
export const detail = query({
  args: { orgId: v.string(), id: v.string() },
  handler: async (ctx, { orgId, id }) => {
    await requireOrgRead(ctx, orgId);

    const client = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!client || client.organizationId !== orgId) return null;

    // Recent projects for this client — newest first, capped at 20 (parity with the
    // action). by_clientId is a GLOBAL index → re-check organizationId per row.
    const clientProjects = (
      await ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", id)).collect()
    )
      .filter((p) => p.organizationId === orgId)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 20);

    // Per-project TOTAL line-item count (all rows, matching countAllLineItemsByProject).
    // by_projectId is a GLOBAL index → re-check organizationId per row (parity with
    // the deleted listByProjectIds, which org-filters; defense-in-depth even though
    // projectId is a unique cuid).
    const projects = await Promise.all(
      clientProjects.map(async (p) => {
        const lineItems = await ctx.db
          .query("projectLineItems")
          .withIndex("by_projectId", (q) => q.eq("projectId", p.id))
          .collect();
        const lineItemCount = lineItems.filter((li) => li.organizationId === orgId).length;
        return { ...p, _count: { lineItems: lineItemCount } };
      }),
    );

    // Media gallery — clientMedia by_clientId (org re-check), sorted by sortOrder,
    // with the nested `file` point-read and resolved (drop rows whose file is
    // missing / cross-org — matches withResolvedFile on the required FK).
    const mediaRows = (
      await ctx.db.query("clientMedia").withIndex("by_clientId", (q) => q.eq("clientId", id)).collect()
    )
      .filter((m) => m.organizationId === orgId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const media = [];
    for (const m of mediaRows) {
      const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", m.fileId)).unique();
      if (!file || file.organizationId !== orgId) continue;
      media.push({
        id: m.id,
        fileId: m.fileId,
        type: m.type ?? "OTHER",
        displayName: m.displayName ?? null,
        sortOrder: m.sortOrder ?? 0,
        file: {
          id: file.id,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          url: file.url,
          thumbnailUrl: file.thumbnailUrl ?? null,
        },
      });
    }

    return { ...client, projects, media };
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.optional(enums.ClientType),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    billingLatitude: v.optional(v.number()),
    billingLongitude: v.optional(v.number()),
    shippingAddress: v.optional(v.string()),
    shippingLatitude: v.optional(v.number()),
    shippingLongitude: v.optional(v.number()),
    taxId: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultDiscount: v.optional(v.number()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("clients", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.optional(enums.ClientType),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    billingLatitude: v.optional(v.number()),
    billingLongitude: v.optional(v.number()),
    shippingAddress: v.optional(v.string()),
    shippingLatitude: v.optional(v.number()),
    shippingLongitude: v.optional(v.number()),
    taxId: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultDiscount: v.optional(v.number()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("clients", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      name: v.optional(v.string()),
      type: v.optional(enums.ClientType),
      contactName: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      billingAddress: v.optional(v.string()),
      billingLatitude: v.optional(v.number()),
      billingLongitude: v.optional(v.number()),
      shippingAddress: v.optional(v.string()),
      shippingLatitude: v.optional(v.number()),
      shippingLongitude: v.optional(v.number()),
      taxId: v.optional(v.string()),
      paymentTerms: v.optional(v.string()),
      defaultDiscount: v.optional(v.number()),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("clients not found: " + id);
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
    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("clients not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
