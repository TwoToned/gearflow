import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Convex mirror of the Better-Auth `member` table (source of truth stays in
 * Prisma — Better Auth's organization plugin owns it). Stands up the table's
 * write surface so the native read layer's `requireOrgPermission` guard can
 * resolve a user's role by (org, user) inside Convex instead of a Prisma join.
 *
 * AUTH: SERVICE-only — only the trusted backend mirrors membership. The mirror
 * write ORDERING is security-critical (restrictive changes write Convex FIRST,
 * additive changes write Prisma first — §3.3.4); that contract is enforced by the
 * src-side caller (a later PR), not here. These functions are the idempotent
 * primitives it calls.
 *
 * Nothing reads these yet for enforcement — this PR stands up the table writers +
 * the guard; wiring the write sites + backfill + the browser cutover are later PRs.
 */

/** Resolve a member by (org, user) — the guard's lookup. `.first()`, not
 * `.unique()`: Prisma's `member` has no (org,user) unique constraint and every
 * server path uses findFirst, so a duplicate mirror row must not crash the read. */
export const getByOrgAndUser = query({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", organizationId).eq("userId", userId),
      )
      .first();
  },
});

/**
 * Insert-or-REPLACE by `id` (idempotent under Convex OCC — the by_cuid read is in
 * the transaction read set, so a racing insert retries rather than duplicating).
 * `replace` makes the row EXACTLY the mirror args (a demotion's new role fully
 * overwrites the old). The caller always passes the complete current Prisma row.
 */
/**
 * Every mirrored member row. SERVICE-only. Used by the auth-mirror RECONCILE job
 * (scripts/auth-mirror-reconcile.ts) to detect orphans — mirror rows whose
 * Better-Auth member was deleted (a stale row = a stale authZ grant, since
 * `requireOrgPermission` resolves role from here). Small table; full collect.
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireService(ctx);
    const rows = await ctx.db.query("members").collect();
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      userId: r.userId,
      role: r.role,
    }));
  },
});

export const upsert = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    role: v.string(),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("members")
      .withIndex("by_cuid", (q) => q.eq("id", args.id))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("members", args);
  },
});

/** Remove a mirrored member by its Better-Auth id (revocation). Idempotent. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db
      .query("members")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .first();
    if (doc) await ctx.db.delete(doc._id);
  },
});

/**
 * Remove every mirrored member for (org, user). Revocation by membership, not by
 * row id — used when the caller knows the user left/was removed but may not hold
 * the exact member id. Clears duplicates too. Idempotent.
 */
export const removeByOrgAndUser = mutation({
  args: { organizationId: v.string(), userId: v.string() },
  handler: async (ctx, { organizationId, userId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) =>
        q.eq("organizationId", organizationId).eq("userId", userId),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
