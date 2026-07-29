import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgReadFor, requireOrgReadDocFor, requireService } from "./lib/auth";
import { matchesSearch, compareValues, paginateItems } from "./lib/listQuery";
import type { AgentOpsAnnotations } from "./lib/agentOps";

const round = (n: number): number => Math.round(n * 100) / 100;

// Order statuses counted as "committed" spend (WS7 #946) — DRAFT is a quote, not
// yet committed; CANCELLED never happened. Mirrors the sub-hire domain's
// non-DRAFT/CANCELLED convention for "active" cost (recalc.ts's subHireCostTotal).
const COMMITTED_ORDER_STATUSES = new Set(["ORDERED", "PARTIAL", "RECEIVED"]);
const OPEN_ORDER_STATUSES = new Set(["DRAFT", "ORDERED", "PARTIAL"]);
const ACTIVE_SUBHIRE_STATUSES_EXCLUDED = new Set(["DRAFT", "CANCELLED"]);

/**
 * WS7 #946 — supplier spend rollup, DE-DUPLICATED for linked sub-hire+order pairs.
 * Committed order spend (order.total for ORDERED/PARTIAL/RECEIVED) and sub-hire
 * spend (subHire.totalCost for non-DRAFT/CANCELLED heads) would double-count any
 * pair linked via `subHires.supplierOrderId` if simply summed independently — the
 * supplier fulfilled ONE transaction, not two. A linked pair counts ONCE: at the
 * order's `total` once RECEIVED (the invoiced amount is now known), else at the
 * sub-hire's quoted `totalCost` (the order isn't invoiced yet). Exported (plain
 * function, no ctx) so the de-dup logic itself is unit-testable without a Convex
 * harness — see suppliers.test.ts's dedup fixture.
 */
type SupplierOrderRow = Pick<Doc<"supplierOrders">, "id" | "status" | "total">;
type SubHireRow = Pick<Doc<"subHires">, "id" | "status" | "totalCost" | "supplierOrderId">;

/** A single sub-hire's contribution to the de-duplicated total: the linked order's id
 *  is recorded in `pairedOrderIds` (so the order loop below skips it) when the link is
 *  to a committed order; otherwise the sub-hire counts at its own quoted cost. */
function subHireSpendContribution(
  sh: SubHireRow,
  orderById: Map<string, SupplierOrderRow>,
  pairedOrderIds: Set<string>,
): number {
  const linkedOrder = sh.supplierOrderId ? orderById.get(sh.supplierOrderId) : undefined;
  if (linkedOrder != null && COMMITTED_ORDER_STATUSES.has(linkedOrder.status ?? "DRAFT")) {
    pairedOrderIds.add(linkedOrder.id);
    return linkedOrder.status === "RECEIVED" ? Number(linkedOrder.total ?? 0) : Number(sh.totalCost ?? 0);
  }
  return Number(sh.totalCost ?? 0);
}

/** De-duplicated total: a linked sub-hire+order pair counts once (order.total once
 *  RECEIVED, else the sub-hire's quoted totalCost); unlinked committed orders and
 *  active sub-hires each count in full. */
function dedupedTotalSpend(
  activeSubHires: SubHireRow[],
  committedOrders: SupplierOrderRow[],
  orderById: Map<string, SupplierOrderRow>,
): number {
  const pairedOrderIds = new Set<string>();
  const subHireTotal = activeSubHires.reduce(
    (sum, sh) => sum + subHireSpendContribution(sh, orderById, pairedOrderIds),
    0,
  );
  const unpairedOrderTotal = committedOrders
    .filter((o) => !pairedOrderIds.has(o.id))
    .reduce((sum, o) => sum + Number(o.total ?? 0), 0);
  return subHireTotal + unpairedOrderTotal;
}

/** Variance summary: every LINKED pair (regardless of order status) contributes
 *  order.total - subHire.totalCost once the order has a total. Informational only
 *  — never denormalised, never feeds the P&L (spec decision). */
function computeVariance(
  subHires: SubHireRow[],
  orderById: Map<string, SupplierOrderRow>,
): { total: number; linkedCount: number } {
  let varianceTotal = 0;
  let linkedCount = 0;
  for (const sh of subHires) {
    if (!sh.supplierOrderId) continue;
    const order = orderById.get(sh.supplierOrderId);
    if (!order) continue;
    linkedCount++;
    if (order.total != null) varianceTotal += Number(order.total) - Number(sh.totalCost ?? 0);
  }
  return { total: round(varianceTotal), linkedCount };
}

export function computeSupplierSpend(
  orders: SupplierOrderRow[],
  subHires: SubHireRow[],
): {
  committedOrderSpend: number;
  subHireSpend: number;
  totalSpend: number;
  openOrderCount: number;
  variance: { total: number; linkedCount: number };
} {
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const committedOrders = orders.filter((o) => COMMITTED_ORDER_STATUSES.has(o.status ?? "DRAFT"));
  const activeSubHires = subHires.filter((sh) => !ACTIVE_SUBHIRE_STATUSES_EXCLUDED.has(sh.status ?? "DRAFT"));

  const committedOrderSpend = round(committedOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0));
  const subHireSpend = round(activeSubHires.reduce((sum, sh) => sum + Number(sh.totalCost ?? 0), 0));
  const totalSpend = dedupedTotalSpend(activeSubHires, committedOrders, orderById);
  const openOrderCount = orders.filter((o) => OPEN_ORDER_STATUSES.has(o.status ?? "DRAFT")).length;
  const variance = computeVariance(subHires, orderById);

  return {
    committedOrderSpend,
    subHireSpend,
    totalSpend: round(totalSpend),
    openOrderCount,
    variance,
  };
}

/**
 * Thin CRUD for Supplier (Convex table "suppliers"). GENERATED — Phase 2/5.
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
    await requireOrgReadFor(ctx, orgId, "supplier");
    return await ctx.db
      .query("suppliers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDocFor(ctx, doc, "supplier");
    return doc;
  },
});

/**
 * Paginated SUPPLIER list — browser-native replacement for SupplierTable's
 * useSuppliers whole-org live subscription + client-side filter/sort/paginate
 * (Finding #1, docs/designs/perf-convex-efficiency-2026-06.md). Unlike
 * clients/kits, archived suppliers are NOT excluded by default — `isActive`
 * is an optional "true"/"false" single-value filter, matching the old
 * behavior (no filter selected shows both). Asset/order counts are a
 * cross-domain aggregate that stays a separate merge the caller applies after
 * this query — unchanged. Tag search is now case-insensitive (via the shared
 * matchesSearch helper) — the old client-side check compared the lowercased
 * query against the tag's raw case, a minor pre-existing inconsistency with
 * every other search field here that this consolidation incidentally fixes.
 */
export const listPage = query({
  args: {
    orgId: v.string(),
    search: v.optional(v.string()),
    isActive: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sortBy: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, a) => {
    await requireOrgReadFor(ctx, a.orgId, "supplier");
    const page = a.page ?? 1;
    const pageSize = a.pageSize ?? 25;
    const sortBy = a.sortBy ?? "name";
    const dir: 1 | -1 = a.sortOrder === "desc" ? -1 : 1;

    const rows = await ctx.db.query("suppliers").withIndex("by_organizationId", (q) => q.eq("organizationId", a.orgId)).collect(); // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3

    const filtered = rows.filter((s) => {
      if (a.isActive === "true" && (s.isActive ?? true) !== true) return false;
      if (a.isActive === "false" && (s.isActive ?? true) !== false) return false;
      if (a.search && !matchesSearch([s.name, s.contactName, s.email, s.accountNumber, ...(s.tags ?? [])], a.search)) return false;
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
    await requireOrgReadFor(ctx, orgId, "supplier");
    const out: Record<string, { assets: number; orders: number }> = {};
    const ensure = (id: string) => (out[id] ??= { assets: 0, orders: 0 });

    const assets = await ctx.db
      .query("assets")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — per-org tallies need the full set
      .collect();
    for (const a of assets) if (a.supplierId) ensure(a.supplierId).assets++;

    const orders = await ctx.db
      .query("supplierOrders")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: aggregation — per-org tallies need the full set
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
    await requireOrgReadFor(ctx, orgId, "supplier");
    const filtered = (await ctx.db.query("assets").withIndex("by_supplierId", (q) => q.eq("supplierId", supplierId)).collect())
      .filter((a) => a.organizationId === orgId && a.isActive !== false)
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag));
    const total = filtered.length;
    const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const models = new Map((await ctx.db.query("models").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect()).map((m) => [m.id, m])); // r9.8-ok: server-side filter/sort/paginate over the org set (perf design); accepted R-9.8 tradeoff — see docs/exceptions.md R-8.3.3
    return { assets: rows.map((a) => ({ ...a, model: a.modelId ? models.get(a.modelId) ?? null : null })), total };
  },
});

function subHireRowProject(p: Doc<"projects"> | undefined) {
  return p ? { id: p.id, name: p.name, projectNumber: p.projectNumber ?? null, status: p.status ?? "" } : null;
}

function subHireRowLinkedOrder(order: Doc<"supplierOrders"> | undefined) {
  return order ? { id: order.id, orderNumber: order.orderNumber, status: order.status ?? "DRAFT" } : null;
}

/** One row of `subhiresPage`'s result — extracted so the query handler stays a plain
 *  data-fetch pipeline (R-3.6). */
function mapSubHireRow(
  sh: Doc<"subHires">,
  projById: Map<string, Doc<"projects">>,
  orderById: Map<string, Doc<"supplierOrders">>,
) {
  const totalCost = sh.totalCost ?? 0;
  const totalCharge = sh.totalCharge ?? 0;
  return {
    id: sh.id,
    orderNumber: sh.orderNumber,
    status: sh.status ?? "DRAFT",
    totalCost,
    totalCharge,
    margin: round(totalCharge - totalCost),
    project: subHireRowProject(sh.projectId ? projById.get(sh.projectId) : undefined),
    linkedOrder: subHireRowLinkedOrder(sh.supplierOrderId ? orderById.get(sh.supplierOrderId) : undefined),
  };
}

/**
 * A supplier's SUB-HIRE HEADS (createdAt desc), paginated, with project + linked-PO
 * reference (WS7 #946 — visible behaviour change from the prior
 * `projectLineItems`-based read, which couldn't show cost/charge/margin/status at
 * the order level; see FEATUREDOCS/22/39). Cost/charge/margin come straight off the
 * sub-hire head (already recalculated by every item/group write — see
 * convex/lib/subHireTotals.ts), so this needs no per-item aggregation.
 */
export const subhiresPage = query({
  args: { orgId: v.string(), supplierId: v.string(), page: v.number(), pageSize: v.number() },
  handler: async (ctx, { orgId, supplierId, page, pageSize }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    const matching = (
      await ctx.db
        .query("subHires")
        .withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", orgId).eq("supplierId", supplierId))
        .collect()
    ).sort((a, b) => (b.createdAt ?? -Infinity) - (a.createdAt ?? -Infinity));
    const total = matching.length;
    const rows = matching.slice((page - 1) * pageSize, page * pageSize);

    const projById = new Map((await ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect()).map((p) => [p.id, p])); // r9.8-ok: server-side filter/sort/paginate over the org set (perf design); accepted R-9.8 tradeoff — see docs/exceptions.md R-8.3.3

    const orderIds = [...new Set(rows.map((sh) => sh.supplierOrderId).filter((id): id is string => !!id))];
    const orderById = new Map(
      (await Promise.all(orderIds.map((id) => ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", id)).first())))
        .filter((o): o is NonNullable<typeof o> => o != null && o.organizationId === orgId)
        .map((o) => [o.id, o]),
    );

    return {
      subHires: rows.map((sh) => mapSubHireRow(sh, projById, orderById)),
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
    // WS7 #946 — supplier spend rollups (see the de-dup algorithm below).
    spend: v.object({
      committedOrderSpend: v.number(),
      subHireSpend: v.number(),
      totalSpend: v.number(),
      openOrderCount: v.number(),
      variance: v.object({ total: v.number(), linkedCount: v.number() }),
    }),
  }),
  handler: async (ctx, { orgId, id }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("Supplier not found");

    // Counts — index-scoped to the supplier, org re-checked (by_supplierId is global).
    const assets = (
      await ctx.db.query("assets").withIndex("by_supplierId", (q) => q.eq("supplierId", id)).collect()
    ).filter((a) => a.organizationId === orgId).length;
    const allOrders = (
      await ctx.db
        .query("supplierOrders")
        .withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", orgId).eq("supplierId", id))
        .collect()
    );
    const orders = allOrders.length;
    const lineItems = (
      await ctx.db.query("projectLineItems").withIndex("by_supplierId", (q) => q.eq("supplierId", id)).collect()
    ).filter((li) => li.organizationId === orgId).length;

    const allSubHires = await ctx.db
      .query("subHires")
      .withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", orgId).eq("supplierId", id))
      .collect();
    const spend = computeSupplierSpend(allOrders, allSubHires);

    return {
      spend,
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

export const agentOps: AgentOpsAnnotations = {
  list: { summary: "List all suppliers for the org.", danger: "low", mcpTier: 1 },
  getById: { summary: "Get a supplier by id.", danger: "low", mcpTier: 1 },
  listPage: { summary: "Paginated, filtered/sorted supplier list.", danger: "low", mcpTier: 2 },
  counts: { summary: "Asset + order counts per supplier for the org.", danger: "low", mcpTier: 2 },
  assetsPage: { summary: "Paginated assets belonging to a supplier.", danger: "low", mcpTier: 2 },
  subhiresPage: { summary: "Paginated sub-hires against a supplier.", danger: "low", mcpTier: 2 },
  detail: { summary: "Supplier detail with counts and spend rollups.", danger: "low", mcpTier: 1 },
};
