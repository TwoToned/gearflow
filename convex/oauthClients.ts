import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * OAuthClient — RFC 7591 dynamic client registration storage (Phase 7, #1003,
 * docs/designs/api-mcp-reimplementation.md §14). A client registers itself once
 * (no admin step); the registration record is then reused across every
 * authorization a user grants it. Same-org-staff-only posture (design §17) —
 * this is trusted-backend infrastructure, not agent-reachable.
 */

export const register = mutation({
  args: {
    id: v.string(),
    clientName: v.optional(v.string()),
    clientSecretHash: v.optional(v.string()),
    tokenEndpointAuthMethod: v.union(v.literal("none"), v.literal("client_secret_basic")),
    redirectUris: v.array(v.string()),
    softwareId: v.optional(v.string()),
    softwareVersion: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const dup = await ctx.db.query("oauthClients").withIndex("by_cuid", (q) => q.eq("id", args.id)).first();
    if (dup) throw new ConvexError("oauthClient id collision: " + args.id);
    return await ctx.db.insert("oauthClients", args);
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("oauthClients").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/** For the settings UI's "OAuth grants" column — resolve client id -> display name. */
export const listByIds = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    await requireService(ctx);
    const unique = [...new Set(ids)];
    const found = await Promise.all(
      unique.map((id) => ctx.db.query("oauthClients").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return found.filter((c): c is NonNullable<typeof c> => c !== null);
  },
});

const denyReason =
  "OAuth client registration storage is trusted-backend infrastructure, not agent-reachable (same posture as apiKeys.list).";

export const agentOps: AgentOpsAnnotations = {
  register: { agentAccess: "denied", reason: denyReason },
  getById: { agentAccess: "denied", reason: denyReason },
  listByIds: { agentAccess: "denied", reason: denyReason },
};
