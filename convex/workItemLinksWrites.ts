import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import * as enums from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Browser-direct writes for `workItemLinks` (#1245, design §8.2/§10.1) — the
 * join table between a work item (`projectTasks` row) and any other entity
 * (client, contact, quote, invoice, service, crew assignment, asset, line
 * item, location). Gated on `work:update`, the same resource/action a task
 * edit already requires — a link is metadata on the work item, not a
 * separate object with its own permission story.
 */

async function requireWorkOrgUpdate(ctx: MutationCtx, orgId: string): Promise<void> {
  await requireOrgPermission(ctx, orgId, "work", "update");
}

async function requireWorkItemInOrg(ctx: MutationCtx, workItemId: string, orgId: string) {
  const doc = await ctx.db.query("projectTasks").withIndex("by_cuid", (q) => q.eq("id", workItemId)).first();
  if (!doc || doc.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Work item not found." });
  return doc;
}

/** Link a work item to an entity — idempotent: re-linking the same
 *  (workItemId, entityType, entityId) triple is a no-op returning the
 *  existing row's id rather than creating a duplicate. */
export const linkNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    workItemId: v.string(),
    entityType: enums.WorkItemLinkEntityType,
    entityId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "workItemLink");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrgUpdate(ctx, a.orgId);
    await requireWorkItemInOrg(ctx, a.workItemId, a.orgId);

    const existing = await ctx.db
      .query("workItemLinks")
      .withIndex("by_workItemId", (q) => q.eq("workItemId", a.workItemId))
      .filter((q) => q.and(q.eq(q.field("entityType"), a.entityType), q.eq(q.field("entityId"), a.entityId)))
      .first();
    if (existing) return { id: existing.id };

    const id = createId();
    await ctx.db.insert("workItemLinks", {
      id,
      organizationId: a.orgId,
      workItemId: a.workItemId,
      entityType: a.entityType,
      entityId: a.entityId,
      createdAt: a.now,
    });
    return { id };
  },
});

/** Remove a link by its own id. Removing a link never touches the work item
 *  or the linked entity — it only stops "all work for this client" (etc.)
 *  from surfacing this item. */
export const unlinkNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { orgId: v.string(), id: v.string() },
  handler: async (ctx, { orgId, id }) => {
    await assertWritesEnabled(ctx, "workItemLink");
    await enforceBrowserWriteLimit(ctx);
    await requireWorkOrgUpdate(ctx, orgId);

    const doc = await ctx.db.query("workItemLinks").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError({ code: "NOT_FOUND", message: "Link not found." });
    await ctx.db.delete(doc._id);
    return { ok: true };
  },
});

export const agentOps: AgentOpsAnnotations = {
  linkNative: { summary: "Link a work item to another entity (client, quote, asset, ...).", danger: "low", mcpTier: 2 },
  unlinkNative: { summary: "Remove a work item's link to another entity.", danger: "low", mcpTier: 2 },
};
