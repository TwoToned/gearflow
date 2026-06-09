import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireOrgRead, requireOrgReadDoc, requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Thin CRUD for DiscordIntegration (Convex table "discordIntegrations"). GENERATED — Phase 2/5.
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
      .query("discordIntegrations")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.query("discordIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    await requireOrgReadDoc(ctx, doc);
    return doc;
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    isEnabled: v.optional(v.boolean()),
    signingSecret: v.string(),
    discordBotToken: v.optional(v.string()),
    discordApplicationId: v.optional(v.string()),
    guildId: v.optional(v.string()),
    projectCategoryId: v.optional(v.string()),
    archiveCategoryId: v.optional(v.string()),
    alertChannelId: v.optional(v.string()),
    auditChannelId: v.optional(v.string()),
    channelCreateOnStatuses: v.optional(v.array(enums.ProjectStatus)),
    channelArchiveOnStatuses: v.optional(v.array(enums.ProjectStatus)),
    postWelcomeOnCreate: v.optional(v.boolean()),
    postFaultsToProjectChannel: v.optional(v.boolean()),
    linkTokenTtlMinutes: v.optional(v.number()),
    enrollmentOpen: v.optional(v.boolean()),
    lastHeartbeatAt: v.optional(v.number()),
    botUserId: v.optional(v.string()),
    botDesiredState: v.optional(enums.DiscordBotDesiredState),
    botRestartRequestedAt: v.optional(v.number()),
    botStartError: v.optional(v.string()),
    botPid: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("discordIntegrations", args);
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      isEnabled: v.optional(v.boolean()),
      signingSecret: v.optional(v.string()),
      discordBotToken: v.optional(v.string()),
      discordApplicationId: v.optional(v.string()),
      guildId: v.optional(v.string()),
      projectCategoryId: v.optional(v.string()),
      archiveCategoryId: v.optional(v.string()),
      alertChannelId: v.optional(v.string()),
      auditChannelId: v.optional(v.string()),
      channelCreateOnStatuses: v.optional(v.array(enums.ProjectStatus)),
      channelArchiveOnStatuses: v.optional(v.array(enums.ProjectStatus)),
      postWelcomeOnCreate: v.optional(v.boolean()),
      postFaultsToProjectChannel: v.optional(v.boolean()),
      linkTokenTtlMinutes: v.optional(v.number()),
      enrollmentOpen: v.optional(v.boolean()),
      lastHeartbeatAt: v.optional(v.number()),
      botUserId: v.optional(v.string()),
      botDesiredState: v.optional(enums.DiscordBotDesiredState),
      botRestartRequestedAt: v.optional(v.number()),
      botStartError: v.optional(v.string()),
      botPid: v.optional(v.number()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("discordIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordIntegrations not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("discordIntegrations").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new Error("discordIntegrations not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
