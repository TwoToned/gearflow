import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Browser-direct USER-scoped dismissal for the dashboard's "Get started"
 * activation checklist (D1, #1105). At most one row per (organizationId,
 * userId) — mirrors `orgSetupDismissalsWrites.ts` file-for-file (see the
 * schema comment on `orgActivationDismissals` for why it's a separate table
 * rather than a reuse of either the setup-checklist table or
 * `notificationDismissals`).
 *
 * Same security shape: no org-row to authorize against a resource
 * permission — a member owns their own dismissal — so both ids are derived
 * from the VERIFIED token (`getAuthContext`), never a client arg. Not
 * audited: a personal UI preference, not a domain event.
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
      .query("orgActivationDismissals")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", auth.orgId as string).eq("userId", auth.userId),
      )
      .order("desc")
      .take(1);
    return rows[0]?.dismissedAt ?? null;
  },
});

/** Dismiss the checklist for the verified caller in their active org.
 *  Idempotent: a second call is a no-op (`created: false`) rather than a
 *  second row. Convex's OCC already serializes two concurrent calls for the
 *  same (org, user) — one would conflict and retry, re-observing the row the
 *  other just inserted — so this shouldn't be reachable in practice; the
 *  `.take(1)` + length check (not `.unique()`) is defense in depth so that
 *  IF it ever were, the result is "one harmless extra row, newest wins on
 *  read" (see `mine()`'s `.order("desc")`) rather than `mine()` throwing. */
export const dismissNative = mutation({
  returns: v.object({ created: v.boolean() }),
  args: { id: v.string(), now: v.number() },
  handler: async (ctx, { id, now }) => {
    // Own domain, deliberately NOT "org-setup" — this is a different feature
    // with a different lifetime, so an operator killing setup-checklist
    // writes during an incident shouldn't silently kill this one too.
    await assertWritesEnabled(ctx, "org-activation");
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
      .query("orgActivationDismissals")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", organizationId).eq("userId", userId),
      )
      .take(1);
    if (existing.length > 0) return { created: false };
    await ctx.db.insert("orgActivationDismissals", { id, organizationId, userId, dismissedAt: now });
    return { created: true };
  },
});

/**
 * Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9).
 * Personal-scope (self:write) UI preference bookkeeping — no domain effect.
 */
export const agentOps: AgentOpsAnnotations = {
  dismissNative: { summary: "Dismiss the caller's 'Get started' activation checklist card.", danger: "low", mcpTier: 3 },
};
