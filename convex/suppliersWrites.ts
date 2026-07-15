import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";

/**
 * Native SUPPLIER write mutations (Phase 3 browser-direct — replaces createSupplier/
 * updateSupplier/deleteSupplier). Plain CRUD (no state machine): 4 guards + per-row org
 * re-check + atomic audit. Delete re-implements the Prisma `_count` guard (assets /
 * lineItems / orders block) + the supplier_model_rate cascade. Clears use `undefined`
 * (schema optionals reject null). The form's supplierSchema validates before submit.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const supplierFields = {
  name: v.string(),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  website: v.optional(v.string()),
  address: v.optional(v.string()),
  latitude: v.optional(v.union(v.number(), v.null())),
  longitude: v.optional(v.union(v.number(), v.null())),
  notes: v.optional(v.string()),
  accountNumber: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
  defaultLeadTime: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  isActive: v.optional(v.boolean()),
};

function toDoc(a: {
  name: string; contactName?: string; email?: string; phone?: string; website?: string; address?: string;
  latitude?: number | null; longitude?: number | null; notes?: string; accountNumber?: string; paymentTerms?: string;
  defaultLeadTime?: string; tags?: string[]; isActive?: boolean;
}) {
  return {
    name: a.name,
    contactName: a.contactName || undefined,
    email: a.email || undefined,
    phone: a.phone || undefined,
    website: a.website || undefined,
    address: a.address || undefined,
    latitude: a.latitude ?? undefined,
    longitude: a.longitude ?? undefined,
    notes: a.notes || undefined,
    accountNumber: a.accountNumber || undefined,
    paymentTerms: a.paymentTerms || undefined,
    defaultLeadTime: a.defaultLeadTime || undefined,
    tags: (a.tags || []).map((t) => t.toLowerCase()),
    isActive: a.isActive ?? true,
  };
}

/** Server-side parity with supplierSchema — the mutation is the security boundary, not the form. */
function validateSupplier(a: { name: string; email?: string; contactName?: string; phone?: string; website?: string; address?: string; notes?: string; accountNumber?: string; paymentTerms?: string; defaultLeadTime?: string; latitude?: number | null; longitude?: number | null }) {
  if (!a.name || a.name.trim().length < 1) throw new ConvexError("Name is required");
  const max: [string, string | undefined, number][] = [
    ["Name", a.name, 200], ["Contact name", a.contactName, 200], ["Email", a.email, 200], ["Phone", a.phone, 50],
    ["Website", a.website, 500], ["Address", a.address, 500], ["Notes", a.notes, 2000], ["Account number", a.accountNumber, 100],
    ["Payment terms", a.paymentTerms, 100], ["Lead time", a.defaultLeadTime, 100],
  ];
  for (const [label, val, cap] of max) if (val && val.length > cap) throw new ConvexError(`${label} is too long`);
  if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) throw new ConvexError("Invalid email address");
  if ((a.latitude != null) !== (a.longitude != null)) throw new ConvexError("Both latitude and longitude must be provided together");
}

async function logSupplier(ctx: MutationCtx, a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; id: string; name: string; summary: string; details?: unknown }) {
  await writeActivityLog(ctx, { id: a.auditId, organizationId: a.orgId, action: a.action, entityType: "supplier", entityId: a.id, entityName: a.name, userId: a.actor.userId, userName: a.actor.userName, summary: a.summary, details: a.details, createdAt: a.now });
}

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...supplierFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplier");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "create");
    const actor = await resolveActor(ctx, a.actor);
    validateSupplier(a);

    const dup = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Supplier already exists");

    await ctx.db.insert("suppliers", { id: a.id, organizationId: a.orgId, ...toDoc(a), createdAt: a.now, updatedAt: a.now });
    await logSupplier(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", id: a.id, name: a.name, summary: `Created supplier ${a.name}` });
    return { id: a.id };
  },
});

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...supplierFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplier");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "update");
    const actor = await resolveActor(ctx, a.actor);
    validateSupplier(a);

    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Supplier not found");

    await ctx.db.patch(doc._id, { ...toDoc(a), updatedAt: a.now });
    await logSupplier(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", id: a.id, name: a.name, summary: `Updated supplier ${a.name}` });
    return { id: a.id };
  },
});

export const removeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "supplier");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "supplier", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await ctx.db.query("suppliers").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (!doc || doc.organizationId !== a.orgId) throw new ConvexError("Supplier not found");

    // Delete guards (Prisma _count parity): assets → lineItems → orders block.
    const assets = (await ctx.db.query("assets").withIndex("by_supplierId", (q) => q.eq("supplierId", a.id)).collect()).filter((x) => x.organizationId === a.orgId);
    if (assets.length > 0) throw new ConvexError("Cannot delete supplier with linked assets");
    const lineItems = (await ctx.db.query("projectLineItems").withIndex("by_supplierId", (q) => q.eq("supplierId", a.id)).collect()).filter((x) => x.organizationId === a.orgId);
    if (lineItems.length > 0) throw new ConvexError("Cannot delete supplier with linked line items");
    const orders = await ctx.db.query("supplierOrders").withIndex("by_organizationId_supplierId", (q) => q.eq("organizationId", a.orgId).eq("supplierId", a.id)).collect();
    if (orders.length > 0) throw new ConvexError("Cannot delete supplier with existing orders. Archive it instead.");

    // supplier_model_rate cascade (Convex-only).
    const rates = (await ctx.db.query("supplierModelRates").withIndex("by_supplierId", (q) => q.eq("supplierId", a.id)).collect()).filter((r) => r.organizationId === a.orgId);
    for (const r of rates) await ctx.db.delete(r._id);

    await ctx.db.delete(doc._id);
    await logSupplier(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", id: a.id, name: doc.name, summary: `Deleted supplier ${doc.name}`, details: { deleted: { name: doc.name } } });
    return { id: a.id };
  },
});
