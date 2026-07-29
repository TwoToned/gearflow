import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * OAuthAuthorizationCode — the short-lived, single-use authorization_code hop
 * (Phase 7, #1003). `redeem` is the load-bearing single-use guarantee: it runs
 * as one Convex transaction, so two concurrent redemption attempts for the
 * same code cannot both see `usedAt: undefined` and both succeed — the second
 * one's transaction re-reads the (now-patched) row and rejects.
 */

export const create = mutation({
  args: {
    codeHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    codeChallengeMethod: v.literal("S256"),
    scopes: v.string(),
    userId: v.string(),
    organizationId: v.string(),
    resource: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const dup = await ctx.db
      .query("oauthAuthorizationCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash))
      .first();
    if (dup) throw new ConvexError("oauthAuthorizationCode codeHash collision");
    return await ctx.db.insert("oauthAuthorizationCodes", args);
  },
});

/** Redeem a code exactly once. Returns `null` for missing/expired/already-used
 *  (the token endpoint maps any of these to the single OAuth `invalid_grant`
 *  error — RFC 6749 §5.2 deliberately doesn't distinguish "wrong" from "reused"
 *  from "expired" to an attacker). */
export const redeem = mutation({
  args: { codeHash: v.string(), now: v.number() },
  handler: async (ctx, { codeHash, now }) => {
    await requireService(ctx);
    const doc = await ctx.db
      .query("oauthAuthorizationCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", codeHash))
      .unique();
    if (!doc || doc.usedAt != null || doc.expiresAt <= now) return null;
    await ctx.db.patch(doc._id, { usedAt: now });
    return {
      clientId: doc.clientId,
      redirectUri: doc.redirectUri,
      codeChallenge: doc.codeChallenge,
      codeChallengeMethod: doc.codeChallengeMethod,
      scopes: doc.scopes,
      userId: doc.userId,
      organizationId: doc.organizationId,
      resource: doc.resource ?? null,
    };
  },
});

const denyReason =
  "OAuth authorization-code exchange is trusted-backend infrastructure, not agent-reachable.";

export const agentOps: AgentOpsAnnotations = {
  create: { agentAccess: "denied", reason: denyReason },
  redeem: { agentAccess: "denied", reason: denyReason },
};
