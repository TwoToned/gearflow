import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

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

const apiKeysDenyReason =
  "The API key management surface itself must not be self-servable by an API key (privilege escalation risk).";

export const agentOps: AgentOpsAnnotations = {
  list: { agentAccess: "denied", reason: apiKeysDenyReason },
  getByTokenHash: { agentAccess: "denied", reason: apiKeysDenyReason },
};
