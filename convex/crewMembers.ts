import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService, getAuthContext, redactFields } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewMember (Convex table "crewMembers"). GENERATED — Phase 2/5.
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
    const docs = await ctx.db
      .query("crewMembers")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
    const auth = await getAuthContext(ctx);
    return auth?.kind === "service" ? docs : docs.map((d) => redactFields(d, ["icalToken"]));
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    if (!doc) return doc;
    const auth = await getAuthContext(ctx);
    return auth?.kind === "service" ? doc : redactFields(doc, ["icalToken"]);
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    userId: v.optional(v.string()),
    type: v.optional(enums.CrewMemberType),
    status: v.optional(enums.CrewMemberStatus),
    department: v.optional(v.string()),
    defaultDayRate: v.optional(v.number()),
    defaultHourlyRate: v.optional(v.number()),
    overtimeMultiplier: v.optional(v.number()),
    currency: v.optional(v.string()),
    address: v.optional(v.string()),
    addressLatitude: v.optional(v.number()),
    addressLongitude: v.optional(v.number()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()),
    abnOrGst: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    icalEnabled: v.optional(v.boolean()),
    icalToken: v.optional(v.string()),
    crewRoleId: v.optional(v.string()),
    skillIds: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewMembers", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    userId: v.optional(v.string()),
    type: v.optional(enums.CrewMemberType),
    status: v.optional(enums.CrewMemberStatus),
    department: v.optional(v.string()),
    defaultDayRate: v.optional(v.number()),
    defaultHourlyRate: v.optional(v.number()),
    overtimeMultiplier: v.optional(v.number()),
    currency: v.optional(v.string()),
    address: v.optional(v.string()),
    addressLatitude: v.optional(v.number()),
    addressLongitude: v.optional(v.number()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()),
    abnOrGst: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    icalEnabled: v.optional(v.boolean()),
    icalToken: v.optional(v.string()),
    crewRoleId: v.optional(v.string()),
    skillIds: v.optional(v.array(v.string())),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewMembers", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      image: v.optional(v.string()),
      userId: v.optional(v.string()),
      type: v.optional(enums.CrewMemberType),
      status: v.optional(enums.CrewMemberStatus),
      department: v.optional(v.string()),
      defaultDayRate: v.optional(v.number()),
      defaultHourlyRate: v.optional(v.number()),
      overtimeMultiplier: v.optional(v.number()),
      currency: v.optional(v.string()),
      address: v.optional(v.string()),
      addressLatitude: v.optional(v.number()),
      addressLongitude: v.optional(v.number()),
      emergencyContactName: v.optional(v.string()),
      emergencyContactPhone: v.optional(v.string()),
      dateOfBirth: v.optional(v.number()),
      abnOrGst: v.optional(v.string()),
      notes: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      icalEnabled: v.optional(v.boolean()),
      icalToken: v.optional(v.string()),
      crewRoleId: v.optional(v.string()),
      skillIds: v.optional(v.array(v.string())),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      isActive: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewMembers not found: " + id);
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
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewMembers not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ── CUSTOM (Phase C) — NOT emitted by the CRUD generator; re-add on regen. ──
// Patch with explicit field CLEARING. `set` applies non-null values; every name
// in `clear` is set to undefined → Convex removes the optional field (the
// generated `update` can't clear, because toConvexDoc drops nulls before the wire).
export const patchMember = mutation({
  args: {
    id: v.string(),
    set: v.any(),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, set, clear }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewMembers").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewMembers not found: " + id);
    const patch: Record<string, unknown> = { ...(set ?? {}) };
    delete patch.organizationId;
    delete patch.id;
    for (const f of clear ?? []) patch[f] = undefined;
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});
