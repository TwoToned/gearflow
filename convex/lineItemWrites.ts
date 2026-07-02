import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireOrgPermission } from "./lib/auth";
import { writeActivityLog } from "./lib/audit";
import * as enums from "./lib/validators";
import { expandAccessoryChildLines } from "./lib/fulfillment";
import { createKitLineItemCore } from "./projectLineItems";

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

const LINE_NEVER_CLEAR = new Set(["id", "organizationId", "projectId"]);

/**
 * patchNative — apply a set/clear patch to a line item + UPDATE audit, atomic.
 * RBAC(project, manage_line_items). The server action still does the availability
 * re-check (cross-project, on quantity increase) + the stale-revision guard + builds
 * set/clear; the write + audit move here. recalc stays server-side (post-write).
 */
export const patchNative = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    set: v.any(),
    clear: v.array(v.string()),
    entityName: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, orgId, set, clear, entityName, actor, auditId, now }) => {
    await requireOrgPermission(ctx, orgId, "project", "manage_line_items");

    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).first();
    if (!doc) throw new ConvexError({ code: "NOT_FOUND", message: "This item was deleted by someone else. Refresh the page." });
    if (doc.organizationId !== orgId) throw new ConvexError("Forbidden: organization mismatch.");

    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set as Record<string, unknown>);
    } else {
      const { _id, _creationTime, ...rest } = doc;
      const merged: Record<string, unknown> = { ...rest, ...(set as Record<string, unknown>) };
      for (const k of clear) {
        if (LINE_NEVER_CLEAR.has(k)) continue;
        delete merged[k];
      }
      await ctx.db.replace(doc._id, merged as typeof rest);
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "UPDATE",
      entityType: "lineItem",
      entityId: id,
      entityName,
      userId: actor.userId,
      userName: actor.userName,
      summary: "Updated line item on project",
      projectId: doc.projectId,
      createdAt: now,
    });

    return { projectId: doc.projectId };
  },
});

/** Next sort order for a project's lines (replica of nextLineSort). */
async function nextLineSort(ctx: MutationCtx, projectId: string, organizationId: string): Promise<number> {
  const lines = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();
  return lines.filter((l) => l.organizationId === organizationId).reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
}

/**
 * addCustomNative — insert a custom (non-inventory) line item + CREATE audit, atomic.
 * RBAC(project, manage_line_items). Custom items never consume inventory, so there's
 * NO availability check to keep server-side — this is a fully-native add. sortOrder is
 * computed in-mutation (nextLineSort replica); recalc stays server-side (post-write).
 */
export const addCustomNative = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fields: v.object({
      description: v.optional(v.string()),
      quantity: v.number(),
      unitPrice: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      notes: v.optional(v.string()),
      isOptional: v.optional(v.boolean()),
      categoryId: v.optional(v.string()),
      groupId: v.optional(v.string()),
      groupName: v.optional(v.string()),
      lineTotal: v.optional(v.number()),
    }),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, fields, actor, auditId, now }) => {
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");

    const sortOrder = await nextLineSort(ctx, projectId, organizationId);
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId,
      projectId,
      type: "EQUIPMENT",
      isCustomItem: true,
      ...fields,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: fields.description || "Custom item",
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added custom item "${fields.description ?? ""}" to project`,
      projectId,
      createdAt: now,
    });

    return { id };
  },
});

/**
 * addNative — insert an inventory line item (+ atomic accessory expansion via the
 * shared expandAccessoryChildLines, the SAME helper createLineItem uses) + CREATE
 * audit, all in one transaction. RBAC(project, manage_line_items).
 *
 * Option A: the server action keeps the cross-project availability/double-booking
 * check (reads overlapping projects — a mutation can't safely do that at scale) and
 * the price computation; it passes the resolved `fields`, and this mutation does the
 * atomic write (parent + accessory children + units) + audit. recalc stays server-side.
 */
export const addNative = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    fields: v.object({
      categoryId: v.optional(v.string()),
      groupId: v.optional(v.string()),
      type: v.optional(enums.LineItemType),
      modelId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      description: v.optional(v.string()),
      quantity: v.number(),
      unitPrice: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      lineTotal: v.optional(v.number()),
      groupName: v.optional(v.string()),
      notes: v.optional(v.string()),
      isOptional: v.optional(v.boolean()),
      showSubhireOnDocs: v.optional(v.boolean()),
      supplierId: v.optional(v.string()),
      subhireOrderNumber: v.optional(v.string()),
    }),
    includeAccessories: v.boolean(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, fields, includeAccessories, actor, auditId, now }) => {
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");

    // Mirrors createLineItem exactly (sortOrder in-mutation, no TOCTOU; permanent
    // accessories expanded as child lines atomically via the shared helper).
    const sortOrder = await nextLineSort(ctx, projectId, organizationId);
    await ctx.db.insert("projectLineItems", {
      id,
      organizationId,
      projectId,
      ...fields,
      status: "CONFIRMED",
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });
    if (includeAccessories && fields.type === "EQUIPMENT" && (fields.assetId || fields.modelId)) {
      await expandAccessoryChildLines(ctx, {
        id,
        assetId: fields.assetId,
        modelId: fields.modelId,
        quantity: fields.quantity,
        categoryId: fields.categoryId,
        groupId: fields.groupId,
        duration: fields.duration,
        pricingType: fields.pricingType,
        organizationId,
        projectId,
      });
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: fields.description || "Line item",
      userId: actor.userId,
      userName: actor.userName,
      summary: "Added line item to project",
      projectId,
      createdAt: now,
    });

    return { id, sortOrder };
  },
});

/**
 * addKitNative — add a kit to a project: parent line + expanded member child lines
 * (ITEMIZED pricing) via the SHARED createKitLineItemCore (same code createKitLineItem
 * runs) + CREATE audit, atomic. RBAC(project, manage_line_items). The kit
 * availability / double-booking check stays server-side; recalc stays server-side.
 */
export const addKitNative = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    kitId: v.string(),
    unitPrice: v.optional(v.number()),
    pricingMode: enums.KitPricingMode,
    groupName: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    groupId: v.optional(v.string()),
    kitLabel: v.string(),
    actor: actorValidator,
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, organizationId, projectId, kitId, unitPrice, pricingMode, groupName, categoryId, groupId, kitLabel, actor, auditId, now }) => {
    await requireOrgPermission(ctx, organizationId, "project", "manage_line_items");

    await createKitLineItemCore(ctx, {
      id, organizationId, projectId, kitId, unitPrice, pricingMode, groupName, categoryId, groupId, now,
    });

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId,
      action: "CREATE",
      entityType: "lineItem",
      entityId: id,
      entityName: kitLabel,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Added kit ${kitLabel} to project`,
      projectId,
      kitId,
      createdAt: now,
    });

    return { id };
  },
});
