import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

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
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: small bounded per-org set
      .order("desc")
      .collect();
  },
});

export const getByTokenHash = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireService(ctx);
    return await ctx.db
      .query("apiKeys")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
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

/** Best-effort last-used stamp (observability). Never gates auth. */
export const touchLastUsed = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("apiKeys").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (doc) await ctx.db.patch(doc._id, { lastUsedAt: Date.now() });
  },
});
