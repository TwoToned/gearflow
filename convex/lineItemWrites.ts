import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgPermission } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";

/**
 * Native LINE-ITEM write mutations (Phase 5, the money domain — done safely).
 *
 * SCOPE: only the writes whose logic is cleanly separable from the financial
 * orchestration. recalculateProjectTotals stays SERVER-SIDE and runs post-hoc
 * exactly as before (it already runs after the write, never inside the write
 * transaction — src/server/line-items.ts), so the totals math is byte-identical
 * and parity is preserved by construction. addLineItem is NOT here — its
 * cross-project double-booking check reads every overlapping project (Convex
 * read-limit risk in a mutation) + accessory/kit expansion is ~400 lines of
 * orchestration; it stays server-orchestrated for now.
 *
 * removeNative mirrors removeLineItemCascade (convex/projectLineItems.ts) + adds the
 * child-removal guard (kit/accessory children can't be removed directly) + the DELETE
 * audit, all atomic. Gated behind NATIVE_LINEITEM_WRITES.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Delete a line + its fulfillment units (replica of deleteLineWithUnits). */
async function deleteLineWithUnits(ctx: MutationCtx, lineDocId: Id<"projectLineItems">, lineCuid: string) {
  const units = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineCuid))
    .collect();
  for (const u of units) await ctx.db.delete(u._id);
  await ctx.db.delete(lineDocId);
}

export const removeNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");

    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!line) throw new ConvexError({ code: "NOT_FOUND", message: "This item was deleted by someone else. Refresh the page." });
    if (line.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    // Child items (kit members, sub-hire group children, accessory children) are
    // removed via their parent, never individually — same guard as removeLineItem.
    if (line.isKitChild) {
      const isAccessory = line.childKind === "ACCESSORY";
      throw new ConvexError({
        code: isAccessory ? "ACCESSORY_CHILD" : "KIT_CHILD",
        message: isAccessory ? "This item is an accessory of another asset." : "This item is part of a Kit.",
      });
    }

    // Cascade-delete the children (+ their units) and the line (+ its units) — the
    // exact removeLineItemCascade sequence, now atomic with the guard + audit.
    const children = await ctx.db
      .query("projectLineItems")
      .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", id))
      .collect();
    for (const c of children) await deleteLineWithUnits(ctx, c._id, c.id);
    await deleteLineWithUnits(ctx, line._id, line.id);

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "DELETE",
      entityType: "lineItem",
      entityId: id,
      entityName: line.description || "Line item",
      userId: actor.userId,
      userName: actor.userName,
      summary: "Removed line item from project",
      projectId: line.projectId,
      createdAt: now,
    });

    // The caller recalculates project totals afterward (server-side, unchanged).
    return { projectId: line.projectId };
  },
});
