import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * `record` — the transitional Postgres→Convex bridge for the audit log.
 *
 * The 5 inverted domains already write `activityLogs` atomically inside their native
 * mutations (convex/lib/audit.ts `writeActivityLog`). The other ~39 domains still emit
 * audit via `logActivity` (src/lib/activity-log.ts, a Postgres write). To make the
 * activity-log SCREENS readable from Convex, every `logActivity` call also mirrors its
 * row here (browser-direct; the NATIVE_ACTIVITY_WRITES legacy gate was removed in the cutover), so Convex holds the COMPLETE history.
 *
 * Idempotent by cuid (`createIfMissing` convention): a retried/duplicate `logActivity`
 * mirror must not double-insert. `id` + `createdAt` are caller-supplied (a cuid +
 * Date.now()) so the Convex row matches the Postgres row exactly. Service-token only —
 * `logActivity` calls it via the server's `getConvexClient()`.
 */
const activityLogFields = {
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
};

async function insertIfMissing(
  ctx: MutationCtx,
  entry: { id: string } & Record<string, unknown>,
): Promise<boolean> {
  const existing = await ctx.db
    .query("activityLogs")
    .withIndex("by_cuid", (q) => q.eq("id", entry.id))
    .first();
  if (existing) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ctx.db.insert("activityLogs", entry as any);
  return true;
}

export const record = mutation({
  args: activityLogFields,
  handler: async (ctx, entry) => {
    await requireService(ctx);
    const created = await insertIfMissing(ctx, entry);
    return { created };
  },
});

/**
 * Batched sibling of `record`: mirror N audit rows in ONE Convex round-trip instead
 * of N. Used by `logActivityMany` (src/lib/activity-log.ts) so a bulk warehouse
 * action (check-out / return / prep / deprep of a batch) writes its per-item audit
 * entries without a network round-trip per item. Still idempotent per cuid — one
 * doc per row, so audit granularity is identical to N separate `record` calls.
 */
export const recordMany = mutation({
  args: { rows: v.array(v.object(activityLogFields)) },
  handler: async (ctx, { rows }) => {
    await requireService(ctx);
    let created = 0;
    for (const entry of rows) {
      if (await insertIfMissing(ctx, entry)) created += 1;
    }
    return { created };
  },
});
