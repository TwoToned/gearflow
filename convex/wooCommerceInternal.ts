import { v, ConvexError } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import * as enums from "./lib/validators";
import { bumpCountersForTable } from "./lib/counters";
import { recalcProjectTotals } from "./lib/recalc";
import { projectWriteFields } from "./projects";

/**
 * UNGUARDED internal wrappers for the WooCommerce webhook ingress + order
 * processing (Convex-native migration).
 *
 * `internalQuery` / `internalMutation` are UNREACHABLE from clients by construction
 * (they never appear on the public `api` — only on `internal`), so — unlike the
 * service-gated `api.*` CRUD — they carry NO `requireService`: the httpAction
 * (convex/http.ts) and the scheduled `processOrder` action
 * (convex/wooCommerceActions.ts) can invoke them with no auth identity. That is the
 * whole point: a webhook-triggered action has no SERVICE token to present.
 *
 * Each handler body below is copied VERBATIM from its service-gated `api.*` twin —
 * same field validators, same defaults, same return shape — with ONLY the
 * `requireService(ctx)` (or `requireOrgRead` / `requireOrgReadDoc` /
 * `requireOrgPermission`) line removed. The recalc math is the shared pure helper
 * `recalcProjectTotals` (convex/lib/recalc.ts), so totals stay byte-identical.
 */

// ─── organizations (mirror of src/lib/single-org.ts getTheOrg) ──────────────

/**
 * The single organization row (or null). This app enforces exactly one org
 * (src/lib/single-org.ts). Lets the webhook ingress distinguish "No organization
 * configured" from "Integration not enabled" the way the Next route does.
 */
export const getSingleOrg = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("organizations").first(),
});

// ─── wooCommerceIntegrations ────────────────────────────────────────────────

/** Twin of api.wooCommerceIntegrations.list(orgId)[0] / the getWooCommerceIntegrationByOrg helper. */
export const getIntegrationByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("wooCommerceIntegrations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .first(),
});

/** Twin of api.wooCommerceIntegrations.getById. */
export const getIntegrationById = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

/** Twin of api.wooCommerceIntegrations.update, narrowed to the lastPayload patch the ingress writes. */
export const updateIntegrationLastPayload = internalMutation({
  args: { id: v.string(), lastPayload: v.any(), updatedAt: v.number() },
  handler: async (ctx, { id, lastPayload, updatedAt }) => {
    const doc = await ctx.db.query("wooCommerceIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("wooCommerceIntegrations not found: " + id);
    await ctx.db.patch(doc._id, { lastPayload, updatedAt });
    return doc._id;
  },
});

// ─── wooCommerceOrderLogs ───────────────────────────────────────────────────

/** Twin of api.wooCommerceOrderLogs.create. */
export const createLog = internalMutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    wooOrderId: v.number(),
    wooOrderNumber: v.optional(v.string()),
    status: enums.WooOrderLogStatus,
    projectId: v.optional(v.string()),
    clientId: v.optional(v.string()),
    payload: v.any(),
    errorMessage: v.optional(v.string()),
    matchResults: v.optional(v.any()),
    dateExtraction: v.optional(v.any()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("wooCommerceOrderLogs", args);
  },
});

/** Twin of api.wooCommerceOrderLogs.update. */
export const updateLog = internalMutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      wooOrderId: v.optional(v.number()),
      wooOrderNumber: v.optional(v.string()),
      status: v.optional(enums.WooOrderLogStatus),
      projectId: v.optional(v.string()),
      clientId: v.optional(v.string()),
      payload: v.optional(v.any()),
      errorMessage: v.optional(v.string()),
      matchResults: v.optional(v.any()),
      dateExtraction: v.optional(v.any()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("wooCommerceOrderLogs").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("wooCommerceOrderLogs not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

/**
 * The first COMPLETED log for a (org, wooOrderId) — the webhook idempotency check,
 * replacing findCompletedOrderLog (src/lib/woocommerce-order-logs-read.ts). Uses the
 * by_wooOrderId index then filters org + status COMPLETED (same result as the helper's
 * full-org scan + find).
 */
export const findCompletedLogByOrder = internalQuery({
  args: { orgId: v.string(), wooOrderId: v.number() },
  handler: async (ctx, { orgId, wooOrderId }) => {
    const rows = await ctx.db
      .query("wooCommerceOrderLogs")
      .withIndex("by_wooOrderId", (q) => q.eq("wooOrderId", wooOrderId))
      .collect();
    return rows.find((r) => r.organizationId === orgId && r.status === "COMPLETED") ?? null;
  },
});

// ─── clients ────────────────────────────────────────────────────────────────

/** Twin of api.clients.list. */
export const listClientsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("clients")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set
      .collect(),
});

/** Twin of api.clients.getById (minus requireOrgReadDoc). */
export const getClientById = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

// ─── clientContacts (WS9 #948) ──────────────────────────────────────────────

/** Twin of api.clientContacts.listByOrg — widens the WooCommerce email match to
 *  ANY contact's email, not just the legacy embedded clients.contactEmail. */
export const listClientContactsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("clientContacts")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
      .collect(),
});

/** Twin of api.clientContacts.create — used on a fuzzy-company match whose
 *  billing email is unknown to the matched client (spec decision: auto-create an
 *  additional contact tagged from the order, instead of silently losing it). */
export const createClientContact = internalMutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    clientId: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    notes: v.optional(v.string()),
    isPrimary: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clientContacts", args);
  },
});

/** Twin of api.clients.createIfMissing. */
export const createClientIfMissing = internalMutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    type: v.optional(enums.ClientType),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    billingLatitude: v.optional(v.number()),
    billingLongitude: v.optional(v.number()),
    shippingAddress: v.optional(v.string()),
    shippingLatitude: v.optional(v.number()),
    shippingLongitude: v.optional(v.number()),
    taxId: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    defaultDiscount: v.optional(v.number()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("clients").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("clients", args);
    return { _id, created: true };
  },
});

// ─── locations ──────────────────────────────────────────────────────────────

/** Twin of api.locations.list. */
export const listLocationsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("locations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
      .collect(),
});

/** Twin of api.locations.create. */
export const createLocation = internalMutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    type: v.optional(enums.LocationType),
    isDefault: v.optional(v.boolean()),
    parentId: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("locations", args);
  },
});

// ─── models ─────────────────────────────────────────────────────────────────

/** Twin of api.models.list. */
export const listModelsByOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("models")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large — see docs/exceptions.md R-8.3.3
      .collect(),
});

// ─── projects ───────────────────────────────────────────────────────────────

/** Twin of api.projects.getByOrgAndNumber. */
export const getProjectByOrgAndNumber = internalQuery({
  args: { organizationId: v.string(), projectNumber: v.string() },
  handler: async (ctx, { organizationId, projectNumber }) =>
    await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", organizationId).eq("projectNumber", projectNumber),
      )
      .unique(),
});

/** Twin of api.projects.createWithUniqueNumber (verbatim guard + `{created}` return). */
export const createProjectWithUniqueNumber = internalMutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    ...projectWriteFields,
  },
  handler: async (ctx, args) => {
    const clash = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", args.organizationId).eq("projectNumber", args.projectNumber),
      )
      .unique();
    if (clash) return { created: false, id: clash.id };
    await ctx.db.insert("projects", args);
    await bumpCountersForTable(ctx, "projects", null, args);
    return { created: true, id: args.id };
  },
});

// ─── projectLineItems ───────────────────────────────────────────────────────

/** Twin of api.projectLineItems.create (full generated arg validator, plain insert). */
export const createLineItem = internalMutation({
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
    return await ctx.db.insert("projectLineItems", args);
  },
});

// ─── orgSettings ────────────────────────────────────────────────────────────

/** Twin of api.orgSettings.getByOrg. */
export const getOrgSettingsByOrg = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, { organizationId }) =>
    await ctx.db
      .query("orgSettings")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
      .unique(),
});

// ─── recalc (project totals) ────────────────────────────────────────────────

/**
 * Twin of api.lineItemWrites.recalcNative — reuses the SAME pure math
 * (recalcProjectTotals), so totals are byte-identical; only the auth guard
 * (requireOrgPermission) is dropped.
 */
export const recalcProjectTotalsInternal = internalMutation({
  args: {
    projectId: v.string(),
    orgId: v.string(),
    orgDefaultTaxRate: v.union(v.number(), v.null()),
    now: v.number(),
  },
  handler: async (ctx, { projectId, orgId, orgDefaultTaxRate, now }) => {
    await recalcProjectTotals(ctx, projectId, orgId, orgDefaultTaxRate, now);
    return { ok: true as const };
  },
});

// ─── activity log ───────────────────────────────────────────────────────────

const activityLogFields = {
  id: v.string(),
  organizationId: v.string(),
  action: v.string(),
  entityType: v.string(),
  entityId: v.string(),
  entityName: v.string(),
  userId: v.optional(v.string()),
  userName: v.string(),
  summary: v.string(),
  details: v.optional(v.any()),
  metadata: v.optional(v.any()),
  projectId: v.optional(v.string()),
  assetId: v.optional(v.string()),
  kitId: v.optional(v.string()),
  createdAt: v.number(),
};

/** Twin of api.activityLogWrites.record (idempotent by cuid). */
export const recordActivity = internalMutation({
  args: activityLogFields,
  handler: async (ctx, entry) => {
    const existing = await ctx.db
      .query("activityLogs")
      .withIndex("by_cuid", (q) => q.eq("id", entry.id))
      .first();
    if (existing) return { created: false };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.db.insert("activityLogs", entry as any);
    return { created: true };
  },
});
