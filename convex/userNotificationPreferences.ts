import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireService, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import {
  resolvePreferenceValues,
  type NotificationPreferenceValues,
} from "./lib/notificationPreferences";

/**
 * Thin CRUD for UserNotificationPreference (Convex table "userNotificationPreferences"). GENERATED — Phase 2/5.
 *
 * AUTH (Phase 5, convex/lib/auth.ts): mutations require the trusted backend
 * SERVICE token (service-only mirror/read helpers; the browser-direct write path with RBAC +
 * validation + audit enforced inside Convex lives in the *Writes.ts mutations — see FEATUREDOCS/54). Reads are
 * service-only (not on the browser-readable allowlist). Lookups use the
 * cuid (`id`) via by_cuid. See FEATUREDOCS/54.
 */

export const list = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await requireService(ctx);
    return await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    return await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
  },
});

export const create = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    overdueMaintenance: v.optional(v.boolean()),
    overdueReturn: v.optional(v.boolean()),
    upcomingProject: v.optional(v.boolean()),
    lowStock: v.optional(v.boolean()),
    pendingInvitation: v.optional(v.boolean()),
    expiringCert: v.optional(v.boolean()),
    pendingOffers: v.optional(v.boolean()),
    pendingTimesheets: v.optional(v.boolean()),
    flaggedAsset: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    return await ctx.db.insert("userNotificationPreferences", args);
  },
});

export const createIfMissing = mutation({
  args: {
    id: v.string(),
    userId: v.string(),
    overdueMaintenance: v.optional(v.boolean()),
    overdueReturn: v.optional(v.boolean()),
    upcomingProject: v.optional(v.boolean()),
    lowStock: v.optional(v.boolean()),
    pendingInvitation: v.optional(v.boolean()),
    expiringCert: v.optional(v.boolean()),
    pendingOffers: v.optional(v.boolean()),
    pendingTimesheets: v.optional(v.boolean()),
    flaggedAsset: v.optional(v.boolean()),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireService(ctx);
    const existing = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", args.id)).unique();
    if (existing) return { _id: existing._id, created: false };
    const _id = await ctx.db.insert("userNotificationPreferences", args);
    return { _id, created: true };
  },
});

export const update = mutation({
  args: {
    id: v.string(),
    patch: v.object({
      userId: v.optional(v.string()),
      overdueMaintenance: v.optional(v.boolean()),
      overdueReturn: v.optional(v.boolean()),
      upcomingProject: v.optional(v.boolean()),
      lowStock: v.optional(v.boolean()),
      pendingInvitation: v.optional(v.boolean()),
      expiringCert: v.optional(v.boolean()),
      pendingOffers: v.optional(v.boolean()),
      pendingTimesheets: v.optional(v.boolean()),
      flaggedAsset: v.optional(v.boolean()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("userNotificationPreferences not found: " + id);
    await ctx.db.patch(doc._id, patch);
    return doc._id;
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const doc = await ctx.db.query("userNotificationPreferences").withIndex("by_cuid", (q) => q.eq("id", id)).unique();
    if (!doc) throw new ConvexError("userNotificationPreferences not found: " + id);
    await ctx.db.delete(doc._id);
  },
});

// ─── Browser-direct USER-scoped read + write (Phase 3) ──────────────────────
//
// Preferences are PER-USER, not per-org: the row key is the caller's user id, and
// there is no org-row to re-check. Security therefore hinges on deriving that user id
// from the VERIFIED token subject (getAuthContext) — NEVER a client arg — so a member
// can only ever read/write their OWN row. This replaces the getNotificationPreferences
// / updateNotificationPreferences server actions in src/server/notification-preferences.ts.

export const prefFields = {
  overdueMaintenance: v.boolean(),
  overdueReturn: v.boolean(),
  upcomingProject: v.boolean(),
  pendingInvitation: v.boolean(),
  pendingOffers: v.boolean(),
  pendingTimesheets: v.boolean(),
  flaggedAsset: v.boolean(),
};

const prefValuesValidator = v.object(prefFields);

/** The verified caller's resolved preference values (defaults when no row exists). */
export const mine = query({
  returns: prefValuesValidator,
  args: {},
  handler: async (ctx): Promise<NotificationPreferenceValues> => {
    const auth = await getAuthContext(ctx);
    if (!auth || auth.kind !== "user") {
      throw new ConvexError("Unauthorized: a signed-in user is required.");
    }
    const row = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", auth.userId))
      .first();
    return resolvePreferenceValues(row);
  },
});

/**
 * Upsert the verified caller's preferences by the natural key (their user id). Patches
 * an existing row (leaving non-form columns like lowStock/expiringCert untouched) or
 * inserts a new one at the client-minted `id`. Writes an audit row in the same
 * transaction. The seven booleans are validated by the form's zodResolver + the v.*
 * arg validators; the row is always keyed on the verified subject, so `id` is only
 * consumed on the create branch.
 */
export const upsertMine = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: {
    id: v.string(),
    prefs: prefValuesValidator,
    actor: v.object({ userId: v.string(), userName: v.string() }),
    auditId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { id, prefs, actor: suppliedActor, auditId, now }) => {
    await assertWritesEnabled(ctx, "notificationPreferences");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!auth || auth.kind !== "user") {
      throw new ConvexError("Unauthorized: a signed-in user is required.");
    }
    if (!auth.orgId) {
      throw new ConvexError("Forbidden: no active organization.");
    }
    // Pins userId to the verified subject + resolves the display name from the users
    // mirror (the row key + audit attribution can't be spoofed by the client).
    const actor = await resolveActor(ctx, suppliedActor);

    const existing = await ctx.db
      .query("userNotificationPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", actor.userId))
      .first();

    const savedId = existing ? existing.id : id;
    if (existing) {
      await ctx.db.patch(existing._id, { ...prefs, updatedAt: now });
    } else {
      await ctx.db.insert("userNotificationPreferences", {
        id: savedId,
        userId: actor.userId,
        ...prefs,
        updatedAt: now,
      });
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: auth.orgId,
      action: "updated",
      entityType: "UserNotificationPreference",
      entityId: savedId,
      entityName: "Notification preferences",
      userId: actor.userId,
      userName: actor.userName,
      summary: "Updated email notification preferences",
      createdAt: now,
    });

    return { ok: true };
  },
});
