import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Convex mirror of the Prisma `custom_role` table (source of truth stays in
 * Prisma). Lets `requireOrgPermission` resolve a "custom:<id>" role's permission
 * map inside Convex (docs/designs/convex-native-read-layer.md §3.3).
 *
 * `permissions` is kept as the JSON STRING exactly as Prisma stores it; the guard
 * JSON.parses it at read time (lower-risk than a schema change to a validated
 * object — §3.3.2). A permission-removal/role-deletion is a RESTRICTIVE change:
 * the src-side caller mirrors it to Convex BEFORE committing Prisma (§3.3.4).
 *
 * AUTH: SERVICE-only. Nothing reads these for enforcement yet.
 */

/** Resolve a custom role by its Better-Auth/Prisma id (the guard's lookup). */
export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db
      .query("customRoles")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
  },
});

/** Insert-or-REPLACE by `id`. Idempotent (see members.upsert for the OCC note). */
export const upsert = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    permissions: v.string(),
    ssoGroupClaim: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("customRoles")
      .withIndex("by_cuid", (q) => q.eq("id", args.id))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("customRoles", args);
  },
});

/** Remove a mirrored custom role by id (role deletion). Idempotent. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db
      .query("customRoles")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (doc) await ctx.db.delete(doc._id);
  },
});
