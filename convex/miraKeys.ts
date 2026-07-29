import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * MiraKey — Mira's own per-(org, user) `apiKeys` binding (Phase 8, #1004). See
 * the `miraKeys` table doc comment in convex/schema.ts for why this exists
 * (Mira must reuse its bearer secret across questions, unlike a human-managed
 * key's one-time reveal) and why one row per acting user, never a shared
 * "system" identity.
 *
 * SERVICE-only, like apiKeys.ts itself: this is trusted-backend plumbing
 * (src/server/mira.ts), never something an agent token could read or write —
 * an agent reading another user's encrypted Mira secret would be a
 * cross-tenant credential leak, not merely a data leak.
 */

export const getForUser = query({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("miraKeys")
      .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
      .unique();
  },
});

export const create = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    apiKeyId: v.string(),
    encryptedToken: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    // Guard the same way apiKeys.create guards by_cuid: non-unique index +
    // concurrent provisioning could otherwise insert two rows for the same
    // (org, user), and `.unique()` in getForUser would then throw.
    const existing = await ctx.db
      .query("miraKeys")
      .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", args.organizationId).eq("userId", args.userId))
      .first();
    if (existing) {
      throw new ConvexError("miraKey already provisioned for this (organizationId, userId)");
    }
    await ctx.db.insert("miraKeys", args);
  },
});
