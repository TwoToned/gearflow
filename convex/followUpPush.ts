import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireService } from "./lib/auth";

/**
 * Follow-up automation — the Convex side of the urgent phone push (design D3,
 * FEATUREDOCS/82). The sender itself (VAPID signing, encryption, the HTTP call)
 * lives in `src/server/follow-up-push.ts`, driven by the notification cron;
 * these SERVICE-only functions are what it calls. No user or agent token
 * reaches any of them.
 *
 * Push is the loudest channel, so it's rationed: only URGENT follow-ups, one
 * push per follow-up rung, and at most `cap` pushes per person per local day.
 * Both limits are claimed in ONE transaction here — two overlapping cron ticks
 * can't both win the last slot — on the `notificationEmailLogs` ledger the
 * morning brief already dedupes on.
 */

async function logExists(ctx: QueryCtx | MutationCtx, id: string): Promise<boolean> {
  return (await ctx.db.query("notificationEmailLogs").withIndex("by_cuid", (q) => q.eq("id", id)).first()) !== null;
}

/** Claim the right to push `itemKey` to `userId` today. False when that item
 *  was already pushed, or the person's daily slots are used up. */
export const claimPush = mutation({
  args: { orgId: v.string(), userId: v.string(), itemKey: v.string(), dayKey: v.string(), cap: v.number(), now: v.number() },
  returns: v.object({ claimed: v.boolean() }),
  handler: async (ctx, { orgId, userId, itemKey, dayKey, cap, now }) => {
    await requireService(ctx);
    if (await logExists(ctx, itemKey)) return { claimed: false };
    for (let slot = 1; slot <= cap; slot++) {
      const slotKey = `${dayKey}:${slot}`;
      if (await logExists(ctx, slotKey)) continue;
      for (const id of [slotKey, itemKey]) {
        await ctx.db.insert("notificationEmailLogs", { id, organizationId: orgId, userId, notificationKey: id, sentAt: now });
      }
      return { claimed: true };
    }
    return { claimed: false };
  },
});

/** A person's push subscriptions in this org (their devices). */
export const subscriptionsForUser = query({
  args: { orgId: v.string(), userId: v.string() },
  returns: v.array(v.object({ endpoint: v.string(), p256dh: v.string(), auth: v.string() })),
  handler: async (ctx, { orgId, userId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", orgId).eq("userId", userId))
      .take(20);
    return rows.map((r) => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
  },
});

/** The push service said this subscription is gone (404/410): drop it. */
export const removeGoneSubscription = mutation({
  args: { orgId: v.string(), endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId, endpoint }) => {
    await requireService(ctx);
    const row = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).first();
    if (row && row.organizationId === orgId) await ctx.db.delete(row._id);
    return null;
  },
});
