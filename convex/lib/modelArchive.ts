import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * An archived model (`isActive: false`) takes no NEW lines (UX Phase 12, owner ruling
 * Q-S1): the model is hidden from quotes and pickers, and the server is the authority
 * for that, not the picker. EXISTING lines, reservations and availability are
 * untouched (archive does not cascade). ONE rule, called by every path that puts a
 * model on a job: add / smart add, a modelId swap on patch, applying a group
 * template, a packing case for a model, a sub-hire item.
 *
 * Not applied (deliberately): copying an existing job or version (the lines already
 * exist), kit contents (a kit is physical gear, not a model pick), and procurement
 * (supplier-order items). Org-checking the FK stays the caller's `assertRefInOrg`.
 */
export async function assertModelNotArchived(ctx: MutationCtx, orgId: string, modelId: string): Promise<void> {
  const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
  if (model && model.organizationId === orgId && model.isActive === false) {
    throw new ConvexError({
      code: "MODEL_ARCHIVED",
      message: `${model.name} is archived and can't be added to a job. Restore it first.`,
    });
  }
}
