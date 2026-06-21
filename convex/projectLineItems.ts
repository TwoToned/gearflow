import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import { expandAccessoryChildLines } from "./lib/fulfillment";
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

export const listByProject = query({
  args: { projectId: v.string(), orgId: v.string() },
  handler: async (ctx, { projectId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projectLineItems")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

/**
 * Fetch a batch of line items by their cuids (one by_cuid lookup per id).
 * Backs getCheckHistory's lineItemId → projectId resolution (Phase A). Misses
 * are skipped. Org-scoped read.
 */
export const listByIds = query({
  args: { ids: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { ids, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const out = [];
    for (const id of ids) {
      const doc = await ctx.db
        .query("projectLineItems")
        .withIndex("by_cuid", (q) => q.eq("id", id))
        .unique();
      if (doc) out.push(doc);
    }
    return out;
  },
});

/**
 * Line items for a fixed set of project ids (single round trip). Used by the
 * warehouse-display dashboard to count items per dispatch/return/prep project
 * without scanning the whole org's line-item table on a public endpoint — only
 * the handful of projects the dashboard renders are queried, each via the
 * `by_projectId` index. Org-scoped: caller passes the org id so the service /
 * user token is authorized, and every returned row is its own project's.
 */
export const listByProjectIds = query({
  args: { orgId: v.string(), projectIds: v.array(v.string()) },
  handler: async (ctx, { orgId, projectIds }) => {
    await requireOrgRead(ctx, orgId);
    const out = [];
    for (const projectId of projectIds) {
      const rows = await ctx.db
        .query("projectLineItems")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect();
      for (const r of rows) out.push(r);
    }
    return out;
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

export const createIfMissing = mutation({
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
    const existing = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projectLineItems", args);
    return { _id, created: true };
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
    if (!doc) throw new ConvexError("projectLineItems not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectLineItems not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ── CUSTOM (Phase C — core mega-flip) — re-add on regen ──────────────────────
// Line-item CRUD. Pricing/availability are resolved in the server action (Convex
// reads); these mutations own the atomic write: maxSort in-mutation (no TOCTOU),
// accessory expansion + cascade delete in one transaction.
// ─────────────────────────────────────────────────────────────────────────────

async function nextLineSort(ctx: MutationCtx, projectId: string, organizationId: string): Promise<number> {
  const lines = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();
  return lines
    .filter((l) => l.organizationId === organizationId)
    .reduce((m, l) => Math.max(m, l.sortOrder ?? -1), -1) + 1;
}

async function deleteLineWithUnits(ctx: MutationCtx, lineDocId: import("./_generated/dataModel").Id<"projectLineItems">, lineCuid: string) {
  const units = await ctx.db
    .query("projectLineItemUnits")
    .withIndex("by_lineItemId", (q) => q.eq("lineItemId", lineCuid))
    .collect();
  for (const u of units) await ctx.db.delete(u._id);
  await ctx.db.delete(lineDocId);
}

const LINE_NEVER_CLEAR = new Set(["id", "organizationId", "projectId"]);

/** Create a line (sortOrder in-mutation) + optionally expand permanent accessories. */
export const createLineItem = mutation({
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
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const sortOrder = await nextLineSort(ctx, a.projectId, a.organizationId);
    await ctx.db.insert("projectLineItems", {
      id: a.id,
      organizationId: a.organizationId,
      projectId: a.projectId,
      ...a.fields,
      status: "CONFIRMED",
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });
    if (a.includeAccessories && a.fields.type === "EQUIPMENT" && (a.fields.assetId || a.fields.modelId)) {
      await expandAccessoryChildLines(ctx, {
        id: a.id,
        assetId: a.fields.assetId,
        modelId: a.fields.modelId,
        quantity: a.fields.quantity,
        categoryId: a.fields.categoryId,
        groupId: a.fields.groupId,
        duration: a.fields.duration,
        pricingType: a.fields.pricingType,
        organizationId: a.organizationId,
        projectId: a.projectId,
      });
    }
    return { id: a.id, sortOrder };
  },
});

/** Create a custom (non-equipment) line. */
export const createCustomLineItem = mutation({
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
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const sortOrder = await nextLineSort(ctx, a.projectId, a.organizationId);
    await ctx.db.insert("projectLineItems", {
      id: a.id,
      organizationId: a.organizationId,
      projectId: a.projectId,
      type: "EQUIPMENT",
      isCustomItem: true,
      ...a.fields,
      sortOrder,
      createdAt: a.now,
      updatedAt: a.now,
    });
    return { id: a.id, sortOrder };
  },
});

/**
 * Create a kit line: parent + a child line per serialised/bulk member, read from
 * the kit's Convex member rows. ITEMIZED pricing pulls child prices from the
 * member model's defaultRentalPrice. maxSort in-mutation.
 */
export const createKitLineItem = mutation({
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
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", a.kitId)).unique();
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    let sort = await nextLineSort(ctx, a.projectId, a.organizationId);

    await ctx.db.insert("projectLineItems", {
      id: a.id, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT", kitId: a.kitId,
      description: `${kit.assetTag} - ${kit.name}`, quantity: 1, unitPrice: a.unitPrice, pricingType: "PER_DAY",
      duration: 1, lineTotal: a.unitPrice, sortOrder: sort++, pricingMode: a.pricingMode,
      groupName: a.groupName, categoryId: a.categoryId, groupId: a.groupId, status: "CONFIRMED",
      createdAt: a.now, updatedAt: a.now,
    });

    const itemized = a.pricingMode === "ITEMIZED";
    const serialized = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect();
    for (const si of serialized) {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", si.assetId)).unique();
      const model = asset?.modelId ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", asset.modelId!)).unique() : null;
      const childPrice = itemized && model?.defaultRentalPrice != null ? Number(model.defaultRentalPrice) : undefined;
      await ctx.db.insert("projectLineItems", {
        id: createId(), organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT",
        modelId: asset?.modelId, assetId: si.assetId, description: model?.name ?? asset?.modelId ?? "",
        quantity: 1, unitPrice: childPrice, pricingType: "PER_DAY", duration: 1, lineTotal: childPrice,
        sortOrder: sort++, isKitChild: true, parentLineItemId: a.id, status: "CONFIRMED", createdAt: a.now, updatedAt: a.now,
      });
    }
    const bulk = await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect();
    for (const bi of bulk) {
      const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bi.bulkAssetId)).unique();
      const model = ba?.modelId ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", ba.modelId!)).unique() : null;
      const childTotal = itemized && model?.defaultRentalPrice != null ? Number(model.defaultRentalPrice) * bi.quantity : undefined;
      await ctx.db.insert("projectLineItems", {
        id: createId(), organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT",
        modelId: ba?.modelId, bulkAssetId: bi.bulkAssetId, description: `${bi.quantity}x ${model?.name ?? ba?.modelId ?? ""}`,
        quantity: bi.quantity, unitPrice: childTotal != null ? childTotal / bi.quantity : undefined, pricingType: "PER_DAY",
        duration: 1, lineTotal: childTotal, sortOrder: sort++, isKitChild: true, parentLineItemId: a.id,
        status: "CONFIRMED", createdAt: a.now, updatedAt: a.now,
      });
    }
    return { id: a.id };
  },
});

/** Clear-to-null patch for a line (edit dialog: omit assoc fields to keep, clear to null). */
export const patchLineItem = mutation({
  args: {
    id: v.string(),
    set: v.object({
      type: v.optional(enums.LineItemType),
      modelId: v.optional(v.string()),
      assetId: v.optional(v.string()),
      bulkAssetId: v.optional(v.string()),
      description: v.optional(v.string()),
      quantity: v.optional(v.number()),
      unitPrice: v.optional(v.number()),
      pricingType: v.optional(enums.PricingType),
      duration: v.optional(v.number()),
      discount: v.optional(v.number()),
      lineTotal: v.optional(v.number()),
      groupName: v.optional(v.string()),
      categoryId: v.optional(v.string()),
      groupId: v.optional(v.string()),
      notes: v.optional(v.string()),
      isOptional: v.optional(v.boolean()),
      showSubhireOnDocs: v.optional(v.boolean()),
      supplierId: v.optional(v.string()),
      subhireOrderNumber: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
    clear: v.array(v.string()),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projectLineItems not found: " + id);
    if (clear.length === 0) {
      await ctx.db.patch(doc._id, set);
      return doc._id;
    }
    const { _id, _creationTime, ...rest } = doc;
    const merged: Record<string, unknown> = { ...rest, ...set };
    for (const k of clear) {
      if (LINE_NEVER_CLEAR.has(k)) continue;
      delete merged[k];
    }
    await ctx.db.replace(doc._id, merged as typeof rest);
    return doc._id;
  },
});

/** Cascade delete a line: its children (+ all units), then the line (+ its units). */
export const removeLineItemCascade = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!line) throw new ConvexError("projectLineItems not found: " + id);
    const children = await ctx.db
      .query("projectLineItems")
      .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", id))
      .collect();
    for (const c of children) await deleteLineWithUnits(ctx, c._id, c.id);
    await deleteLineWithUnits(ctx, line._id, line.id);
  },
});

/** Atomic reorder: assign sortOrder = index (+ optional groupName) per id. */
export const reorderLineItems = mutation({
  args: {
    items: v.array(v.object({ id: v.string(), sortOrder: v.number(), groupName: v.optional(v.string()) })),
    now: v.number(),
  },
  handler: async (ctx, { items, now }) => {
    await requireService(ctx);
    for (const it of items) {
      const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", it.id)).unique();
      if (doc) await ctx.db.patch(doc._id, { sortOrder: it.sortOrder, groupName: it.groupName, updatedAt: now });
    }
  },
});
