import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { sanitizeClientSet } from "./lib/sanitizeSet";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";

/**
 * Native CLIENT write mutations (Phase 3 browser-direct — replaces the
 * createClient/updateClient/updateClientNotes/archiveClient server actions in
 * src/server/clients.ts). Clients are plain CRUD (no counters/cascades/money), so each
 * mutation is the standard shape: 4 guards (assertWritesEnabled + enforceBrowserWriteLimit
 * + requireOrgPermission + resolveActor) + per-row org re-check + atomic audit. The
 * client form's zodResolver(clientSchema) validates before submit; the v.* arg validators
 * enforce the shape at the boundary.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

const clientFields = {
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
};

export const createNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    organizationId: v.string(),
    ...clientFields,
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, args) => {
    const { actor: suppliedActor, auditId, ...fields } = args;
    await assertWritesEnabled(ctx, "client");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, fields.organizationId, "client", "create");
    const actor = await resolveActor(ctx, suppliedActor);

    // Dup-guard the client-minted id (by_cuid is global + non-unique) — a reused id
    // makes another org's getById .unique() crash (and makes a retried create non-idempotent).
    const dup = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", fields.id)).first();
    if (dup) throw new ConvexError("Client already exists");

    await ctx.db.insert("clients", fields);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: fields.organizationId,
      action: "CREATE",
      entityType: "client",
      entityId: fields.id,
      entityName: fields.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created client ${fields.name}`,
      createdAt: fields.createdAt ?? fields.updatedAt ?? 0,
    });

    return { id: fields.id };
  },
});

const clientPatch = v.object({ ...clientFields, name: v.optional(v.string()), updatedAt: v.optional(v.number()) });

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    patch: clientPatch,
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, patch, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "client");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "client", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Client not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(doc._id, { ...sanitizeClientSet(patch), updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "client",
      entityId: id,
      entityName: patch.name ?? doc.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated client ${patch.name ?? doc.name}`,
      createdAt: now,
    });

    return { id };
  },
});

export const updateNotesNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    notes: v.union(v.string(), v.null()),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, notes, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "client");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "client", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Client not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(doc._id, { notes: notes ?? undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "client",
      entityId: id,
      entityName: doc.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated notes on client ${doc.name}`,
      createdAt: now,
    });

    return { ok: true as const };
  },
});

export const archiveNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "client");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "client", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError("Client not found: " + id);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(doc._id, { isActive: false, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "client",
      entityId: id,
      entityName: doc.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Archived client ${doc.name}`,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * Bulk-archive N clients in a SINGLE call (Appendix A invariant — powers the
 * clients table bulk-bar "Archive"). Same 4 guards as archiveNative, a per-row
 * org re-check (by_cuid is GLOBAL — foreign/missing ids are skipped, not thrown),
 * and one atomic audit row per newly-archived client (caller mints an auditId per
 * id). Idempotent: an already-archived client is counted but not re-audited.
 * Returns the count of org-matched clients now archived.
 */
export const archiveManyNative = mutation({
  returns: v.object({ archived: v.number() }),
  args: {
    orgId: v.string(),
    items: v.array(v.object({ id: v.string(), auditId: v.string() })),
    actor: actorValidator,
    now: v.number(),
  },
  handler: async (ctx, { orgId, items, actor: suppliedActor, now }) => {
    await assertWritesEnabled(ctx, "client");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "client", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    let archived = 0;
    const seen = new Set<string>();
    for (const { id, auditId } of items) {
      if (seen.has(id)) continue; // dedup — a repeated id must not double-count
      seen.add(id);
      const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).first();
      if (!doc || doc.organizationId !== orgId) continue; // per-row org re-check
      archived++;
      if (doc.isActive === false) continue; // already archived — idempotent, no re-audit
      await ctx.db.patch(doc._id, { isActive: false, updatedAt: now });
      await writeActivityLog(ctx, {
        id: auditId,
        organizationId: orgId,
        action: "DELETE",
        entityType: "client",
        entityId: id,
        entityName: doc.name,
        userId: actor.userId,
        userName: actor.userName,
        summary: `Archived client ${doc.name}`,
        createdAt: now,
      });
    }
    return { archived };
  },
});
