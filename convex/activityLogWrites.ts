import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * `record` — the transitional Postgres→Convex bridge for the audit log.
 *
 * The 5 inverted domains already write `activityLogs` atomically inside their native
 * mutations (convex/lib/audit.ts `writeActivityLog`). The other ~39 domains still emit
 * audit via `logActivity` (src/lib/activity-log.ts, a Postgres write). To make the
 * activity-log SCREENS readable from Convex, every `logActivity` call also mirrors its
 * row here (behind `NATIVE_ACTIVITY_WRITES`), so Convex holds the COMPLETE history.
 *
 * Idempotent by cuid (`createIfMissing` convention): a retried/duplicate `logActivity`
 * mirror must not double-insert. `id` + `createdAt` are caller-supplied (a cuid +
 * Date.now()) so the Convex row matches the Postgres row exactly. Service-token only —
 * `logActivity` calls it via the server's `getConvexClient()`.
 */
export const record = mutation({
  args: {
    id: v.string(),
    organizationId: v.string(),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    entityName: v.string(),
    userId: v.optional(v.string()),
    userName: v.string(),
    summary: v.string(),
    details: v.optional(v.any()),
    metadata: v.optional(v.any()),
    projectId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    kitId: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, entry) => {
    await requireService(ctx);
    const existing = await ctx.db
      .query("activityLogs")
      .withIndex("by_cuid", (q) => q.eq("id", entry.id))
      .first();
    if (existing) return { created: false as const };
    await ctx.db.insert("activityLogs", { ...entry });
    return { created: true as const };
  },
});
