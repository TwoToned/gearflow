import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgPermission, resolveActor, type Actor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { CheckItemType } from "./lib/validators";

/**
 * Native CHECK-ITEM write mutations (Phase 3 browser-direct — replaces the
 * check-items.ts server actions). Check items + their model/kit assignment join
 * tables are Convex-only config: plain CRUD, no state machine. Every mutation runs
 * the 4 guards (writes-enabled + rate limit + RBAC `checkItem:*` + resolveActor) +
 * per-row org re-check + atomic audit. Read-then-write logic (max sortOrder, dedup,
 * usage guards, name resolution) is INLINED here so each op is one atomic mutation
 * (was N client round-trips). Reads stay in check-items-read.ts + the reactive hooks.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

async function log(
  ctx: MutationCtx,
  a: { orgId: string; actor: Actor; auditId: string; now: number; action: string; entityType: string; entityId: string; entityName: string; summary: string },
) {
  await writeActivityLog(ctx, {
    id: a.auditId, organizationId: a.orgId, action: a.action, entityType: a.entityType,
    entityId: a.entityId, entityName: a.entityName, userId: a.actor.userId, userName: a.actor.userName,
    summary: a.summary, createdAt: a.now,
  });
}

/** Org-scoped check-item lookup (by_cuid is a GLOBAL index → re-check org). */
async function orgCheckItem(ctx: MutationCtx, orgId: string, id: string) {
  const doc = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return doc && doc.organizationId === orgId ? doc : null;
}
async function orgModel(ctx: MutationCtx, orgId: string, id: string) {
  const doc = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return doc && doc.organizationId === orgId ? doc : null;
}
async function orgKit(ctx: MutationCtx, orgId: string, id: string) {
  const doc = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", id)).first();
  return doc && doc.organizationId === orgId ? doc : null;
}

// ─── Check Item Library ─────────────────────────────────────────────────────

export const checkItemFields = {
  label: v.string(),
  description: v.optional(v.string()),
  type: v.optional(CheckItemType),
  category: v.optional(v.string()),
  measurementUnit: v.optional(v.string()),
  measurementMin: v.optional(v.number()),
  measurementMax: v.optional(v.number()),
  dropdownOptions: v.optional(v.any()),
};

export const createCheckItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...checkItemFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "create");
    const actor = await resolveActor(ctx, a.actor);
    if (!a.label || a.label.trim().length < 1) throw new ConvexError("Label is required");

    const dup = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", a.id)).first();
    if (dup) throw new ConvexError("Check item already exists");

    await ctx.db.insert("checkItems", {
      id: a.id, organizationId: a.orgId, label: a.label,
      description: a.description || undefined, type: a.type ?? "PASS_FAIL",
      category: a.category || undefined, measurementUnit: a.measurementUnit || undefined,
      measurementMin: a.measurementMin ?? undefined, measurementMax: a.measurementMax ?? undefined,
      dropdownOptions: a.dropdownOptions ?? undefined,
      createdById: actor.userId, createdAt: a.now, updatedAt: a.now,
    });
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "CREATE", entityType: "checkItem", entityId: a.id, entityName: a.label, summary: `Created check item "${a.label}"` });
    return { id: a.id };
  },
});

export const updateCheckItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), ...checkItemFields, now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");
    const actor = await resolveActor(ctx, a.actor);
    if (!a.label || a.label.trim().length < 1) throw new ConvexError("Label is required");

    const doc = await orgCheckItem(ctx, a.orgId, a.id);
    if (!doc) throw new ConvexError("Check item not found");

    // Full-object submit: present optional → set, absent/empty → clear (undefined).
    await ctx.db.patch(doc._id, {
      label: a.label,
      type: a.type ?? "PASS_FAIL",
      description: a.description || undefined,
      category: a.category || undefined,
      measurementUnit: a.measurementUnit || undefined,
      measurementMin: a.measurementMin ?? undefined,
      measurementMax: a.measurementMax ?? undefined,
      dropdownOptions: a.dropdownOptions ?? undefined,
      updatedAt: a.now,
    });
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", entityType: "checkItem", entityId: a.id, entityName: a.label, summary: `Updated check item "${a.label}"` });
    return { id: a.id };
  },
});

export const deleteCheckItemNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "delete");
    const actor = await resolveActor(ctx, a.actor);

    const doc = await orgCheckItem(ctx, a.orgId, a.id);
    if (!doc) throw new ConvexError("Check item not found");

    // Usage guard — org-scoped (by_checkItemId is global).
    const modelUsage = (await ctx.db.query("modelCheckItems").withIndex("by_checkItemId", (q) => q.eq("checkItemId", a.id)).collect()).filter((r) => r.organizationId === a.orgId).length;
    const kitUsage = (await ctx.db.query("kitCheckItems").withIndex("by_checkItemId", (q) => q.eq("checkItemId", a.id)).collect()).filter((r) => r.organizationId === a.orgId).length;
    if (modelUsage > 0 || kitUsage > 0) {
      const parts: string[] = [];
      if (modelUsage > 0) parts.push(`${modelUsage} model${modelUsage === 1 ? "" : "s"}`);
      if (kitUsage > 0) parts.push(`${kitUsage} kit${kitUsage === 1 ? "" : "s"}`);
      throw new ConvexError(`Cannot delete: this check item is used by ${parts.join(" and ")}`);
    }

    await ctx.db.delete(doc._id);
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "DELETE", entityType: "checkItem", entityId: a.id, entityName: doc.label, summary: `Deleted check item "${doc.label}"` });
    return { id: a.id };
  },
});

// ─── Model assignments ──────────────────────────────────────────────────────

export const addCheckItemToModelNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), modelId: v.string(), checkItemId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");
    const actor = await resolveActor(ctx, a.actor);
    const model = await orgModel(ctx, a.orgId, a.modelId);
    if (!model) throw new ConvexError("Model not found");
    const checkItem = await orgCheckItem(ctx, a.orgId, a.checkItemId);
    if (!checkItem) throw new ConvexError("Check item not found");

    const existing = (await ctx.db.query("modelCheckItems").withIndex("by_modelId", (q) => q.eq("modelId", a.modelId)).collect()).filter((r) => r.organizationId === a.orgId);
    if (existing.some((r) => r.checkItemId === a.checkItemId)) return { id: a.id }; // idempotent
    const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? -1), -1);

    await ctx.db.insert("modelCheckItems", { id: a.id, organizationId: a.orgId, modelId: a.modelId, checkItemId: a.checkItemId, sortOrder: maxSort + 1, createdAt: a.now });
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", entityType: "model", entityId: a.modelId, entityName: model.name, summary: `Added check item "${checkItem.label}" to model "${model.name}"` });
    return { id: a.id };
  },
});

export const removeCheckItemFromModelNative = mutation({
  returns: v.object({ success: v.boolean() }),
  args: { orgId: v.string(), modelId: v.string(), checkItemId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");
    const actor = await resolveActor(ctx, a.actor);

    const row = (await ctx.db.query("modelCheckItems").withIndex("by_modelId", (q) => q.eq("modelId", a.modelId)).collect()).find((r) => r.organizationId === a.orgId && r.checkItemId === a.checkItemId);
    if (!row) throw new ConvexError("Check item not assigned to this model");
    await ctx.db.delete(row._id);

    const model = await orgModel(ctx, a.orgId, a.modelId);
    const checkItem = await orgCheckItem(ctx, a.orgId, a.checkItemId);
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", entityType: "model", entityId: a.modelId, entityName: model?.name ?? a.modelId, summary: `Removed check item "${checkItem?.label ?? a.checkItemId}" from model "${model?.name ?? a.modelId}"` });
    return { success: true };
  },
});

export const reorderModelCheckItemsNative = mutation({
  returns: v.object({ success: v.boolean() }),
  args: { orgId: v.string(), modelId: v.string(), orderedCheckItemIds: v.array(v.string()) },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");

    const rows = (await ctx.db.query("modelCheckItems").withIndex("by_modelId", (q) => q.eq("modelId", a.modelId)).collect()).filter((r) => r.organizationId === a.orgId);
    const byCheckItem = new Map(rows.map((r) => [r.checkItemId, r]));
    // Keep ORIGINAL position as sortOrder — a dropped id doesn't compress survivors.
    for (let sortOrder = 0; sortOrder < a.orderedCheckItemIds.length; sortOrder++) {
      const row = byCheckItem.get(a.orderedCheckItemIds[sortOrder]);
      if (row) await ctx.db.patch(row._id, { sortOrder });
    }
    return { success: true };
  },
});

export const bulkAddCheckItemsToModelsNative = mutation({
  returns: v.object({ count: v.number(), modelNames: v.array(v.string()) }),
  args: { orgId: v.string(), modelIds: v.array(v.string()), checkItemIds: v.array(v.string()), rowIds: v.array(v.string()), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");
    const actor = await resolveActor(ctx, a.actor);
    // Dedup inputs — repeated ids would otherwise create duplicate assignments /
    // duplicate audit rows (the by_* indexes are non-unique).
    const modelIds = [...new Set(a.modelIds)];
    const checkItemIds = [...new Set(a.checkItemIds)];
    if (modelIds.length === 0 || checkItemIds.length === 0) throw new ConvexError("No models or check items selected");

    // Resolve models + check items (org-scoped) for existence + audit labels.
    const models = (await Promise.all(modelIds.map((id) => orgModel(ctx, a.orgId, id)))).filter((m): m is NonNullable<typeof m> => m != null);
    const checkItems = (await Promise.all(checkItemIds.map((id) => orgCheckItem(ctx, a.orgId, id)))).filter((c): c is NonNullable<typeof c> => c != null);
    const checkItemIdSet = new Set(checkItems.map((c) => c.id));

    let rowIdx = 0;
    let created = 0;
    for (const model of models) {
      const existing = (await ctx.db.query("modelCheckItems").withIndex("by_modelId", (q) => q.eq("modelId", model.id)).collect()).filter((r) => r.organizationId === a.orgId);
      const existingSet = new Set(existing.map((r) => r.checkItemId));
      let offset = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? -1), -1) + 1;
      for (const checkItemId of checkItemIds) {
        if (!checkItemIdSet.has(checkItemId) || existingSet.has(checkItemId)) continue;
        const rowId = a.rowIds[rowIdx++] ?? `${model.id}:${checkItemId}`;
        await ctx.db.insert("modelCheckItems", { id: rowId, organizationId: a.orgId, modelId: model.id, checkItemId, sortOrder: offset++, createdAt: a.now });
        existingSet.add(checkItemId); // guard against any residual dup within this model
        created++;
      }
    }

    const checkLabels = checkItems.map((c) => c.label).join(", ");
    for (const model of models) {
      await log(ctx, { orgId: a.orgId, actor, auditId: `${a.auditId}-${model.id}`, now: a.now, action: "UPDATE", entityType: "model", entityId: model.id, entityName: model.name, summary: `Bulk assigned check items [${checkLabels}] to model "${model.name}"` });
    }
    return { count: created, modelNames: models.map((m) => m.name) };
  },
});

// ─── Kit assignments ────────────────────────────────────────────────────────

export const addCheckItemToKitNative = mutation({
  returns: v.object({ id: v.string() }),
  args: { id: v.string(), orgId: v.string(), kitId: v.string(), checkItemId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");
    const actor = await resolveActor(ctx, a.actor);
    const kit = await orgKit(ctx, a.orgId, a.kitId);
    if (!kit) throw new ConvexError("Kit not found");
    const checkItem = await orgCheckItem(ctx, a.orgId, a.checkItemId);
    if (!checkItem) throw new ConvexError("Check item not found");

    const existing = (await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect()).filter((r) => r.organizationId === a.orgId);
    if (existing.some((r) => r.checkItemId === a.checkItemId)) return { id: a.id }; // idempotent
    const maxSort = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? -1), -1);

    await ctx.db.insert("kitCheckItems", { id: a.id, organizationId: a.orgId, kitId: a.kitId, checkItemId: a.checkItemId, sortOrder: maxSort + 1, createdAt: a.now });
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", entityType: "kit", entityId: a.kitId, entityName: kit.name, summary: `Added check item "${checkItem.label}" to kit "${kit.name}"` });
    return { id: a.id };
  },
});

export const removeCheckItemFromKitNative = mutation({
  returns: v.object({ success: v.boolean() }),
  args: { orgId: v.string(), kitId: v.string(), checkItemId: v.string(), now: v.number(), actor: actorValidator, auditId: v.string() },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");
    const actor = await resolveActor(ctx, a.actor);

    const row = (await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect()).find((r) => r.organizationId === a.orgId && r.checkItemId === a.checkItemId);
    if (!row) throw new ConvexError("Check item not assigned to this kit");
    await ctx.db.delete(row._id);

    const kit = await orgKit(ctx, a.orgId, a.kitId);
    const checkItem = await orgCheckItem(ctx, a.orgId, a.checkItemId);
    await log(ctx, { orgId: a.orgId, actor, auditId: a.auditId, now: a.now, action: "UPDATE", entityType: "kit", entityId: a.kitId, entityName: kit?.name ?? a.kitId, summary: `Removed check item "${checkItem?.label ?? a.checkItemId}" from kit "${kit?.name ?? a.kitId}"` });
    return { success: true };
  },
});

export const reorderKitCheckItemsNative = mutation({
  returns: v.object({ success: v.boolean() }),
  args: { orgId: v.string(), kitId: v.string(), orderedCheckItemIds: v.array(v.string()) },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "checkItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "checkItem", "update");

    const rows = (await ctx.db.query("kitCheckItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect()).filter((r) => r.organizationId === a.orgId);
    const byCheckItem = new Map(rows.map((r) => [r.checkItemId, r]));
    for (let sortOrder = 0; sortOrder < a.orderedCheckItemIds.length; sortOrder++) {
      const row = byCheckItem.get(a.orderedCheckItemIds[sortOrder]);
      if (row) await ctx.db.patch(row._id, { sortOrder });
    }
    return { success: true };
  },
});
