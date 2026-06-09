import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for DiscordOutbox (Convex table "discordOutboxes"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (browser writes rejected — RBAC stays in the Next.js server
 * actions, which still own permission/validation/audit). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54 and docs/designs/convex-phase5-auth-bridge.md.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("discordOutboxes")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.number() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("discordOutboxes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.number(),
    organizationId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    dedupeKey: v.string(),
    status: v.optional(enums.DiscordOutboxStatus),
    attemptCount: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lockedAt: v.optional(v.number()),
    processedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("discordOutboxes", args);
  },
});

export const update = mutation({
  args: {
    id: v.number(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      eventType: v.optional(v.string()),
      payload: v.optional(v.any()),
      dedupeKey: v.optional(v.string()),
      status: v.optional(enums.DiscordOutboxStatus),
      attemptCount: v.optional(v.number()),
      nextAttemptAt: v.optional(v.number()),
      lockedAt: v.optional(v.number()),
      processedAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      createdAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("discordOutboxes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordOutboxes not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.number() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("discordOutboxes").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordOutboxes not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
