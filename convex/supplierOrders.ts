import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Thin CRUD for SupplierOrder (Convex table "supplierOrders"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "supplier");
    return doc;
  },
});

/**
 * A supplier's orders for the supplier detail table (Phase 3 browser-direct — replaces
 * the getSupplierOrders server action's supplier-scoped read). Newest first, with the
 * project reference + item count each row renders. Scoped to (org, supplier) via the
 * composite index (org-checked implicitly); the project join is org-re-checked.
 */
export const listBySupplier = query({
  args: { orgId: v.string(), supplierId: v.string() },
  handler: async (ctx, { orgId, supplierId }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    const orders = await ctx.db
      .query("supplierOrders")
      .withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", orgId).eq("supplierId", supplierId))
      .collect();
    orders.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)); // createdAt desc (default sort)

    const out = [];
    for (const o of orders) {
      const items = await ctx.db.query("supplierOrderItems").withIndex("by_orderId", (q) => q.eq("orderId", o.id)).collect();
      let project: { id: string; name: string; projectNumber: string } | null = null;
      if (o.projectId) {
        const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", o.projectId as string)).first();
        project = p && p.organizationId === orgId ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null;
      }
      out.push({
        id: o.id,
        orderNumber: o.orderNumber,
        type: o.type,
        status: o.status ?? "DRAFT",
        orderDate: o.orderDate ?? null,
        total: o.total ?? null,
        project,
        _count: { items: items.length },
      });
    }
    return { orders: out, total: out.length };
  },
});

/**
 * Order DETAIL composite for the order detail page (issue #789) — browser-native,
 * everything the page needs in one round trip: the order header, its supplier
 * (name only), every linked line item (supplierOrderItems, with model/asset names
 * resolved), every asset bought against this order (assets.by_supplierOrderId —
 * distinct from line items: an asset can be linked to the order directly via
 * asset-form's combobox without ever being a line item), and the attached invoice
 * file (if any). All child reads are index-scoped + org re-checked (by_cuid /
 * by_orderId / by_supplierOrderId are GLOBAL indexes).
 *
 * Returns `null` (rather than throwing) for a missing OR cross-org order — the
 * page consumes this via the reactive `useAuthedQuery`/`useQuery`, and a thrown
 * ConvexError from a live subscription is an UNCAUGHT error that crashes the page
 * (see the crash-class documented in src/hooks/use-authed-query.ts). Mirrors the
 * `getById` + `requireOrgReadDoc` null-safe convention used by every other
 * reactively-consumed detail query, not `suppliers.detail`'s throw-on-missing
 * shape (that one is only ever read one-shot via `convex.query()`).
 */
export const getDetail = query({
  args: { orgId: v.string(), id: v.string() },
  handler: async (ctx, { orgId, id }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!order || order.organizationId !== orgId) return null;

    const supplier = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", order.supplierId)).first();

    let project: { id: string; name: string; projectNumber: string } | null = null;
    if (order.projectId) {
      const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", order.projectId as string)).first();
      project = p && p.organizationId === orgId ? { id: p.id, name: p.name, projectNumber: p.projectNumber } : null;
    }

    const items = await ctx.db.query("supplierOrderItems").withIndex("by_orderId", (q) => q.eq("orderId", order.id)).collect();
    const itemsOut = [];
    for (const it of items) {
      const model = it.modelId ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", it.modelId as string)).first() : null;
      const asset = it.assetId ? await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", it.assetId as string)).first() : null;
      itemsOut.push({
        id: it.id,
        description: it.description,
        quantity: it.quantity ?? null,
        unitPrice: it.unitPrice ?? null,
        lineTotal: it.lineTotal ?? null,
        notes: it.notes ?? null,
        sortOrder: it.sortOrder ?? null,
        model: model && model.organizationId === orgId ? { id: model.id, name: model.name } : null,
        asset: asset && asset.organizationId === orgId ? { id: asset.id, assetTag: asset.assetTag } : null,
      });
    }
    itemsOut.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // Assets linked directly to this order (via the asset-form combobox) — may
    // overlap with items[].asset, but isn't required to (an order can hold assets
    // with no corresponding line item, and vice versa).
    const linkedAssets = (
      await ctx.db.query("assets").withIndex("by_supplierOrderId", (q) => q.eq("supplierOrderId", order.id)).collect()
    ).filter((a) => a.organizationId === orgId);
    const modelIds = [...new Set(linkedAssets.map((a) => a.modelId))];
    const models = new Map(
      (await Promise.all(modelIds.map((mid) => ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", mid)).first())))
        .filter((m): m is NonNullable<typeof m> => m != null)
        .map((m) => [m.id, m]),
    );
    const assetsOut = linkedAssets
      .map((a) => ({
        id: a.id,
        assetTag: a.assetTag,
        status: a.status ?? null,
        model: models.get(a.modelId) ? { id: a.modelId, name: models.get(a.modelId)!.name } : null,
      }))
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag));

    let invoice: { id: string; fileName: string; fileSize: number; mimeType: string; url: string } | null = null;
    if (order.invoiceFileId) {
      const file = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", order.invoiceFileId as string)).first();
      if (file && file.organizationId === orgId) {
        invoice = { id: file.id, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType, url: file.url };
      }
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      type: order.type,
      status: order.status ?? "DRAFT",
      orderDate: order.orderDate ?? null,
      expectedDate: order.expectedDate ?? null,
      receivedDate: order.receivedDate ?? null,
      subtotal: order.subtotal ?? null,
      taxAmount: order.taxAmount ?? null,
      total: order.total ?? null,
      notes: order.notes ?? null,
      createdAt: order.createdAt ?? null,
      updatedAt: order.updatedAt ?? null,
      supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      project,
      items: itemsOut,
      assets: assetsOut,
      invoice,
    };
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    orderNumber: v.string(),
    type: enums.SupplierOrderType,
    status: v.optional(enums.SupplierOrderStatus),
    orderDate: v.optional(v.number()),
    expectedDate: v.optional(v.number()),
    receivedDate: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    projectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    invoiceFileId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("supplierOrders", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    supplierId: v.string(),
    orderNumber: v.string(),
    type: enums.SupplierOrderType,
    status: v.optional(enums.SupplierOrderStatus),
    orderDate: v.optional(v.number()),
    expectedDate: v.optional(v.number()),
    receivedDate: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    projectId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdById: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    invoiceFileId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("supplierOrders", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      supplierId: v.optional(v.string()),
      orderNumber: v.optional(v.string()),
      type: v.optional(enums.SupplierOrderType),
      status: v.optional(enums.SupplierOrderStatus),
      orderDate: v.optional(v.number()),
      expectedDate: v.optional(v.number()),
      receivedDate: v.optional(v.number()),
      subtotal: v.optional(v.number()),
      taxAmount: v.optional(v.number()),
      total: v.optional(v.number()),
      projectId: v.optional(v.string()),
      notes: v.optional(v.string()),
      createdById: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      invoiceFileId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierOrders not found: " + id);
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
    const doc = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("supplierOrders not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

export const agentOps: AgentOpsAnnotations = {
  getById: { summary: "Get a supplier order by id.", danger: "low", mcpTier: 2 },
  listBySupplier: { summary: "List a supplier's orders with item counts.", danger: "low", mcpTier: 1 },
  getDetail: { summary: "Supplier order detail: header, items, linked assets, invoice pointer.", danger: "low", mcpTier: 1 },
};
