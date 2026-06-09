import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ProjectLineItem (Convex table "projectLineItems"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("projectLineItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectId: v.string(),
    type: v.optional(enums.LineItemType),
    modelId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    bulkAssetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    isKitChild: v.optional(v.boolean()),
    childKind: v.optional(enums.LineItemChildKind),
    parentLineItemId: v.optional(v.string()),
    pricingMode: v.optional(enums.KitPricingMode),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
    pricingType: v.optional(enums.PricingType),
    duration: v.optional(v.number()),
    discount: v.optional(v.number()),
    lineTotal: v.optional(v.number()),
    priceBreakdown: v.optional(v.string()),
    priceOverridden: v.optional(v.boolean()),
    overrideReason: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    groupName: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    groupId: v.optional(v.string()),
    notes: v.optional(v.string()),
    isOptional: v.optional(v.boolean()),
    status: v.optional(enums.LineItemStatus),
    checkedOutQuantity: v.optional(v.number()),
    returnedQuantity: v.optional(v.number()),
    assignedQuantity: v.optional(v.number()),
    packedQuantity: v.optional(v.number()),
    damagedQuantity: v.optional(v.number()),
    lostQuantity: v.optional(v.number()),
    checkedOutAt: v.optional(v.number()),
    checkedOutById: v.optional(v.string()),
    returnedAt: v.optional(v.number()),
    returnedById: v.optional(v.string()),
    returnCondition: v.optional(enums.ReturnCondition),
    returnNotes: v.optional(v.string()),
    prepStatus: v.optional(enums.PrepStatus),
    prepContainer: v.optional(v.string()),
    isContainerLineItem: v.optional(v.boolean()),
    isCustomItem: v.optional(v.boolean()),
    returnStatus: v.optional(enums.ReturnStatus),
    showSubhireOnDocs: v.optional(v.boolean()),
    supplierId: v.optional(v.string()),
    subhireOrderNumber: v.optional(v.string()),
    supplierOrderId: v.optional(v.string()),
    subHireId: v.optional(v.string()),
    subHireItemId: v.optional(v.string()),
    subHireGroupId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => await ctx.db.insert("projectLineItems", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      type: v.optional(enums.LineItemType),
      modelId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      kitId: v.optional(v.string()),
      isKitChild: v.optional(v.boolean()),
      childKind: v.optional(enums.LineItemChildKind),
      parentLineItemId: v.optional(v.string()),
      pricingMode: v.optional(enums.KitPricingMode),
      description: v.optional(v.string()),
      quantity: v.optional(v.number()),
      unitPrice: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      lineTotal: v.optional(v.number()),
      priceBreakdown: v.optional(v.string()),
      priceOverridden: v.optional(v.boolean()),
      overrideReason: v.optional(v.string()),
      sortOrder: v.optional(v.number()),
      groupName: v.optional(v.string()),
      categoryId: v.optional(v.string()),
      groupId: v.optional(v.string()),
      notes: v.optional(v.string()),
      isOptional: v.optional(v.boolean()),
      status: v.optional(enums.LineItemStatus),
      checkedOutQuantity: v.optional(v.number()),
      returnedQuantity: v.optional(v.number()),
      assignedQuantity: v.optional(v.number()),
      packedQuantity: v.optional(v.number()),
      damagedQuantity: v.optional(v.number()),
      lostQuantity: v.optional(v.number()),
      checkedOutAt: v.optional(v.number()),
      checkedOutById: v.optional(v.string()),
      returnedAt: v.optional(v.number()),
      returnedById: v.optional(v.string()),
      returnCondition: v.optional(enums.ReturnCondition),
      returnNotes: v.optional(v.string()),
      prepStatus: v.optional(enums.PrepStatus),
      prepContainer: v.optional(v.string()),
      isContainerLineItem: v.optional(v.boolean()),
      isCustomItem: v.optional(v.boolean()),
      returnStatus: v.optional(enums.ReturnStatus),
      showSubhireOnDocs: v.optional(v.boolean()),
      supplierId: v.optional(v.string()),
      subhireOrderNumber: v.optional(v.string()),
      supplierOrderId: v.optional(v.string()),
      subHireId: v.optional(v.string()),
      subHireItemId: v.optional(v.string()),
      subHireGroupId: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectLineItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectLineItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
