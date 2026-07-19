import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewAvailability (Convex table "crewAvailabilities"). GENERATED — Phase 2/5.
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
      .query("crewAvailabilities")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: reactive/full-org read (perf design); reviewed, accepted R-9.8 tradeoff — revisit with pagination if per-org rows grow large
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

/**
 * Availability rows for a set of crew members (read-rewiring for crew scheduling
 * reads). `organizationId` is OPTIONAL on this table (older rows may lack the
 * denormalized org), so a by-member fetch must use the `by_crewMemberId` index,
 * not the org index — the caller has already org-scoped the crew member ids.
 * Service-only (server actions own authorization). One indexed query per member
 * id, flattened.
 */
export const listByCrewMemberIds = query({
  args: { crewMemberIds: v.array(v.string()) },
  handler: async (ctx, { crewMemberIds }) => {
    await requireService(ctx);
    const groups = await Promise.all(
      crewMemberIds.map((crewMemberId) =>
        ctx.db
          .query("crewAvailabilities")
          .withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId))
          .collect(),
      ),
    );
    return groups.flat();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    crewMemberId: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    type: v.optional(enums.AvailabilityType),
    reason: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewAvailabilities", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    crewMemberId: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    type: v.optional(enums.AvailabilityType),
    reason: v.optional(v.string()),
    isAllDay: v.optional(v.boolean()),
    startTime: v.optional(v.string()),
    endTime: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewAvailabilities", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      crewMemberId: v.optional(v.string()),
      startDate: v.optional(v.number()),
      endDate: v.optional(v.number()),
      type: v.optional(enums.AvailabilityType),
      reason: v.optional(v.string()),
      isAllDay: v.optional(v.boolean()),
      startTime: v.optional(v.string()),
      endTime: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      organizationId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAvailabilities not found: " + id);
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
    const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("crewAvailabilities not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

/**
 * Delete N availability rows in ONE array mutation (bulk single-call invariant) —
 * replaces the server firing one `remove` per row in a crew-member delete cascade.
 * `organizationId` is OPTIONAL on this table, so we skip only a row whose org is
 * PRESENT and MISMATCHED (a genuine cross-tenant id); null-org rows are deleted (they
 * match the old delete-by-id behavior and belong to the member being removed).
 */
export const removeMany = mutation({
  args: { organizationId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { organizationId, ids }) => {
    await requireService(ctx);
    let deleted = 0;
    for (const id of ids) {
      const doc = await ctx.db.query("crewAvailabilities").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
      if (!doc) continue;
      if (doc.organizationId != null && doc.organizationId !== organizationId) continue;
      await ctx.db.delete(doc._id);
      deleted++;
    }
    return { deleted };
  },
});
