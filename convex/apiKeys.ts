import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import type { Doc } from "./_generated/dataModel";

/**
 * ApiKey (agent-accessible API/MCP access keys) — Convex-native domain (Phase-1
 * decommission; the Postgres `api_key` table is frozen). RBAC/validation/audit stay
 * in the Next.js server actions (`src/server/api-keys.ts`) + the request-auth path
 * (`src/lib/api-key.ts`); these functions are the trusted-backend SERVICE data layer.
 *
 * `getByTokenHash` is the request-auth hot path: the raw token hashes to `tokenHash`,
 * which is the credential, so a GLOBAL lookup by hash is correct (like by_cuid) — the
 * returned key carries its own `organizationId`. The org kill-switch + acting-user
 * name are still read from Postgres (Better-Auth `organization`/`user`, which stay).
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small bounded per-org set — see docs/exceptions.md R-8.3.3
      .order("desc")
      .collect();
  },
});

export const getByTokenHash = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireService(ctx);
    const current = await ctx.db
      .query("apiKeys")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (current) return current;
    // Rotation grace window: the OLD secret keeps authenticating until
    // previousTokenHashExpiresAt so a consumer can roll over without a hard
    // cutover (mirrors webhooks.rotateSecret's previousSecret). A non-unique
    // stale row (shouldn't happen — rotate() clears it on the next rotation)
    // fails closed via `.unique()`'s own error rather than picking one.
    const prior = await ctx.db
      .query("apiKeys")
      .withIndex("by_previousTokenHash", (q) => q.eq("previousTokenHash", tokenHash))
      .unique();
    if (prior && prior.previousTokenHashExpiresAt && prior.previousTokenHashExpiresAt > Date.now()) {
      return prior;
    }
    return null;
  },
});

const writeArgs = {
  id: v.string(),
  organizationId: v.string(),
  name: v.string(),
  prefix: v.string(),
  tokenHash: v.string(),
  scopes: v.optional(v.string()),
  isActive: v.optional(v.boolean()),
  actingUserId: v.string(),
  createdById: v.string(),
  expiresAt: v.optional(v.number()),
  lastUsedAt: v.optional(v.number()),
  lastRotatedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  createdAt: v.optional(v.number()),
  noFinancials: v.optional(v.boolean()),
  // Phase 7 (#1003) — OAuth-issued grants only; absent on every manually-minted key.
  origin: v.optional(v.union(v.literal("manual"), v.literal("oauth"))),
  oauthClientId: v.optional(v.string()),
  refreshTokenHash: v.optional(v.string()),
  refreshTokenExpiresAt: v.optional(v.number()),
};

export const create = mutation({
  args: writeArgs,
  handler: async (ctx, args) => {
    await requireService(ctx);
    // by_cuid / by_tokenHash are non-unique Convex indexes — a duplicate would make
    // the `.unique()` reads in getByTokenHash/revoke throw a cardinality error and
    // break auth/revoke. Guard at creation (Postgres had PK + UNIQUE constraints).
    const dupId = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", args.id)).first();
    if (dupId) throw new ConvexError("apiKey id collision: " + args.id);
    const dupHash = await ctx.db.query("apiKeys").withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash)).first();
    if (dupHash) throw new ConvexError("apiKey tokenHash collision");
    return await ctx.db.insert("apiKeys", args);
  },
});

export const createIfMissing = mutation({
  args: writeArgs,
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_cuid", (q) => q.eq("id", args.id))
      .unique();
    if (existing) return { _id: existing._id, created: false };
    // Same tokenHash under a DIFFERENT id would break the .unique() auth lookup —
    // reject rather than insert a colliding hash (idempotent by id, guarded by hash).
    const dupHash = await ctx.db.query("apiKeys").withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash)).first();
    if (dupHash) throw new ConvexError("apiKey tokenHash collision (different id)");
    const _id = await ctx.db.insert("apiKeys", args);
    return { _id, created: true };
  },
});

/** Revoke a single key (org-guarded): deactivate + stamp revokedAt. Idempotent. */
export const revoke = mutation({
  args: { id: v.string(), orgId: v.string() },
  handler: async (ctx, { id, orgId }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("apiKey not found: " + id);
    await ctx.db.patch(doc._id, { isActive: false, revokedAt: Date.now() });
    return { id: doc.id, name: doc.name };
  },
});

/**
 * Rotate a key's secret (org-guarded): the OLD tokenHash moves to
 * `previousTokenHash` with a grace-window expiry (mirrors
 * `webhooks.rotateSecret`); the NEW prefix/tokenHash become current
 * immediately. A second rotation before the first grace window elapses
 * simply overwrites `previousTokenHash` — the key generation before last
 * stops working, which is the expected "one grace window" semantics.
 */
export const rotate = mutation({
  args: {
    id: v.string(),
    orgId: v.string(),
    prefix: v.string(),
    tokenHash: v.string(),
    previousTokenHashExpiresAt: v.number(),
  },
  handler: async (ctx, { id, orgId, prefix, tokenHash, previousTokenHashExpiresAt }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc || doc.organizationId !== orgId) throw new ConvexError("apiKey not found: " + id);
    const dupHash = await ctx.db.query("apiKeys").withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash)).first();
    if (dupHash) throw new ConvexError("apiKey tokenHash collision");
    await ctx.db.patch(doc._id, {
      prefix,
      tokenHash,
      previousTokenHash: doc.tokenHash,
      previousTokenHashExpiresAt,
      lastRotatedAt: Date.now(),
    });
    return { id: doc.id, name: doc.name, prefix };
  },
});

/** Best-effort last-used stamp (observability). Never gates auth. */
export const touchLastUsed = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (doc) await ctx.db.patch(doc._id, { lastUsedAt: Date.now() });
  },
});

/**
 * OAuth token-exchange support (Phase 7, #1003). `mintOAuthGrant` creates a NEW
 * `apiKeys` row per authorization-code redemption (`origin: "oauth"`) — each
 * authorization is its own individually-revocable grant, same posture as a
 * manually-minted key. Duplicate guards mirror `create`.
 */
export const mintOAuthGrant = mutation({
  args: writeArgs,
  handler: async (ctx, args) => {
    await requireService(ctx);
    if (args.origin !== "oauth") throw new ConvexError("mintOAuthGrant requires origin: \"oauth\"");
    const dupId = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", args.id)).first();
    if (dupId) throw new ConvexError("apiKey id collision: " + args.id);
    const dupHash = await ctx.db.query("apiKeys").withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash)).first();
    if (dupHash) throw new ConvexError("apiKey tokenHash collision");
    if (args.refreshTokenHash) {
      const dupRefresh = await ctx.db
        .query("apiKeys")
        .withIndex("by_refreshTokenHash", (q) => q.eq("refreshTokenHash", args.refreshTokenHash))
        .first();
      if (dupRefresh) throw new ConvexError("apiKey refreshTokenHash collision");
    }
    return await ctx.db.insert("apiKeys", args);
  },
});

/** Look up a live OAuth grant by its refresh token's hash (the refresh_token
 *  grant's credential lookup — the by_tokenHash equivalent for refreshing). */
export const getByRefreshTokenHash = query({
  args: { refreshTokenHash: v.string() },
  handler: async (ctx, { refreshTokenHash }) => {
    await requireService(ctx);
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_refreshTokenHash", (q) => q.eq("refreshTokenHash", refreshTokenHash))
      .unique();
  },
});

/** Every check a `rotateOAuthTokens` call must pass before it may rotate —
 *  split out so the handler itself stays under the complexity ratchet (R-3.6).
 *  An `asserts` predicate so the caller can keep using `doc` narrowed to
 *  non-null afterward. */
function assertOAuthGrantRotatable(
  doc: Doc<"apiKeys"> | null,
  args: { organizationId: string; presentedRefreshTokenHash: string },
): asserts doc is Doc<"apiKeys"> {
  const isLiveOAuthGrant =
    doc != null && doc.organizationId === args.organizationId && doc.origin === "oauth" && doc.isActive !== false && doc.revokedAt == null;
  if (!isLiveOAuthGrant) {
    throw new ConvexError({ code: "INVALID_GRANT", message: "OAuth grant not found or revoked." });
  }
  if (doc.refreshTokenHash !== args.presentedRefreshTokenHash) {
    throw new ConvexError({ code: "INVALID_GRANT", message: "Refresh token does not match the live grant." });
  }
  if (!doc.refreshTokenExpiresAt || doc.refreshTokenExpiresAt <= Date.now()) {
    throw new ConvexError({ code: "INVALID_GRANT", message: "Refresh token has expired." });
  }
}

/**
 * Rotate an OAuth grant's access + refresh token pair (the `refresh_token`
 * grant). Re-verifies the presented refresh token's hash, the grant's
 * liveness (active/not revoked/org match) and the refresh token's own expiry
 * INSIDE this transaction — Convex's OCC means a concurrent replay of the same
 * (now-superseded) refresh token loses the retry race and sees the rotated
 * hash, so a stolen-and-replayed refresh token can succeed at most once
 * (single-use rotation, no grace window, unlike the manual-key `rotate`
 * mutation above).
 */
export const rotateOAuthTokens = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    presentedRefreshTokenHash: v.string(),
    tokenHash: v.string(),
    prefix: v.string(),
    accessTokenExpiresAt: v.number(),
    refreshTokenHash: v.string(),
    refreshTokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const doc = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    assertOAuthGrantRotatable(doc, args);
    const dupHash = await ctx.db.query("apiKeys").withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash)).first();
    if (dupHash) throw new ConvexError("apiKey tokenHash collision");
    await ctx.db.patch(doc._id, {
      tokenHash: args.tokenHash,
      prefix: args.prefix,
      expiresAt: args.accessTokenExpiresAt,
      refreshTokenHash: args.refreshTokenHash,
      refreshTokenExpiresAt: args.refreshTokenExpiresAt,
      lastRotatedAt: Date.now(),
    });
    return { id: doc.id, name: doc.name, scopes: doc.scopes ?? "[]" };
  },
});

const apiKeysDenyReason =
  "The API key management surface itself must not be self-servable by an API key (privilege escalation risk).";

export const agentOps: AgentOpsAnnotations = {
  list: { agentAccess: "denied", reason: apiKeysDenyReason },
  getByTokenHash: { agentAccess: "denied", reason: apiKeysDenyReason },
  mintOAuthGrant: { agentAccess: "denied", reason: apiKeysDenyReason },
  getByRefreshTokenHash: { agentAccess: "denied", reason: apiKeysDenyReason },
  rotateOAuthTokens: { agentAccess: "denied", reason: apiKeysDenyReason },
};
