import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";

/**
 * Client <-> Xero contact mapping (WS1 #940) — service-only (called from
 * `src/server/xero.ts`, which already ran `requirePermission("invoice",
 * "xero_manage")` / the auto-create-on-push path before reaching here). Kept
 * OUT of clientWrites.ts's browser-direct guard-stack mutations deliberately
 * — the mapping must only ever change through a real Xero contact search/
 * create/link round-trip, never a plain client-form save silently clobbering
 * or dropping it.
 */

export const setXeroContactNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    clientId: v.string(),
    orgId: v.string(),
    xeroContactId: v.string(),
    xeroContactName: v.string(),
    actorUserId: v.string(),
    actorUserName: v.string(),
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { clientId, orgId, xeroContactId, xeroContactName, actorUserId, actorUserName, auditId, now }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first();
    if (!doc) throw new ConvexError("Client not found: " + clientId);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(doc._id, { xeroContactId, xeroContactName, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "client",
      entityId: clientId,
      entityName: doc.name,
      userId: actorUserId,
      userName: actorUserName,
      summary: `Linked ${doc.name} to Xero contact "${xeroContactName}"`,
      createdAt: now,
    });

    return { id: clientId };
  },
});

export const unlinkXeroContactNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    clientId: v.string(),
    orgId: v.string(),
    actorUserId: v.string(),
    actorUserName: v.string(),
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { clientId, orgId, actorUserId, actorUserName, auditId, now }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", clientId)).first();
    if (!doc) throw new ConvexError("Client not found: " + clientId);
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    await ctx.db.patch(doc._id, { xeroContactId: undefined, xeroContactName: undefined, updatedAt: now });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "client",
      entityId: clientId,
      entityName: doc.name,
      userId: actorUserId,
      userName: actorUserName,
      summary: `Unlinked ${doc.name} from its Xero contact`,
      createdAt: now,
    });

    return { id: clientId };
  },
});
