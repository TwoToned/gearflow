import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Convex mirror of the Better-Auth `user` table (the source of truth stays in
 * Prisma — Better Auth owns it). Written best-effort by `src/lib/user-mirror.ts`
 * on every user create/update. The point: let detail composites resolve the
 * linked user (scannedBy, projectManagers.user, …) from Convex instead of a
 * cross-domain `prisma.user` join, which is the blocker to making those pages
 * pure-Convex live subscriptions (see docs/designs/perf-waterfall-spike-T1.md).
 *
 * AUTH: users are NOT org-scoped (a user is global; org membership is the `member`
 * table), so reads/writes are SERVICE-only (the trusted backend token), matching
 * the rest of the kept-data mirror surface. Nothing reads these yet — this PR only
 * stands up the table + the mirror so a later PR can rewire composites onto it.
 */

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

/** Batch point-read users by id (one by_cuid lookup each). Deduped + capped. */
/**
 * Every mirrored user row (id/email/name). SERVICE-only. Used by the auth-mirror
 * RECONCILE job to detect orphan mirror rows (user deleted in Better Auth but still
 * mirrored) + field drift. Small table; full collect.
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireService(ctx);
    const rows = await ctx.db.query("users").collect();
    return rows.map((r) => ({ id: r.id, email: r.email ?? null, name: r.name ?? null }));
  },
});

export const listByIds = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    await requireService(ctx);
    const unique = [...new Set(ids)];
    if (unique.length > 1000) throw new ConvexError("users.listByIds: too many ids (max 1000)");
    const docs = await Promise.all(
      unique.map((id) => ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).unique()),
    );
    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});

/**
 * Insert-or-REPLACE by `id`. Idempotent under Convex OCC (the by_cuid read is in the
 * transaction's read set, so a racing insert forces a retry → no duplicate row).
 *
 * Uses `replace` (not `patch`) on an existing row so the Convex doc becomes EXACTLY
 * the mirror args — a field the caller omits (e.g. `image` after an avatar clear) is
 * removed, not left stale. The mirror helper always re-reads the full Prisma row, so
 * the args are the complete current state. Only the displayed/used fields are
 * mirrored (name/email/image/role/emailVerified + timestamps); ban/2FA are not.
 */
export const upsert = mutation({
  args: {
    id: v.string(),
    name: v.string(),
    email: v.string(),
    emailVerified: v.optional(v.boolean()),
    image: v.optional(v.string()),
    role: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) {
      await ctx.db.replace(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("users", args);
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("users").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (doc) await ctx.db.delete(doc._id);
  },
});
