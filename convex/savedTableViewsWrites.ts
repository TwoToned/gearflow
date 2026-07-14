import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthContext, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";

/**
 * Native SAVED-TABLE-VIEW write mutations (Phase 3 browser-direct — replaces the
 * createSavedView/updateSavedView/deleteSavedView/setDefaultSavedView server actions
 * in src/server/saved-views.ts).
 *
 * Saved views are PERSONAL: each is owned by the user who created it and scoped to
 * their org — there is no resource-level permission (any authenticated member manages
 * their OWN views). So security hinges on deriving BOTH userId + orgId from the
 * VERIFIED token (never a client arg): a member can only ever create/read/update/delete
 * views under their own (userId, orgId), and every by_cuid fetch is re-checked against
 * both. Guards: assertWritesEnabled + enforceBrowserWriteLimit + verified-user-org +
 * resolveActor + atomic audit.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });
const MAX_NAME = 60;

/** Resolve the verified caller to {userId, orgId, actor}; reject anon / no-org. */
async function requireUserOrg(
  ctx: MutationCtx,
  suppliedActor: Actor,
): Promise<{ userId: string; orgId: string; actor: Actor }> {
  const auth = await getAuthContext(ctx);
  if (!auth || auth.kind !== "user") {
    throw new ConvexError("Unauthorized: a signed-in user is required.");
  }
  if (!auth.orgId) {
    throw new ConvexError("Forbidden: no active organization.");
  }
  // resolveActor pins actor.userId to the verified subject + resolves the display name.
  const actor = await resolveActor(ctx, suppliedActor);
  return { userId: actor.userId, orgId: auth.orgId, actor };
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ConvexError("View name is required");
  if (trimmed.length > MAX_NAME) {
    throw new ConvexError("View name must be 60 characters or fewer");
  }
  return trimmed;
}

export const createNative = mutation({
  returns: v.object({ id: v.string(), name: v.string() }),
  args: {
    id: v.string(),
    tableId: v.string(),
    name: v.string(),
    config: v.any(),
    isDefault: v.boolean(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, tableId, name, config, isDefault, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "savedView");
    await enforceBrowserWriteLimit(ctx);
    const { userId, orgId, actor } = await requireUserOrg(ctx, suppliedActor);
    const cleanName = assertName(name);

    // Atomically clear any existing default for (user, table, org) before inserting a
    // new default — mirrors savedTableViews.createForUser (prevents two defaults).
    if (isDefault) {
      const views = await ctx.db
        .query("savedTableViews")
        .withIndex("by_userId_tableId", (q) => q.eq("userId", userId).eq("tableId", tableId))
        .collect();
      for (const view of views) {
        if (view.isDefault && view.organizationId === orgId) {
          await ctx.db.patch(view._id, { isDefault: false, updatedAt: now });
        }
      }
    }

    await ctx.db.insert("savedTableViews", {
      id, organizationId: orgId, userId, tableId, name: cleanName, config, isDefault,
      createdAt: now, updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "CREATE",
      entityType: "savedView",
      entityId: id,
      entityName: cleanName,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Created saved view "${cleanName}"`,
      createdAt: now,
    });

    return { id, name: cleanName };
  },
});

/** Fetch a view and assert it belongs to the verified caller (org + user). */
async function requireOwnView(
  ctx: MutationCtx,
  id: string,
  userId: string,
  orgId: string,
) {
  const doc = await ctx.db.query("savedTableViews").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  if (!doc || doc.organizationId !== orgId || doc.userId !== userId) {
    throw new ConvexError("View not found");
  }
  return doc;
}

export const updateNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    config: v.optional(v.any()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, name, config, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "savedView");
    await enforceBrowserWriteLimit(ctx);
    const { userId, orgId, actor } = await requireUserOrg(ctx, suppliedActor);
    const doc = await requireOwnView(ctx, id, userId, orgId);

    const cleanName = name !== undefined ? assertName(name) : undefined;
    await ctx.db.patch(doc._id, {
      ...(cleanName !== undefined ? { name: cleanName } : {}),
      ...(config !== undefined ? { config } : {}),
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "savedView",
      entityId: id,
      entityName: doc.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Updated saved view "${doc.name}"`,
      createdAt: now,
    });

    return { id };
  },
});

export const removeNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "savedView");
    await enforceBrowserWriteLimit(ctx);
    const { userId, orgId, actor } = await requireUserOrg(ctx, suppliedActor);
    const doc = await requireOwnView(ctx, id, userId, orgId);

    await ctx.db.delete(doc._id);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "savedView",
      entityId: id,
      entityName: doc.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Deleted saved view "${doc.name}"`,
      createdAt: now,
    });

    return { ok: true };
  },
});

/**
 * Set (or clear) the default view for a table. Clears every existing default for
 * (user, table, org), then optionally marks `targetId` the sole default. Passing null
 * just clears. Atomic in one transaction.
 */
export const setDefaultNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    tableId: v.string(),
    targetId: v.union(v.string(), v.null()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { tableId, targetId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "savedView");
    await enforceBrowserWriteLimit(ctx);
    const { userId, orgId, actor } = await requireUserOrg(ctx, suppliedActor);

    const views = await ctx.db
      .query("savedTableViews")
      .withIndex("by_userId_tableId", (q) => q.eq("userId", userId).eq("tableId", tableId))
      .collect();
    for (const view of views) {
      if (view.isDefault && view.organizationId === orgId) {
        await ctx.db.patch(view._id, { isDefault: false, updatedAt: now });
      }
    }

    let viewName: string | null = null;
    if (targetId) {
      const target = await requireOwnView(ctx, targetId, userId, orgId);
      if (target.tableId !== tableId) throw new ConvexError("View not found");
      await ctx.db.patch(target._id, { isDefault: true, updatedAt: now });
      viewName = target.name;
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "savedView",
      entityId: targetId || tableId,
      entityName: viewName || tableId,
      userId: actor.userId,
      userName: actor.userName,
      summary: targetId
        ? `Set "${viewName}" as default view for table ${tableId}`
        : `Cleared default view for table ${tableId}`,
      createdAt: now,
    });

    return { ok: true };
  },
});
