import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Browser-direct USER-scoped dismissal for the dashboard's "Finish setup"
 * checklist (C6, #1104). At most one row per (organizationId, userId) — this
 * is a single on/off bit, not a keyed set like `notificationDismissals`
 * (deliberately a separate table; see the schema comment on
 * `orgSetupDismissals` for why reusing that one is unsafe here).
 *
 * Same security shape as `notificationDismissalsWrites.ts`: no org-row to
 * authorize against a resource permission — a member owns their own
 * dismissal — so both ids are derived from the VERIFIED token
 * (`getAuthContext`), never a client arg. Not audited: a personal UI
 * preference, not a domain event.
 */

/** The verified caller's dismissal timestamp for their ACTIVE org, or `null`
 *  if never dismissed. Reactive. Returns `null` for an unauthenticated /
 *  org-less caller (the card renders as "not dismissed"). */
export const mine = query({
  returns: v.union(v.number(), v.null()),
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth) || !auth.orgId) return null;
    await requireSelfScope(ctx, "read");
    const rows = await ctx.db
      .query("orgSetupDismissals")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", auth.orgId as string).eq("userId", auth.userId),
      )
      .order("desc")
      .collect();
    return rows[0]?.dismissedAt ?? null;
  },
});

/** Dismiss the checklist for the verified caller in their active org.
 *  Idempotent: a second call is a no-op (`created: false`) rather than a
 *  second row. Convex's OCC already serializes two concurrent calls for the
 *  same (org, user) — one would conflict and retry, re-observing the row the
 *  other just inserted — so this shouldn't be reachable in practice; the
 *  `.collect()` + length check (not `.unique()`) is defense in depth so that
 *  IF it ever were, the result is "one harmless extra row, newest wins on
 *  read" (see `mine()`'s `.order("desc")`) rather than `mine()` throwing. */
export const dismissNative = mutation({
  returns: v.object({ created: v.boolean() }),
  args: { id: v.string(), now: v.number() },
  handler: async (ctx, { id, now }) => {
    // Own domain, deliberately NOT "notifications" — this table has nothing
    // to do with the notification bell, and sharing that domain string would
    // mean an operator killing notification writes during an incident also
    // silently kills this unrelated dismissal with no "setup" anywhere in
    // the flag name to explain why.
    await assertWritesEnabled(ctx, "org-setup");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) {
      throw new ConvexError("Unauthorized: a signed-in user is required.");
    }
    if (!auth.orgId) {
      throw new ConvexError("Forbidden: no active organization.");
    }
    await requireSelfScope(ctx, "write");
    const organizationId = auth.orgId;
    const userId = auth.userId;
    const existing = await ctx.db
      .query("orgSetupDismissals")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", organizationId).eq("userId", userId),
      )
      .collect();
    if (existing.length > 0) return { created: false };
    await ctx.db.insert("orgSetupDismissals", { id, organizationId, userId, dismissedAt: now });
    return { created: true };
  },
});

/**
 * Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9).
 * Personal-scope (self:write) UI preference bookkeeping — no domain effect.
 */
export const agentOps: AgentOpsAnnotations = {
  dismissNative: { summary: "Dismiss the caller's 'Finish setup' checklist card.", danger: "low", mcpTier: 3 },
};
