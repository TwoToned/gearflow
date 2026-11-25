import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { requireOrgReadFor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { collectCapped } from "./lib/pagination";
import { MAX_CONTACTS_PER_SUPPLIER, MAX_DOCUMENTS_PER_SUPPLIER, MAX_FILES_PER_ORDER } from "./lib/supplierRecordCore";

/**
 * Reads for the supplier record's Contacts / Documents tabs and the order's Files tab
 * (UX Phase 13, B3). Each is a plain org-scoped read (`supplier:read`, the same gate as the
 * supplier itself); the parent is fetched by the global `by_cuid` index and org-checked, and
 * every child row is org-checked again (`by_supplierId` / `by_orderId` are global). Lists are
 * bounded by the same caps the writes enforce. A file row carries the file's name/size/type
 * and its `/api/files` URL; that route authorises by the caller's org, which is exactly this
 * read's reach (every built-in role holds `supplier:read`).
 */

export const agentOps: AgentOpsAnnotations = {
  contacts: { summary: "A supplier's additional contacts.", danger: "low", mcpTier: 3 },
  documents: { summary: "A supplier's documents (insurance, contracts) with expiry dates.", danger: "low", mcpTier: 3 },
  orderFiles: { summary: "An order's attached PO, docket and other files.", danger: "low", mcpTier: 3 },
};

async function fileOf(ctx: QueryCtx, orgId: string, fileId: string) {
  const f = await ctx.db.query("fileUploads").withIndex("by_cuid", (q) => q.eq("id", fileId)).first();
  if (!f || f.organizationId !== orgId) return null;
  return { id: f.id, fileName: f.fileName, fileSize: f.fileSize, mimeType: f.mimeType, url: f.url };
}

async function assertSupplier(ctx: QueryCtx, orgId: string, supplierId: string): Promise<boolean> {
  const s = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", supplierId)).first();
  return !!s && s.organizationId === orgId;
}

export const contacts = query({
  args: { orgId: v.string(), supplierId: v.string() },
  handler: async (ctx, { orgId, supplierId }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    if (!(await assertSupplier(ctx, orgId, supplierId))) return [];
    const rows = await collectCapped(ctx.db.query("supplierContacts").withIndex("by_supplierId", (q) => q.eq("supplierId", supplierId)), MAX_CONTACTS_PER_SUPPLIER);
    return rows.rows
      .filter((c) => c.organizationId === orgId)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .map((c) => ({ id: c.id, name: c.name ?? null, role: c.role ?? null, email: c.email ?? null, phone: c.phone ?? null, notes: c.notes ?? null }));
  },
});

export const documents = query({
  args: { orgId: v.string(), supplierId: v.string() },
  handler: async (ctx, { orgId, supplierId }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    if (!(await assertSupplier(ctx, orgId, supplierId))) return [];
    const rows = await collectCapped(ctx.db.query("supplierDocuments").withIndex("by_supplierId", (q) => q.eq("supplierId", supplierId)), MAX_DOCUMENTS_PER_SUPPLIER);
    const mine = rows.rows.filter((d) => d.organizationId === orgId);
    const out = [];
    for (const d of mine) {
      out.push({ id: d.id, name: d.name, kind: d.kind ?? null, expiryDate: d.expiryDate ?? null, notes: d.notes ?? null, createdAt: d.createdAt ?? 0, file: await fileOf(ctx, orgId, d.fileId) });
    }
    return out.sort((a, b) => (a.expiryDate ?? Number.POSITIVE_INFINITY) - (b.expiryDate ?? Number.POSITIVE_INFINITY) || b.createdAt - a.createdAt);
  },
});

export const orderFiles = query({
  args: { orgId: v.string(), orderId: v.string() },
  handler: async (ctx, { orgId, orderId }) => {
    await requireOrgReadFor(ctx, orgId, "supplier");
    const order = await ctx.db.query("supplierOrders").withIndex("by_cuid", (q) => q.eq("id", orderId)).first();
    if (!order || order.organizationId !== orgId) return [];
    const rows = await collectCapped(ctx.db.query("supplierOrderFiles").withIndex("by_orderId", (q) => q.eq("orderId", orderId)), MAX_FILES_PER_ORDER);
    const out = [];
    for (const f of rows.rows.filter((r) => r.organizationId === orgId)) {
      out.push({ id: f.id, kind: f.kind, name: f.name ?? null, createdAt: f.createdAt ?? 0, file: await fileOf(ctx, orgId, f.fileId) });
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  },
});
