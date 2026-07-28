import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Browser-direct USER-scoped notification-dismissal read + writes (Phase 3 —
 * replaces the getDismissedKeys / dismissNotification / dismissNotifications /
 * pruneStaleDismissals server actions in src/server/notifications.ts).
 *
 * Dismissals are PER-USER-WITHIN-ORG: the row key is (organizationId, userId,
 * notificationKey). There is no org-row to authorize with a resource permission —
 * a member simply owns their own dismissal set. Security therefore hinges on
 * deriving BOTH ids from the VERIFIED token (getAuthContext) — NEVER a client arg
 * — so a member can only ever read/write their OWN dismissals in THEIR active org.
 *
 * These are NOT audited (parity — the deleted server actions logged no activity;
 * a dismissal is a personal UI preference, not a domain event). So no resolveActor
 * / writeActivityLog — the verified userId/orgId are read straight off the token.
 *
 * The service-token thin CRUD in convex/notificationDismissals.ts (list /
 * createManyIfMissing / remove) is retained for the in-flight deployed app image,
 * which still calls it through the server action until Coolify ships this branch.
 */

/**
 * The verified caller's dismissed notification keys in their ACTIVE org. Reactive
 * (subscribes) — replaces the `["notification-dismissals", orgId]` useServerQuery
 * poll; a dismiss/prune write updates this live with no manual refetch. Returns []
 * for an unauthenticated / org-less caller (the page renders "nothing dismissed").
 */
export const mine = query({
  returns: v.array(v.string()),
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth) || !auth.orgId) return [];
    await requireSelfScope(ctx, "read");
    const rows = await ctx.db
      .query("notificationDismissals")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", auth.orgId as string).eq("userId", auth.userId),
      )
      .collect();
    return rows.map((r) => r.notificationKey);
  },
});

/**
 * Dismiss one-or-many notification keys for the verified caller in their active
 * org, in ONE call (powers both the bell's single-dismiss and the page's "Dismiss
 * All"). Idempotent: a key already dismissed in THIS org is skipped. Dedup is
 * PER-ORG — the two constant crew keys (crew-pending-offers / -timesheets) recur
 * across orgs, and a multi-org user must be able to dismiss them in each org
 * separately (mine() is org-scoped), so by_userId_notificationKey (GLOBAL) is
 * filtered by organizationId. Client mints the `id` per item + a single `now`.
 */
export const dismissManyNative = mutation({
  returns: v.object({ created: v.number(), skipped: v.number() }),
  args: {
    items: v.array(v.object({ id: v.string(), notificationKey: v.string() })),
    now: v.number(),
  },
  handler: async (ctx, { items, now }) => {
    await assertWritesEnabled(ctx, "notifications");
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

    // Dedup the incoming keys (a client could pass the same key twice); keep the
    // first id/key pair for each.
    const seen = new Set<string>();
    const deduped = items.filter((it) => {
      if (!it.notificationKey || seen.has(it.notificationKey)) return false;
      seen.add(it.notificationKey);
      return true;
    });

    let created = 0;
    let skipped = 0;
    for (const item of deduped) {
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
        dismissedAt: now,
      });
      created++;
    }
    return { created, skipped };
  },
});

/**
 * Garbage-collect the caller's dismissal rows whose key is no longer in the active
 * notification set. Scoped to the verified (organizationId, userId) — a caller can
 * only prune their OWN rows. Empty activeKeys → prune everything (parity with the
 * old `notIn: [""]` sentinel; no real key is the empty string).
 */
export const pruneStaleNative = mutation({
  returns: v.object({ removed: v.number() }),
  args: { activeKeys: v.array(v.string()) },
  handler: async (ctx, { activeKeys }) => {
    await assertWritesEnabled(ctx, "notifications");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) {
      throw new ConvexError("Unauthorized: a signed-in user is required.");
    }
    if (!auth.orgId) {
      throw new ConvexError("Forbidden: no active organization.");
    }
    await requireSelfScope(ctx, "write");
    const active = new Set(activeKeys);
    const rows = await ctx.db
      .query("notificationDismissals")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", auth.orgId as string).eq("userId", auth.userId),
      )
      .collect();
    let removed = 0;
    for (const r of rows) {
      if (!active.has(r.notificationKey)) {
        await ctx.db.delete(r._id);
        removed++;
      }
    }
    return { removed };
  },
});

/**
 * Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9).
 * Personal-scope (self:write) UI preference bookkeeping — no domain effect.
 */
export const agentOps: AgentOpsAnnotations = {
  dismissManyNative: { danger: "low" },
  pruneStaleNative: { danger: "low" },
};
