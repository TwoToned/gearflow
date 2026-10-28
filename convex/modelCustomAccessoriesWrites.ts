import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { assertStrLen, assertNumRange } from "./lib/fieldGuards";
import { AccessoryInclusion } from "./lib/validators";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Native MODEL-CUSTOM-ACCESSORY write mutations: a free-text accessory that isn't
 * in inventory ("every unit of this model ships with N × <name>"). Same shape and
 * guards as `modelBulkAccessoriesWrites.ts` (gate `model:update`, org re-check,
 * audit). Mirrors `modelCustomAccessorySchema` (src/lib/validations/asset.ts).
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

function assertFields(f: { name?: string; quantity?: number; notes?: string }): void {
  assertStrLen(f.name, "name", { min: 1, max: 120 });
  assertNumRange(f.quantity, "quantity", { min: 1, max: 1000, integer: true });
  assertStrLen(f.notes, "notes", { max: 500 });
}

export const addNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    id: v.string(),
    modelId: v.string(),
    orgId: v.string(),
    name: v.string(),
    quantity: v.number(),
    inclusion: v.optional(AccessoryInclusion),
    notes: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { id, modelId, orgId, name, quantity, inclusion, notes, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "modelAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "model", "update");
    const actor = await resolveActor(ctx, suppliedActor);
    const trimmed = name.trim();
    assertFields({ name: trimmed, quantity, notes });

    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    if (!model || model.organizationId !== orgId) throw new ConvexError("Model not found");

    const existing = await ctx.db
      .query("modelCustomAccessories")
      .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
      .filter((q) => q.eq(q.field("organizationId"), orgId))
      .collect();
    if (existing.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new ConvexError(`${trimmed} is already a custom accessory on this model. Edit the quantity instead.`);
    }
    const sortOrder = existing.reduce((max, a) => Math.max(max, a.sortOrder ?? -1), -1) + 1;

    await ctx.db.insert("modelCustomAccessories", {
      id, organizationId: orgId, modelId, name: trimmed, quantity, inclusion, sortOrder, notes, addedAt: now, addedById: actor.userId,
    });

    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "model", entityId: model.id, entityName: model.name,
      userId: actor.userId, userName: actor.userName,
      summary: `Added ${inclusion === "OPTIONAL" ? "optional" : "default"} custom accessory: ${quantity}× ${trimmed} to model ${model.name}`,
      createdAt: now,
    });
    return { id };
  },
});

export const updateNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    modelId: v.string(),
    orgId: v.string(),
    accessoryId: v.string(),
    name: v.optional(v.string()),
    quantity: v.optional(v.number()),
    inclusion: v.optional(AccessoryInclusion),
    notes: v.optional(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { modelId, orgId, accessoryId, name, quantity, inclusion, notes, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "modelAccessory");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "model", "update");
    const actor = await resolveActor(ctx, suppliedActor);
    const trimmed = name?.trim();
    assertFields({ name: trimmed, quantity, notes });

    const acc = await ctx.db.query("modelCustomAccessories").withIndex("by_cuid", (q) => q.eq("id", accessoryId)).first();
    if (!acc || acc.organizationId !== orgId || acc.modelId !== modelId) {
      throw new ConvexError("That custom accessory is not on this model.");
    }
    await ctx.db.patch(acc._id, {
      ...(trimmed !== undefined ? { name: trimmed } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(inclusion !== undefined ? { inclusion } : {}),
      ...(notes !== undefined ? { notes } : {}),
    });

    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "model", entityId: modelId, entityName: model?.name ?? modelId,
      userId: actor.userId, userName: actor.userName,
      summary: `Edited custom accessory ${trimmed ?? acc.name} on model ${model?.name ?? modelId}`,
      createdAt: now,
    });
    return { ok: true };
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

    const acc = await ctx.db.query("modelCustomAccessories").withIndex("by_cuid", (q) => q.eq("id", accessoryId)).first();
    if (!acc || acc.organizationId !== orgId || acc.modelId !== modelId) {
      throw new ConvexError("That custom accessory is not on this model.");
    }
    await ctx.db.delete(acc._id);

    const model = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    await writeActivityLog(ctx, {
      id: auditId, organizationId: orgId, action: "UPDATE", entityType: "model", entityId: modelId, entityName: model?.name ?? modelId,
      userId: actor.userId, userName: actor.userName,
      summary: `Removed custom accessory: ${acc.quantity}× ${acc.name}`,
      createdAt: now,
    });
    return { ok: true };
  },
});

export const agentOps: AgentOpsAnnotations = {
  addNative: { danger: "medium" },
  removeNative: { danger: "medium" },
  updateNative: { danger: "medium" },
};
