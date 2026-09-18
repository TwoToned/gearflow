import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, isMemberAuth, requireSelfScope } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import type { AgentOpsAnnotations } from "./lib/agentOps";

/**
 * Browser-direct USER-scoped dashboard layout (the customizable widget-board
 * dashboard, #1267). At most one row per (organizationId, userId) — mirrors
 * `orgActivationDismissalsWrites.ts` / `savedTableViewsWrites.ts`'s shape: a
 * member owns their own board, so both ids are derived from the VERIFIED
 * token (`getAuthContext`), never a client arg. No resource permission to
 * check (a personal arrangement of widgets, not a domain object) —
 * `requireSelfScope` is the whole guard, same pattern as saved table views.
 * Not audited: a personal UI preference, not a domain event (same call as
 * `orgActivationDismissalsWrites.dismissNative`).
 */

const widgetValidator = v.object({
  id: v.string(),
  kind: v.string(),
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
});

export type DashboardLayoutWidget = {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

// Generous but bounded — a hand-rolled or replayed client payload can't grow
// the row without limit (mirrors `savedTableViewsWrites.ts`'s MAX_NAME-style
// server-side re-check of a client-facing bound, R-8.6.3).
const MAX_WIDGETS = 40;

/** The verified caller's saved layout for their ACTIVE org, or `null` if none
 *  has ever been saved (the client falls back to `DEFAULT_LAYOUT` — see
 *  `src/lib/dashboard-widgets.ts` — rather than this query inventing one, so
 *  the default lives in exactly one place). */
export const get = query({
  returns: v.union(
    v.object({ id: v.string(), widgets: v.array(widgetValidator), updatedAt: v.number() }),
    v.null(),
  ),
  args: {},
  handler: async (ctx) => {
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth) || !auth.orgId) return null;
    await requireSelfScope(ctx, "read");
    const rows = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", auth.orgId as string).eq("userId", auth.userId),
      )
      .order("desc")
      .take(1);
    const doc = rows[0];
    if (!doc) return null;
    return { id: doc.id, widgets: doc.widgets, updatedAt: doc.updatedAt };
  },
});

// Split out of `assertValidWidgets` (R-3.6 — the combined form crossed the
// complexity-ratchet threshold): each check is its own small, single-purpose
// guard rather than one function branching on all of them.
function assertValidPosition(w: DashboardLayoutWidget): void {
  if (!Number.isFinite(w.x) || !Number.isFinite(w.y) || w.x < 0 || w.y < 0) {
    throw new ConvexError("Invalid widget position.");
  }
}

function assertValidSize(w: DashboardLayoutWidget): void {
  if (!Number.isFinite(w.w) || !Number.isFinite(w.h) || w.w <= 0 || w.h <= 0) {
    throw new ConvexError("Invalid widget size.");
  }
}

function assertValidWidgets(widgets: DashboardLayoutWidget[]): void {
  if (widgets.length > MAX_WIDGETS) {
    throw new ConvexError(`A dashboard board may hold at most ${MAX_WIDGETS} widgets.`);
  }
  const seen = new Set<string>();
  for (const w of widgets) {
    if (seen.has(w.id)) throw new ConvexError("Duplicate widget id in layout.");
    seen.add(w.id);
    assertValidPosition(w);
    assertValidSize(w);
  }
}

/** Upsert the caller's whole board in one write — the client commits on
 *  drag/resize END (debounced), never per intermediate frame, so this is a
 *  low-frequency personal-preference write, not a hot path. Idempotent: the
 *  latest write always wins, there is nothing to merge. */
export const saveNative = mutation({
  returns: v.object({ ok: v.boolean() }),
  args: { id: v.string(), widgets: v.array(widgetValidator), now: v.number() },
  handler: async (ctx, { id, widgets, now }) => {
    await assertWritesEnabled(ctx, "dashboard-layout");
    await enforceBrowserWriteLimit(ctx);
    const auth = await getAuthContext(ctx);
    if (!isMemberAuth(auth)) {
      throw new ConvexError("Unauthorized: a signed-in user is required.");
    }
    if (!auth.orgId) {
      throw new ConvexError("Forbidden: no active organization.");
    }
    await requireSelfScope(ctx, "write");
    assertValidWidgets(widgets);
    const organizationId = auth.orgId;
    const userId = auth.userId;
    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_organizationId_userId", (q) =>
        q.eq("organizationId", organizationId).eq("userId", userId),
      )
      .take(1);
    if (existing.length > 0) {
      await ctx.db.patch(existing[0]._id, { widgets, updatedAt: now });
    } else {
      await ctx.db.insert("dashboardLayouts", { id, organizationId, userId, widgets, updatedAt: now });
    }
    return { ok: true };
  },
});

/**
 * Danger classification (CLAUDE.md's agentOps rule) — personal-scope
 * (self:read/self:write) UI arrangement, trivially reset by the owner
 * (`DEFAULT_LAYOUT`) — no domain effect, so `low` like every other
 * self-scoped preference write in this codebase.
 */
export const agentOps: AgentOpsAnnotations = {
  get: { summary: "Get the caller's own saved dashboard widget layout.", danger: "low", mcpTier: 3 },
  saveNative: { summary: "Save the caller's own dashboard widget layout (positions/sizes).", danger: "low", mcpTier: 3 },
};
