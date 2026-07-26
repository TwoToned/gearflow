import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Thin CRUD for NotificationDismissal (Convex table "notificationDismissals"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("notificationDismissals")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)) // r9.8-ok: bounded per-org config/catalog set — see docs/exceptions.md R-8.3.3
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("notificationDismissals").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    notificationKey: v.string(),
    dismissedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("notificationDismissals", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    userId: v.string(),
    notificationKey: v.string(),
    dismissedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("notificationDismissals").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("notificationDismissals", args);
    return { _id, created: true };
  },
});

/**
 * Bulk-dismiss N notifications for one user in a SINGLE call (Appendix A bulk
 * single-call invariant — powers the /notifications "Dismiss All"). Idempotent:
 * each key is deduped against the user's existing dismissals via the
 * by_userId_notificationKey index (Convex has no unique index), so re-dismissing
 * keeps the original row. org/userId are supplied by the server action from the
 * verified session — the service token gates the write.
 */
export const createManyIfMissing = mutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    items: v.array(
      v.object({
        id: v.string(),
        notificationKey: v.string(),
        dismissedAt: v.optional(v.number()),
      }),
    ),
  },
  returns: v.object({ created: v.number(), skipped: v.number() }),
  handler: async (ctx, { organizationId, userId, items }) => {
    await requireService(ctx);
    let created = 0;
    let skipped = 0;
    for (const item of items) {
      // Dedup PER-ORG, not globally. Most keys embed an entity cuid (org-unique),
      // but the two crew keys (crew-pending-offers/-timesheets) are constant across
      // orgs — a multi-org user must be able to dismiss them in each org separately
      // (reads are org-scoped via list({orgId})). by_userId_notificationKey is
      // GLOBAL, so filter its (few — one per membership) rows by organizationId.
      const existing = await ctx.db
        .query("notificationDismissals")
        .withIndex("by_userId_notificationKey", (q) =>
          q.eq("userId", userId).eq("notificationKey", item.notificationKey),
        )
        .collect();
      if (existing.some((d) => d.organizationId === organizationId)) {
        skipped++;
        continue;
      }
      await ctx.db.insert("notificationDismissals", {
        id: item.id,
        organizationId,
        userId,
        notificationKey: item.notificationKey,
        dismissedAt: item.dismissedAt,
      });
      created++;
    }
    return { created, skipped };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      organizationId: v.optional(v.string()),
      userId: v.optional(v.string()),
      notificationKey: v.optional(v.string()),
      dismissedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("notificationDismissals").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("notificationDismissals not found: " + id);
    const safePatch = { ...patch };
    delete safePatch.organizationId;
    await ctx.db.patch(doc._id, safePatch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("notificationDismissals").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("notificationDismissals not found: " + id);
    await ctx.db.delete(doc._id);
  },
});
