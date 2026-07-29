import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen } from "./lib/fieldGuards";

/**
 * Native CLIENT-CONTACT write mutations (WS9 #948 — multiple contacts per client,
 * expand phase). Gates on `client:update` (no new RBAC resource — contacts are a
 * sub-resource of the client they belong to) and folds every audit row under
 * `entityType: "client"` / `entityId: <clientId>` so it appears in the existing
 * client `ActivityTimeline` unchanged (spec decision).
 *
 * Standard shape: 4 guards (assertWritesEnabled + enforceBrowserWriteLimit +
 * requireOrgPermission + resolveActor) + per-row org re-check (client AND contact
 * rows are fetched by the GLOBAL by_cuid index) + atomic audit — mirrors
 * modelBulkAccessoriesWrites.ts. `isPrimary` semantics mirror mediaWrites.ts's
 * setPrimaryNative: exclusive-per-client, "absent = false", and removing the
 * primary promotes the next-lowest `sortOrder` contact (never leaves a client with
 * contacts but no primary).
 *
 * Usefulness floor (spec decision): at least one of {name, email, phone} —
 * `assertClientContactFields` re-enforces the same bound as `clientContactSchema`
 * (src/lib/validations/client-contact.ts) since a browser-direct caller bypassing
 * the client Zod `.parse()` would otherwise skip it (R-8.6.2). Duplicate email on
 * one client is ALLOWED (spec decision — UI warns, no hard uniqueness). Cap 50
 * contacts/client (bounds the child-list collect on `detail`).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const MAX_CONTACTS_PER_CLIENT = 50;

/** Mirrors clientContactSchema (src/lib/validations/client-contact.ts). */
function assertClientContactFields(f: { name?: string; role?: string; email?: string; phone?: string; notes?: string }): void {
  assertStrLen(f.name, "name", { max: 200 });
  assertStrLen(f.role, "role", { max: 100 });
  assertStrLen(f.email, "email", { max: 200 });
  assertStrLen(f.phone, "phone", { max: 50 });
  assertStrLen(f.notes, "notes", { max: 500 });
}

/** Usefulness floor: a contact must carry at least a name, email, or phone. */
function assertContactHasSubstance(f: { name?: string; email?: string; phone?: string }): void {
  if (!f.name && !f.email && !f.phone) {
    throw new ConvexError({ code: "INVALID_FIELD", message: "Provide at least a name, email, or phone number." });
  }
}

export const clientContactFields = {
  name: v.optional(v.string()),
  role: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  notes: v.optional(v.string()),
  isPrimary: v.optional(v.boolean()),
};

async function guards(ctx: MutationCtx, orgId: string) {
  await assertWritesEnabled(ctx, "clientContact");
  await enforceBrowserWriteLimit(ctx);
  await requireOrgPermission(ctx, orgId, "client", "update");
}

export const addNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    orgId: v.string(),
    clientId: v.string(),
    ...clientContactFields,
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, orgId, clientId, name, role, email, phone, notes, isPrimary, now, actor: suppliedActor, auditId }) => {
    await guards(ctx, orgId);
    const actor = await resolveActor(ctx, suppliedActor);
    assertClientContactFields({ name, role, email, phone, notes });
    assertContactHasSubstance({ name, email, phone });

    const client = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first();
    if (!client || client.organizationId !== orgId) throw new ConvexError("Client not found");

    const dup = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (dup) throw new ConvexError("Client contact already exists");

    const existing = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .filter((q) => q.eq(q.field("organizationId"), orgId))
      .collect();
    if (existing.length >= MAX_CONTACTS_PER_CLIENT) {
      throw new ConvexError(`A client can have at most ${MAX_CONTACTS_PER_CLIENT} contacts.`);
    }

    // The client's FIRST contact is always primary (a client never ends up with
    // contacts but no primary); afterwards it's whatever the caller asked for.
    const primary = existing.length === 0 ? true : (isPrimary ?? false);
    if (primary) {
      for (const c of existing) {
        if (c.isPrimary) await ctx.db.patch(c._id, { isPrimary: false });
      }
    }
    const sortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder ?? -1), -1) + 1;

    await ctx.db.insert("clientContacts", {
      id,
      organizationId: orgId,
      clientId,
      name,
      role,
      email,
      phone,
      notes,
      isPrimary: primary,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "client",
      entityId: clientId,
      entityName: client.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added contact ${name || email || phone} to client ${client.name}`,
      createdAt: now,
    });

    return { id };
  },
});

/** Only-defined-fields patch set — keeps updateNative's own branch count down. */
function contactUpdateSet(f: { name?: string; role?: string; email?: string; phone?: string; notes?: string }) {
  return {
    ...(f.name !== undefined ? { name: f.name } : {}),
    ...(f.role !== undefined ? { role: f.role } : {}),
    ...(f.email !== undefined ? { email: f.email } : {}),
    ...(f.phone !== undefined ? { phone: f.phone } : {}),
    ...(f.notes !== undefined ? { notes: f.notes } : {}),
  };
}

export const updateNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    orgId: v.string(),
    clientId: v.string(),
    contactId: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { orgId, clientId, contactId, name, role, email, phone, notes, now, actor: suppliedActor, auditId }) => {
    await guards(ctx, orgId);
    const actor = await resolveActor(ctx, suppliedActor);
    assertClientContactFields({ name, role, email, phone, notes });

    const contact = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", contactId)).first();
    if (!contact || contact.organizationId !== orgId || contact.clientId !== clientId) {
      throw new ConvexError("That contact is not on this client.");
    }

    // The floor applies to the MERGED result — an edit that would leave the
    // contact with no name/email/phone is rejected (never allow the floor's
    // guarantee to erode through a partial update).
    assertContactHasSubstance({
      name: name !== undefined ? name : (contact.name ?? undefined),
      email: email !== undefined ? email : (contact.email ?? undefined),
      phone: phone !== undefined ? phone : (contact.phone ?? undefined),
    });

    await ctx.db.patch(contact._id, { ...contactUpdateSet({ name, role, email, phone, notes }), updatedAt: now });

    const client = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first();
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "client",
      entityId: clientId,
      entityName: client?.name ?? clientId,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Edited contact ${contact.name || contact.email || contact.phone} on client ${client?.name ?? clientId}`,
      createdAt: now,
    });

    return { ok: true };
  },
});

export const removeNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    orgId: v.string(),
    clientId: v.string(),
    contactId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { orgId, clientId, contactId, now, actor: suppliedActor, auditId }) => {
    await guards(ctx, orgId);
    const actor = await resolveActor(ctx, suppliedActor);

    const contact = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", contactId)).first();
    if (!contact || contact.organizationId !== orgId || contact.clientId !== clientId) {
      throw new ConvexError("That contact is not on this client.");
    }
    const wasPrimary = contact.isPrimary ?? false;
    await ctx.db.delete(contact._id);

    // Promote the next-lowest-sortOrder contact if the removed one was primary
    // (mirrors mediaWrites.ts removeNative's promote-next-primary-photo logic) —
    // a client is never left with contacts but no primary.
    if (wasPrimary) {
      const remaining = await ctx.db
        .query("clientContacts")
        .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
        .filter((q) => q.eq(q.field("organizationId"), orgId))
        .collect();
      const next = remaining.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
      if (next) await ctx.db.patch(next._id, { isPrimary: true });
    }

    const client = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first();
    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "client",
      entityId: clientId,
      entityName: client?.name ?? clientId,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Removed contact ${contact.name || contact.email || contact.phone} from client ${client?.name ?? clientId}`,
      createdAt: now,
    });

    return { ok: true };
  },
});

export const setPrimaryNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { orgId: v.string(), clientId: v.string(), contactId: v.string() },
  handler: async (ctx, { orgId, clientId, contactId }) => {
    await guards(ctx, orgId);

    const target = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", contactId)).first();
    if (!target || target.organizationId !== orgId || target.clientId !== clientId) {
      throw new ConvexError("That contact is not on this client.");
    }

    const rows = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .filter((q) => q.eq(q.field("organizationId"), orgId))
      .collect();
    for (const r of rows) {
      if (r.id === contactId) {
        if (!r.isPrimary) await ctx.db.patch(r._id, { isPrimary: true });
      } else if (r.isPrimary) {
        await ctx.db.patch(r._id, { isPrimary: false });
      }
    }
    return { id: contactId };
  },
});

export const reorderNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { orgId: v.string(), clientId: v.string(), orderedIds: v.array(v.string()) },
  handler: async (ctx, { orgId, clientId, orderedIds }) => {
    await guards(ctx, orgId);
    for (let i = 0; i < orderedIds.length; i++) {
      const doc = await ctx.db.query("clientContacts").withIndex("by_cuid", (q) => q.eq("id", orderedIds[i])).first();
      if (doc && doc.organizationId === orgId && doc.clientId === clientId) await ctx.db.patch(doc._id, { sortOrder: i });
    }
    return { ok: true };
  },
});

export const agentOps: AgentOpsAnnotations = {
  addNative: { danger: "medium" },
  // Delete/archive category is high by rule (tracks the design's stated
  // categories, not this row's actual low blast-radius as a contact record).
  removeNative: { danger: "high" },
  reorderNative: { danger: "low" },
  // Exclusive primary-contact toggle — trivially reversible, gates nothing else.
  setPrimaryNative: { danger: "low" },
  updateNative: { danger: "medium" },
};
