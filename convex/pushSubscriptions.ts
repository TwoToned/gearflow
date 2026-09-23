import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { requireSelfScope, getAuthContext, isMemberAuth } from "./lib/auth";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Web Push subscriptions (#1244, design §13 "web push"). Personal-scope
 * reads — a caller only ever sees whether THEIR OWN device is subscribed,
 * never another member's. Writes live in `pushSubscriptionsWrites.ts`.
 *
 * Sending: `convex/followUpPush.ts` (service-only) reads these rows for the
 * urgent follow-up push, FEATUREDOCS/82.
 */

/** Whether the CALLING user has an active push subscription in this org (for
 *  the settings toggle's initial state) — org-checked via requireSelfScope,
 *  same posture as workSignalStatesWrites.ts's requireSelfAuth. */
export const isSubscribed = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: a signed-in user is required.");
    await requireSelfScope(ctx, "read");
    const row = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_organizationId_userId", (q) => q.eq("organizationId", orgId).eq("userId", auth.userId))
      .first();
    return row != null;
  },
});

export const agentOps: AgentOpsAnnotations = {
  isSubscribed: { summary: "Whether the calling user has an active Web Push subscription.", danger: "low", mcpTier: 3 },
};
