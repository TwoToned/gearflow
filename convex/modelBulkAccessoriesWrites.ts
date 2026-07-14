import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";

/**
 * Native MODEL-BULK-ACCESSORY write mutations (Phase 3 browser-direct — replaces the
 * addModelBulkAccessory/removeModelBulkAccessory server actions in
 * src/server/model-accessories.ts). Model-level default accessories: "every asset of
 * this model ships with N of this bulk asset". Gates on `model:update`. Standard shape:
 * 4 guards + per-row org re-check on the model AND the bulk asset AND the accessory row
 * + the dup-guard + sortOrder computation moved INTO the mutation + atomic audit. The
 * form's modelBulkAccessorySchema (quantity int ≥1, notes ≤500) runs client-side; the
 * quantity invariant is re-checked here since this is now the public boundary.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

export const addNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    modelId: v.string(),
    orgId: v.string(),
    bulkAssetId: v.string(),
    quantity: v.number(),
    notes: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, modelId, orgId, bulkAssetId, quantity, notes, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "modelAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "model", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new ConvexError("Quantity must be a whole number of at least 1");
    }
    if (notes !== undefined && notes.length > 500) {
      throw new ConvexError("Notes must be 500 characters or fewer");
    }

    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    if (!model || model.organizationId !== orgId) throw new ConvexError("Model not found");

    const bulkAsset = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bulkAssetId)).first();
    if (!bulkAsset || bulkAsset.organizationId !== orgId) throw new ConvexError("Bulk asset not found");

    // Dup guard + next sortOrder from the model's current (org-scoped) accessory list.
    const existing = await ctx.db
      .query("modelBulkAccessories")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .filter((q) => q.eq(q.field("organizationId"), orgId))
      .collect();
    if (existing.some((a) => a.bulkAssetId === bulkAssetId)) {
      throw new ConvexError(
        `${bulkAsset.assetTag} is already a default accessory on this model. Edit the quantity instead.`,
      );
    }
    const sortOrder = existing.reduce((max, a) => Math.max(max, a.sortOrder ?? -1), -1) + 1;

    await ctx.db.insert("modelBulkAccessories", {
      id,
      organizationId: orgId,
      modelId,
      bulkAssetId,
      quantity,
      sortOrder,
      notes,
      addedAt: now,
      addedById: actor.userId,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "model",
      entityId: model.id,
      entityName: model.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added default accessory: ${quantity}× ${bulkAsset.assetTag} to model ${model.name}`,
      createdAt: now,
    });

    return { id };
  },
});

export const removeNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    modelId: v.string(),
    orgId: v.string(),
    accessoryId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { modelId, orgId, accessoryId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "modelAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "model", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const acc = await ctx.db.query("modelBulkAccessories").withIndex("by_cuid", (q) => q.eq("id", accessoryId)).first();
    if (!acc || acc.organizationId !== orgId || acc.modelId !== modelId) {
      throw new ConvexError("That default accessory is not on this model.");
    }

    await ctx.db.delete(acc._id);

    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", acc.modelId)).first();
    const bulkAsset = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", acc.bulkAssetId)).first();

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "model",
      entityId: modelId,
      entityName: model?.name ?? modelId,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Removed default accessory: ${acc.quantity}× ${bulkAsset?.assetTag ?? acc.bulkAssetId}`,
      createdAt: now,
    });

    return { ok: true };
  },
});
