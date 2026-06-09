import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewCertification (Convex table "crewCertifications"). GENERATED — Phase 2.
 *
 * UNAUTHED by design: the Next.js server action that calls each function has
 * already authenticated the user, checked requirePermission, validated input,
 * and will write the activity log. Do not add auth here. Lookups use the cuid
 * (`id`) via the by_cuid index. See FEATUREDOCS/54 and convex/README.md.
 */

export const list = query({
  args: { crewMemberId: v.string() },
  handler: async (ctx, { crewMemberId }) =>
    await ctx.db
      .query("crewCertifications")
      .withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId))
      .collect(),
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) =>
    await ctx.db.query("crewCertifications").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
});

export const create = mutation({
  args: {
    id: v.string(),
    crewMemberId: v.string(),
    name: v.string(),
    issuedBy: v.optional(v.string()),
    certificateNumber: v.optional(v.string()),
    issuedDate: v.optional(v.number()),
    expiryDate: v.optional(v.number()),
    status: v.optional(enums.CrewCertStatus),
  },
  handler: async (ctx, args) => await ctx.db.insert("crewCertifications", args),
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      crewMemberId: v.optional(v.string()),
      name: v.optional(v.string()),
      issuedBy: v.optional(v.string()),
      certificateNumber: v.optional(v.string()),
      issuedDate: v.optional(v.number()),
      expiryDate: v.optional(v.number()),
      status: v.optional(enums.CrewCertStatus),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const doc = await ctx.db.query("crewCertifications").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewCertifications not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("crewCertifications").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewCertifications not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
