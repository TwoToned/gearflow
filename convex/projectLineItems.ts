import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for ProjectLineItem (Convex table "projectLineItems"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projectLineItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projectLineItems", args);
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectLineItems not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("projectLineItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
