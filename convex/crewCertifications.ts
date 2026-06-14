import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for CrewCertification (Convex table "crewCertifications"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { crewMemberId: v.string() },
  handler: async (ctx, { crewMemberId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("crewCertifications")
      .withIndex("by_crewMemberId", (q) => q.eq("crewMemberId", crewMemberId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("crewCertifications").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("crewCertifications", args);
  },
});

export const createIfMissing = mutation({
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
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("crewCertifications").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("crewCertifications", args);
    return { _id, created: true };
  },
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
    await requireService(ctx);
    const doc = await ctx.db.query("crewCertifications").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewCertifications not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("crewCertifications").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("crewCertifications not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
