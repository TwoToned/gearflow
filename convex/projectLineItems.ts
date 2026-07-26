import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgRead, requireOrgReadDoc, requireService, requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { ensureBulkUnit, ensureSerialisedUnit, expandAccessoryChildLines, syncLineItemRollup } from "./lib/fulfillment";
import { nextOrdinal } from "./lib/lineItemUnits";
import * as enums from "./lib/validators";
import { getKitByCuid } from "./lib/kits";
import { getProjectWindow } from "./lib/projectWindow";

/**
 * Thin CRUD for ProjectLineItem (Convex table "projectLineItems"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Org-scoped reads
 * accept the service token OR a user token scoped to the same org. Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("projectLineItems")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: GDPR org-delete export needs every line item — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

/**
 * Up to `limit` flagged line items (FLAGGED_FAULTY / FLAGGED_TT_OVERDUE) for the
 * notification digest's flagged-asset scan (perf-convex-efficiency-2026-06.md
 * Finding #0b — replaces a whole-org `list()` + JS prepStatus filter). Bounded via
 * `by_organizationId_prepStatus`, oldest-first (matches the old table-scan order).
 */
export const listFlagged = query({
  args: { orgId: v.string(), limit: v.number() },
  handler: async (ctx, { orgId, limit }) => {
    await requireOrgRead(ctx, orgId);
    const FLAGGED_STATUSES = ["FLAGGED_FAULTY", "FLAGGED_TT_OVERDUE"] as const;
    const rows = (
      await Promise.all(
        FLAGGED_STATUSES.map((prepStatus) =>
          ctx.db
            .query("projectLineItems")
            .withIndex("by_organizationId_prepStatus", (q) => q.eq("organizationId", orgId).eq("prepStatus", prepStatus))
            .take(limit),
        ),
      )
    ).flat();
    return rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).slice(0, limit);
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
    const rows = await ctx.db
      .query("projectLineItems")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect();
    // `requireOrgRead` proves the CALLER belongs to `orgId`. It says nothing about
    // whether `projectId` does — and it short-circuits entirely for the service
    // token. Without this row filter, a foreign projectId returns another org's
    // line items. The sibling bundles (projectDetail, equipmentTab) cross-check too.
    return rows.filter((r) => r.organizationId === orgId);
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
      // by_cuid is a GLOBAL index; requireOrgRead only authorizes the CALLER's org, so
      // a caller-supplied foreign cuid would otherwise leak another org's line item.
      if (doc && doc.organizationId === orgId) out.push(doc);
    }
    return out;
  },
});

/**
 * Line items for a fixed set of project ids (single round trip). Used by the
 * warehouse-display dashboard to count items per dispatch/return/prep project
 * without scanning the whole org's line-item table on a public endpoint — only
 * the handful of projects the dashboard renders are queried, each via the
 * `by_projectId` index. Org-scoped: `requireOrgRead` authorizes the CALLER's org, and
 * every returned row is re-checked to belong to it — `by_projectId` is a GLOBAL index,
 * so a caller-supplied foreign projectId would otherwise leak another org's line items
 * (same footgun as `listByProject`).
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
      for (const r of rows) if (r.organizationId === orgId) out.push(r);
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

/**
 * Create N project line items in ONE array mutation (bulk single-call invariant,
 * Phase 3) — replaces the WooCommerce order-ingest server loop firing one `create`
 * per matched product (N round-trips). `organizationId` is stamped from the ARG
 * onto every row (a caller can't smuggle a per-row org), and each row is inserted
 * only if its id is new (idempotent on retry). Mirrors
 * modelCheckItems.createManyIfMissing. Returns how many were created.
 */
export const createMany = mutation({
  args: {
    organizationId: v.string(),
    rows: v.array(
      v.object({
        id: v.string(),
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
      }),
    ),
  },
  handler: async (ctx, { organizationId, rows }) => {
    await requireService(ctx);
    let created = 0;
    for (const r of rows) {
      const existing = await ctx.db
        .query("projectLineItems")
        .withIndex("by_cuid", (q) => q.eq("id", r.id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("projectLineItems", { ...r, organizationId });
      created++;
    }
    return { created };
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
  // Max sortOrder for the project = desc-first on by_projectId_sortOrder (1 doc),
  // instead of collecting ALL the project's lines to reduce the max (O(N) per add,
  // O(N^2) across a bulk add). projectId is org-scoped, so the org check is defensive.
  const top = await ctx.db
    .query("projectLineItems")
    .withIndex("by_projectId_sortOrder", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
  return ((top && top.organizationId === organizationId ? top.sortOrder : undefined) ?? -1) + 1;
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
    accessoryPlan: v.optional(enums.AccessoryPlanArg),
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
      accessoryPlan: a.accessoryPlan,
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
        accessoryPlan: a.accessoryPlan ?? null,
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
    return createKitLineItemCore(ctx, a);
  },
});

/**
 * Kit-line expansion core (extracted so the native addKitNative in
 * convex/lineItemWrites.ts reuses the EXACT parent + member-child creation +
 * ITEMIZED pricing rather than duplicating it). Inserts the kit parent line + one
 * child line per serialized / bulk member, computing sortOrder in-mutation.
 */
/**
 * Guard the line-item create paths against inserting into ANOTHER org's project. The
 * create mutations take `projectId` from the browser; `requireOrgPermission` only
 * authorizes the CALLER's org, and `recalcProjectTotals` sweeps lines `by_projectId`
 * with NO org filter — so a line inserted into a FOREIGN project (stamped with the
 * caller's org) would be swept into that project's org's totals and corrupt them.
 * Rejects only when the project EXISTS in a different org: a non-existent projectId has
 * no recalc target (recalc returns early on a missing project) and thus no victim, so
 * it's left permissive to avoid over-constraining callers/fixtures.
 */
export async function assertProjectInOrg(
  ctx: MutationCtx,
  projectId: string,
  orgId: string,
): Promise<void> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  if (project && project.organizationId !== orgId) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Forbidden: project belongs to another organization." });
  }
}

export async function createKitLineItemCore(
  ctx: MutationCtx,
  a: {
    id: string;
    organizationId: string;
    projectId: string;
    kitId: string;
    unitPrice?: number;
    /** Flat dollar amount off `unitPrice`, KIT_PRICE mode only — mirrors how
     *  discount already works for equipment/custom line items. */
    discount?: number;
    pricingMode: "KIT_PRICE" | "ITEMIZED";
    groupName?: string;
    categoryId?: string;
    groupId?: string;
    now: number;
  },
): Promise<{ id: string }> {
    await assertProjectInOrg(ctx, a.projectId, a.organizationId);
    const kit = await getKitByCuid(ctx, a.kitId);
    if (!kit || kit.organizationId !== a.organizationId) throw new ConvexError("Kit not found");
    let sort = await nextLineSort(ctx, a.projectId, a.organizationId);

    // Discount only means anything alongside a flat unitPrice (KIT_PRICE mode) —
    // ITEMIZED kits have no parent-row price to discount against.
    const kitLineTotal =
      a.unitPrice != null ? Math.max(0, a.unitPrice - (a.discount ?? 0)) : a.unitPrice;

    await ctx.db.insert("projectLineItems", {
      id: a.id, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT", kitId: a.kitId,
      description: `${kit.assetTag} - ${kit.name}`, quantity: 1, unitPrice: a.unitPrice, pricingType: "PER_DAY",
      duration: 1, discount: a.unitPrice != null ? a.discount : undefined, lineTotal: kitLineTotal, sortOrder: sort++, pricingMode: a.pricingMode,
      groupName: a.groupName, categoryId: a.categoryId, groupId: a.groupId, status: "CONFIRMED",
      createdAt: a.now, updatedAt: a.now,
    });

    const itemized = a.pricingMode === "ITEMIZED";
    const serialized = await ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect();
    for (const si of serialized) {
      const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", si.assetId)).unique();
      const model = asset?.modelId ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", asset.modelId!)).unique() : null;
      const childPrice = itemized && model?.defaultRentalPrice != null ? Number(model.defaultRentalPrice) : undefined;
      const childId = createId();
      await ctx.db.insert("projectLineItems", {
        id: childId, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT",
        modelId: asset?.modelId, assetId: si.assetId, description: model?.name ?? asset?.modelId ?? "",
        quantity: 1, unitPrice: childPrice, pricingType: "PER_DAY", duration: 1, lineTotal: childPrice,
        sortOrder: sort++, isKitChild: true, parentLineItemId: a.id, status: "CONFIRMED", createdAt: a.now, updatedAt: a.now,
      });
      // Kit per-unit fulfillment (Phase 1): seed the member's unit row at kit-add,
      // in CONFIRMED state, so serials are visible/trackable per job exactly like
      // loose gear. Prep/checkout/checkin patch this row. See
      // docs/designs/kit-per-unit-fulfillment.md.
      await ensureSerialisedUnit(ctx, { organizationId: a.organizationId, lineItemId: childId, assetId: si.assetId });
    }
    const bulk = await ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", a.kitId)).collect();
    for (const bi of bulk) {
      const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", bi.bulkAssetId)).unique();
      const model = ba?.modelId ? await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", ba.modelId!)).unique() : null;
      const childTotal = itemized && model?.defaultRentalPrice != null ? Number(model.defaultRentalPrice) * bi.quantity : undefined;
      const childId = createId();
      await ctx.db.insert("projectLineItems", {
        id: childId, organizationId: a.organizationId, projectId: a.projectId, type: "EQUIPMENT",
        modelId: ba?.modelId, bulkAssetId: bi.bulkAssetId, description: `${bi.quantity}x ${model?.name ?? ba?.modelId ?? ""}`,
        quantity: bi.quantity, unitPrice: childTotal != null ? childTotal / bi.quantity : undefined, pricingType: "PER_DAY",
        duration: 1, lineTotal: childTotal, sortOrder: sort++, isKitChild: true, parentLineItemId: a.id,
        status: "CONFIRMED", createdAt: a.now, updatedAt: a.now,
      });
      // Kit per-unit fulfillment (Phase 1): seed the bulk member's unit (one row
      // carrying quantity, like a loose bulk line).
      await ensureBulkUnit(ctx, { organizationId: a.organizationId, lineItemId: childId, bulkAssetId: bi.bulkAssetId, quantity: bi.quantity });
    }
    return { id: a.id };
}

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

/**
 * Cascade-delete a line: its children (+ all units), then the line (+ its units).
 * Extracted as a plain function so mutations that can't call another mutation
 * (Convex forbids mutation→mutation) — e.g. projectWrites.deleteNative — reuse the
 * EXACT child-scan + unit-purge. Callers org-scope the line before invoking.
 */
export async function removeLineItemCascadeCore(ctx: MutationCtx, id: string): Promise<void> {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  if (!line) throw new ConvexError("projectLineItems not found: " + id);
  const children = await ctx.db
    .query("projectLineItems")
    .withIndex("by_parentLineItemId", (q) => q.eq("parentLineItemId", id))
    .collect();
  for (const c of children) await deleteLineWithUnits(ctx, c._id, c.id);
  await deleteLineWithUnits(ctx, line._id, line.id);
}

/** Cascade delete a line: its children (+ all units), then the line (+ its units). */
export const removeLineItemCascade = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    await removeLineItemCascadeCore(ctx, id);
  },
});

// ─── Bulk (multi-select) operations ────────────────────────────────────────
/** Atomic reorder: assign sortOrder = index (+ optional groupName) per id. */
export const reorderLineItems = mutation({
  args: {
    orgId: v.string(),
    items: v.array(v.object({ id: v.string(), sortOrder: v.number(), groupName: v.optional(v.string()) })),
    now: v.number(),
  },
  handler: async (ctx, { orgId, items, now }) => {
    await requireService(ctx);
    for (const it of items) {
      const doc = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", it.id)).unique();
      // Per-item org re-check: by_cuid is a GLOBAL index, so without this a caller
      // could reorder another org's line items (mirrors reorderNative's guard).
      if (doc && doc.organizationId === orgId) await ctx.db.patch(doc._id, { sortOrder: it.sortOrder, groupName: it.groupName, updatedAt: now });
    }
  },
});

// ── Group G: asset reassignment (double-booking gate) + split-sibling merge ────

const DEAD_PROJECT_STATUSES = new Set(["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"]);

/** Reassign a line's asset, re-checking free-in-window + writing in ONE mutation
 *  (the double-booking TOCTOU guard — OCC makes the check+write race-safe). */
export const swapLineItemAsset = mutation({
  returns: v.object({ lineItemId: v.string(), assetId: v.string() }),
  args: {
    organizationId: v.string(),
    lineItemId: v.string(),
    newAssetId: v.string(),
    now: v.number(),
    actor: v.object({ userId: v.string(), userName: v.string() }),
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    // Browser-direct (Phase 3 — replaces the swapLineItemAsset server action). Gates on
    // project:manage_line_items (it reassigns a line item's asset). The authoritative
    // double-booking guard + write below stay atomic (OCC re-check + patch, race-safe).
    await assertWritesEnabled(ctx, "lineItem");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.organizationId, "project", "manage_line_items");
    const actor = await resolveActor(ctx, a.actor);
    const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", a.lineItemId)).unique();
    if (!line || line.organizationId !== a.organizationId) throw new ConvexError("Line item not found");
    const newAsset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", a.newAssetId)).unique();
    if (!newAsset || newAsset.organizationId !== a.organizationId) throw new ConvexError("Target asset not found");
    if (line.modelId && newAsset.modelId !== line.modelId) throw new ConvexError("Target asset is a different model");
    if (newAsset.kitId) throw new ConvexError(`Asset ${newAsset.assetTag} is part of a kit and can't be assigned directly`);
    if (newAsset.status === "RETIRED" || newAsset.status === "LOST") throw new ConvexError(`Asset ${newAsset.assetTag} is ${(newAsset.status as string).toLowerCase()}`);

    const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", line.projectId)).unique();
    const startMs = project?.rentalStartDate ?? null;
    const endMs = project?.rentalEndDate ?? null;
    if (startMs != null && endMs != null) {
      // Range-scan only projects that could overlap [startMs, endMs] — instead of
      // collecting the whole org projects table on every asset reassign. TWO scans
      // (WS2 #941): rentalStartDate <= endMs (as before — its unbounded-below range
      // also sweeps in projectStartDate-unset rows, since undefined sorts first in a
      // Convex index) PLUS projectStartDate <= endMs, so a candidate whose PROJECT
      // window (e.g. an early load-in) starts before endMs is found even when its
      // rental window starts later. The JS getProjectWindow overlap check completes
      // the test on the merged candidate set; null-window projects are excluded.
      const candidates = new Map<string, Doc<"projects">>();
      for await (const p of ctx.db
        .query("projects")
        .withIndex("by_organizationId_rentalStartDate", (q) =>
          q.eq("organizationId", a.organizationId).lte("rentalStartDate", endMs),
        )) {
        candidates.set(p.id, p);
      }
      for await (const p of ctx.db
        .query("projects")
        .withIndex("by_organizationId_projectStartDate", (q) =>
          q.eq("organizationId", a.organizationId).lte("projectStartDate", endMs),
        )) {
        candidates.set(p.id, p);
      }
      const overlapping = new Set<string>();
      for (const p of candidates.values()) {
        if (p.isTemplate) continue;
        if (DEAD_PROJECT_STATUSES.has(p.status ?? "")) continue;
        const { start: s, end: e } = getProjectWindow(p);
        if (s == null || e == null) continue;
        if (s <= endMs && e >= startMs) overlapping.add(p.id);
      }
      if (overlapping.size > 0) {
        const lineConflict = (await ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", a.newAssetId)).collect())
          .some((li) => li.organizationId === a.organizationId && li.status !== "CANCELLED" && li.id !== a.lineItemId && overlapping.has(li.projectId));
        let unitConflict = false;
        if (!lineConflict) {
          const units = (await ctx.db.query("projectLineItemUnits").withIndex("by_assetId", (q) => q.eq("assetId", a.newAssetId)).collect())
            .filter((u) => u.organizationId === a.organizationId && u.status !== "RETURNED" && u.lineItemId !== a.lineItemId);
          for (const u of units) {
            const ul = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", u.lineItemId)).unique();
            if (ul && ul.status !== "CANCELLED" && overlapping.has(ul.projectId)) { unitConflict = true; break; }
          }
        }
        if (lineConflict || unitConflict) throw new ConvexError(`Asset ${newAsset.assetTag} is already booked during this window`);
      }
    }
    await ctx.db.patch(line._id, { assetId: a.newAssetId, updatedAt: a.now });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.organizationId,
      action: "UPDATE",
      entityType: "project",
      entityId: line.projectId,
      projectId: line.projectId,
      entityName: newAsset.assetTag ?? "line item",
      userId: actor.userId,
      userName: actor.userName,
      summary: `Swapped a conflicting line item onto asset ${newAsset.assetTag ?? a.newAssetId}`,
      createdAt: a.now,
    });

    return { lineItemId: a.lineItemId, assetId: a.newAssetId };
  },
});

/** Split-sibling collapse: move a sibling's units to the canonical line, repoint
 *  its check records, write the audit row, deactivate the sibling, bump canonical
 *  quantity — all atomic. (projectService repoint stays Prisma in the action.) */
export const mergeGroup = mutation({
  args: {
    organizationId: v.string(),
    canonicalId: v.string(),
    key: v.string(),
    runId: v.string(),
    moves: v.array(v.object({ siblingId: v.string(), assetId: v.optional(v.string()), bulkAssetId: v.optional(v.string()), quantity: v.number() })),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await requireService(ctx);
    // Scope the whole merge to the caller's org: by_cuid is a GLOBAL index, so verify
    // the canonical belongs to a.organizationId, and skip any sibling that doesn't —
    // BEFORE touching its units/check-records (they're fetched by the sibling id).
    const canon = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", a.canonicalId)).unique();
    if (!canon || canon.organizationId !== a.organizationId) throw new ConvexError("Forbidden: organization mismatch.");
    const canonicalUnits = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", a.canonicalId)).collect();
    const usedOrdinals = new Set(canonicalUnits.map((u) => u.ordinal));
    let quantityAdded = 0;

    for (const move of a.moves) {
      const sib = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", move.siblingId)).unique();
      if (!sib || sib.organizationId !== a.organizationId) continue; // per-item org re-check
      let unit: typeof canonicalUnits[number] | null = null;
      if (move.assetId) {
        unit = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId_assetId", (q) => q.eq("lineItemId", move.siblingId).eq("assetId", move.assetId!)).unique();
      } else if (move.bulkAssetId) {
        unit = (await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", move.siblingId)).collect()).find((u) => u.bulkAssetId === move.bulkAssetId) ?? null;
      }
      let movedUnitId: string | null = null;
      if (unit) {
        let ord = nextOrdinal([...usedOrdinals].map((o) => ({ ordinal: o })));
        while (usedOrdinals.has(ord)) ord += 1;
        usedOrdinals.add(ord);
        await ctx.db.patch(unit._id, { lineItemId: a.canonicalId, ordinal: ord, updatedAt: a.now });
        movedUnitId = unit.id;
      }
      // Repoint check records (Convex) — matched-asset/bulk rows also get lineItemUnitId.
      const crs = await ctx.db.query("checkRecords").withIndex("by_lineItemId", (q) => q.eq("lineItemId", move.siblingId)).collect();
      for (const cr of crs) {
        const matched = !!movedUnitId && (move.assetId ? cr.assetId === move.assetId : cr.bulkAssetId === move.bulkAssetId);
        await ctx.db.patch(cr._id, { lineItemId: a.canonicalId, ...(matched ? { lineItemUnitId: movedUnitId! } : {}) });
      }
      // Audit row (permanent).
      await ctx.db.insert("lineItemMergeMaps", {
        id: createId(), organizationId: a.organizationId, oldLineItemId: move.siblingId, canonicalLineItemId: a.canonicalId,
        movedUnitId: movedUnitId ?? undefined, checkRecordsRepointed: crs.length, serviceRepointed: false,
        notes: `${a.runId} | key=${a.key}`, mergedAt: a.now,
      });
      // Deactivate the sibling (keep row, drop booking footprint). `sib` is fetched +
      // org-verified at the top of the loop.
      const { _id, _creationTime, assetId: _a, bulkAssetId: _b, ...rest } = sib;
      await ctx.db.replace(_id, { ...rest, quantity: 0, status: "CANCELLED", notes: `[merged into ${a.canonicalId} (${a.runId})]`, updatedAt: a.now });
      quantityAdded += move.quantity;
    }

    // `canon` fetched + org-verified at the top.
    await ctx.db.patch(canon._id, { quantity: (canon.quantity ?? 0) + quantityAdded, updatedAt: a.now });
    await syncLineItemRollup(ctx, a.canonicalId);
    return { canonicalId: a.canonicalId };
  },
});

// ── CUSTOM (Phase C H) — relation lookups for delete-guards ──
export const listByAssetId = query({
  args: { assetId: v.string(), orgId: v.string() },
  handler: async (ctx, { assetId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return (await ctx.db.query("projectLineItems").withIndex("by_assetId", (q) => q.eq("assetId", assetId)).collect())
      .filter((r) => r.organizationId === orgId);
  },
});

/**
 * Line items referencing ONE model (via by_modelId), org-filtered. Replaces a
 * whole-org `projectLineItems.list` + JS `.filter(li => li.modelId === …)` on the
 * model-level availability check in addLineItem.
 */
export const listByModelId = query({
  args: { modelId: v.string(), orgId: v.string() },
  handler: async (ctx, { modelId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return (await ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", modelId)).collect())
      .filter((r) => r.organizationId === orgId);
  },
});

/**
 * Line items referencing ANY of the given models (batched by_modelId scans in one
 * round-trip), org-filtered. Replaces a whole-org `projectLineItems.list` that
 * availability (computeOverbookedStatus) collected then JS-filtered by the project's
 * models. Deduped + capped.
 */
export const listByModelIds = query({
  args: { modelIds: v.array(v.string()), orgId: v.string() },
  handler: async (ctx, { modelIds, orgId }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(modelIds)];
    if (unique.length > 1000) throw new ConvexError("projectLineItems.listByModelIds: too many modelIds (max 1000)");
    const groups = await Promise.all(
      unique.map((mid) => ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", mid)).collect()),
    );
    return groups.flat().filter((r) => r.organizationId === orgId);
  },
});

// ── CUSTOM (Phase C H) — by-kit lookup for kit delete-guards ──
export const listByKitId = query({
  args: { kitId: v.string(), orgId: v.string() },
  handler: async (ctx, { kitId, orgId }) => {
    await requireOrgRead(ctx, orgId);
    return (await ctx.db.query("projectLineItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect())
      .filter((r) => r.organizationId === orgId);
  },
});
