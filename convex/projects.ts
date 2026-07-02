import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for Project (Convex table "projects"). GENERATED — Phase 2/5.
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
      .query("projects")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Batch point-read projects by cuid, scoped to one org. Lets a detail composite
 * attach projects to its line-items / scan-logs by id instead of collecting every
 * project in the org (getProjectsByOrg) just to build a lookup map. Cross-org ids
 * dropped. Does NOT exclude templates — callers that need that filter on the result.
 */
export const listByIds = query({
  args: { orgId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgRead(ctx, orgId);
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("projects.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return docs.filter((d): d is NonNullable<typeof d> => d !== null && d.organizationId === orgId);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
    status: v.optional(enums.ProjectStatus),
    type: v.optional(enums.ProjectType),
    description: v.optional(v.string()),
    locationId: v.optional(v.string()),
    siteContactName: v.optional(v.string()),
    siteContactPhone: v.optional(v.string()),
    siteContactEmail: v.optional(v.string()),
    loadInDate: v.optional(v.number()),
    loadInTime: v.optional(v.string()),
    eventStartDate: v.optional(v.number()),
    eventStartTime: v.optional(v.string()),
    eventEndDate: v.optional(v.number()),
    eventEndTime: v.optional(v.string()),
    loadOutDate: v.optional(v.number()),
    loadOutTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    defaultRentalPeriod: v.optional(enums.RentalPeriod),
    defaultRentalQuantity: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    equipmentRevenue: v.optional(v.number()),
    serviceCostTotal: v.optional(v.number()),
    labourCostTotal: v.optional(v.number()),
    subHireCostTotal: v.optional(v.number()),
    margin: v.optional(v.number()),
    crewNotes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    subtotal: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    depositPercent: v.optional(v.number()),
    depositPaid: v.optional(v.number()),
    invoicedTotal: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    isTemplate: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("projects", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    clientId: v.optional(v.string()),
    status: v.optional(enums.ProjectStatus),
    type: v.optional(enums.ProjectType),
    description: v.optional(v.string()),
    locationId: v.optional(v.string()),
    siteContactName: v.optional(v.string()),
    siteContactPhone: v.optional(v.string()),
    siteContactEmail: v.optional(v.string()),
    loadInDate: v.optional(v.number()),
    loadInTime: v.optional(v.string()),
    eventStartDate: v.optional(v.number()),
    eventStartTime: v.optional(v.string()),
    eventEndDate: v.optional(v.number()),
    eventEndTime: v.optional(v.string()),
    loadOutDate: v.optional(v.number()),
    loadOutTime: v.optional(v.string()),
    rentalStartDate: v.optional(v.number()),
    rentalEndDate: v.optional(v.number()),
    projectManagerId: v.optional(v.string()),
    defaultRentalPeriod: v.optional(enums.RentalPeriod),
    defaultRentalQuantity: v.optional(v.number()),
    taxRate: v.optional(v.number()),
    equipmentRevenue: v.optional(v.number()),
    serviceCostTotal: v.optional(v.number()),
    labourCostTotal: v.optional(v.number()),
    subHireCostTotal: v.optional(v.number()),
    margin: v.optional(v.number()),
    crewNotes: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    subtotal: v.optional(v.number()),
    discountPercent: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    taxAmount: v.optional(v.number()),
    total: v.optional(v.number()),
    depositPercent: v.optional(v.number()),
    depositPaid: v.optional(v.number()),
    invoicedTotal: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    isTemplate: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("projects", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      projectNumber: v.optional(v.string()),
      name: v.optional(v.string()),
      clientId: v.optional(v.string()),
      status: v.optional(enums.ProjectStatus),
      type: v.optional(enums.ProjectType),
      description: v.optional(v.string()),
      locationId: v.optional(v.string()),
      siteContactName: v.optional(v.string()),
      siteContactPhone: v.optional(v.string()),
      siteContactEmail: v.optional(v.string()),
      loadInDate: v.optional(v.number()),
      loadInTime: v.optional(v.string()),
      eventStartDate: v.optional(v.number()),
      eventStartTime: v.optional(v.string()),
      eventEndDate: v.optional(v.number()),
      eventEndTime: v.optional(v.string()),
      loadOutDate: v.optional(v.number()),
      loadOutTime: v.optional(v.string()),
      rentalStartDate: v.optional(v.number()),
      rentalEndDate: v.optional(v.number()),
      projectManagerId: v.optional(v.string()),
      defaultRentalPeriod: v.optional(enums.RentalPeriod),
      defaultRentalQuantity: v.optional(v.number()),
      taxRate: v.optional(v.number()),
      equipmentRevenue: v.optional(v.number()),
      serviceCostTotal: v.optional(v.number()),
      labourCostTotal: v.optional(v.number()),
      subHireCostTotal: v.optional(v.number()),
      margin: v.optional(v.number()),
      crewNotes: v.optional(v.string()),
      internalNotes: v.optional(v.string()),
      clientNotes: v.optional(v.string()),
      subtotal: v.optional(v.number()),
      discountPercent: v.optional(v.number()),
      discountAmount: v.optional(v.number()),
      taxAmount: v.optional(v.number()),
      total: v.optional(v.number()),
      depositPercent: v.optional(v.number()),
      depositPaid: v.optional(v.number()),
      invoicedTotal: v.optional(v.number()),
      tags: v.optional(v.array(v.string())),
      isTemplate: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projects not found: " + id);
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
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projects not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── CUSTOM (project keystone write-inversion, Phase C) ───

export const projectWriteFields = {
  clientId: v.optional(v.string()),
  status: v.optional(enums.ProjectStatus),
  type: v.optional(enums.ProjectType),
  description: v.optional(v.string()),
  locationId: v.optional(v.string()),
  siteContactName: v.optional(v.string()),
  siteContactPhone: v.optional(v.string()),
  siteContactEmail: v.optional(v.string()),
  loadInDate: v.optional(v.number()),
  loadInTime: v.optional(v.string()),
  eventStartDate: v.optional(v.number()),
  eventStartTime: v.optional(v.string()),
  eventEndDate: v.optional(v.number()),
  eventEndTime: v.optional(v.string()),
  loadOutDate: v.optional(v.number()),
  loadOutTime: v.optional(v.string()),
  rentalStartDate: v.optional(v.number()),
  rentalEndDate: v.optional(v.number()),
  projectManagerId: v.optional(v.string()),
  defaultRentalPeriod: v.optional(enums.RentalPeriod),
  defaultRentalQuantity: v.optional(v.number()),
  taxRate: v.optional(v.number()),
  equipmentRevenue: v.optional(v.number()),
  serviceCostTotal: v.optional(v.number()),
  labourCostTotal: v.optional(v.number()),
  subHireCostTotal: v.optional(v.number()),
  margin: v.optional(v.number()),
  crewNotes: v.optional(v.string()),
  internalNotes: v.optional(v.string()),
  clientNotes: v.optional(v.string()),
  subtotal: v.optional(v.number()),
  discountPercent: v.optional(v.number()),
  discountAmount: v.optional(v.number()),
  taxAmount: v.optional(v.number()),
  total: v.optional(v.number()),
  depositPercent: v.optional(v.number()),
  depositPaid: v.optional(v.number()),
  invoicedTotal: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  isTemplate: v.optional(v.boolean()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
};

/** Look up a project by its org-scoped project number (the @@unique guard). */
export const getByOrgAndNumber = query({
  args: { organizationId: v.string(), projectNumber: v.string() },
  handler: async (ctx, { organizationId, projectNumber }) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", organizationId).eq("projectNumber", projectNumber),
      )
      .unique();
  },
});

/**
 * Create a project, enforcing the `@@unique([organizationId, projectNumber])`
 * invariant Convex can't express as an index constraint. Serializable check-then-
 * insert on by_organizationId_projectNumber — a concurrent insert of the same number
 * conflicts on the read range and retries. Returns `{ created }` — false (no insert)
 * if the number is already taken, so the action can bump + retry.
 */
export const createWithUniqueNumber = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    projectNumber: v.string(),
    name: v.string(),
    ...projectWriteFields,
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const clash = await ctx.db
      .query("projects")
      .withIndex("by_organizationId_projectNumber", (q) =>
        q.eq("organizationId", args.organizationId).eq("projectNumber", args.projectNumber),
      )
      .unique();
    if (clash) return { created: false, id: clash.id };
    await ctx.db.insert("projects", args);
    return { created: true, id: args.id };
  },
});

/**
 * Patch a project with explicit field clears (clientId / locationId /
 * projectManagerId / dates / financials → unset). The generated `update` can't
 * clear, because the action's `toConvexDoc` drops nulls before the wire.
 */
export const patchProject = mutation({
  args: {
    id: v.string(),
    set: v.object({ name: v.optional(v.string()), projectNumber: v.optional(v.string()), ...projectWriteFields }),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("projects not found: " + id);
    const patch: Record<string, unknown> = { ...set };
    for (const k of clear ?? []) patch[k] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});
