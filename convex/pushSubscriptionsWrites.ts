import { v, ConvexError } from "convex/values";
import { createId } from "@paralleldrive/cuid2";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { assertStrLen } from "./lib/fieldGuards";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Browser-direct USER-scoped writes for `pushSubscriptions` (#1244, design
 * §13). Same posture as `workSignalStatesWrites.ts`: a row is owned by the
 * (organizationId, userId) baked into the VERIFIED token, so a caller only
 * ever creates/removes their OWN device's subscription.
 *
 * `endpoint` is the natural upsert key — a browser calling
 * `PushManager.subscribe()` again on the same device (e.g. after the keys
 * rotate) returns either the same endpoint or a fresh one; either way this
 * upserts rather than duplicates. `by_endpoint` is a GLOBAL index (a push
 * endpoint URL is unique to the browser install, not scoped to an org), so
 * every read through it is org/user re-checked in-handler (R-8.4.3).
 */

async function requireSelfAuth(ctx: MutationCtx) {
  const auth = await getAuthContext(ctx);
  if (!isMemberAuth(auth)) throw new ConvexError("Unauthorized: a signed-in user is required.");
  if (!auth.orgId) throw new ConvexError("Forbidden: no active organization.");
  await requireSelfScope(ctx, "write");
  return { orgId: auth.orgId, userId: auth.userId };
}

/** Subscribe (or re-subscribe) THIS device to Web Push for the caller's own
 *  org/user. `p256dh`/`auth` are the subscription's public key + auth secret
 *  as returned by `PushSubscription.toJSON().keys` — opaque strings, not
 *  validated beyond a length bound (R-8.6.2: a browser-direct caller
 *  bypassing client validation must not be able to write unbounded blobs). */
export const subscribeNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "pushSubscription");
    await enforceBrowserWriteLimit(ctx);
    const { orgId, userId } = await requireSelfAuth(ctx);

    assertStrLen(a.endpoint, "endpoint", { min: 1, max: 2000 });
    assertStrLen(a.p256dh, "p256dh", { min: 1, max: 500 });
    assertStrLen(a.auth, "auth", { min: 1, max: 500 });
    assertStrLen(a.userAgent, "userAgent", { max: 500 });

    const existing = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", a.endpoint)).first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        organizationId: orgId,
        userId,
        p256dh: a.p256dh,
        auth: a.auth,
        userAgent: a.userAgent,
        updatedAt: a.now,
      });
      return { id: existing.id };
    }

    const id = createId();
    await ctx.db.insert("pushSubscriptions", {
      id,
      organizationId: orgId,
      userId,
      endpoint: a.endpoint,
      p256dh: a.p256dh,
      auth: a.auth,
      userAgent: a.userAgent,
      createdAt: a.now,
      updatedAt: a.now,
    });
    return { id };
  },
});

/** Unsubscribe THIS device — only the owning user can remove their own row
 *  (an endpoint belonging to a different user/org in this same browser
 *  profile, e.g. after a re-login, is left alone rather than deleted). */
export const unsubscribeNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    await assertWritesEnabled(ctx, "pushSubscription");
    await enforceBrowserWriteLimit(ctx);
    const { orgId, userId } = await requireSelfAuth(ctx);

    const existing = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).first();
    if (existing && existing.organizationId === orgId && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
    return { ok: true };
  },
});

// Not denied to agents (the guard is `requireSelfScope`, which — like every
// self-scope surface — admits an agent token acting AS the user, per
// CLAUDE.md's "an agent behaves as a user everywhere" rule); a push
// subscription is simply low-value/rarely-useful for an agent caller (no
// browser to hold the keys), hence mcpTier 3 rather than a denial.
export const agentOps: AgentOpsAnnotations = {
  subscribeNative: { summary: "Register this browser's Web Push subscription for the calling user.", danger: "low", mcpTier: 3 },
  unsubscribeNative: { summary: "Remove this browser's Web Push subscription.", danger: "low", mcpTier: 3 },
};
