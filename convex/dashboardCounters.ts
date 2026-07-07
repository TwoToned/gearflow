import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireService, requireOrgRead } from "./lib/auth";

/**
 * Denormalised dashboard stat counters (Phase 3). One `dashboardCounters` row per
 * org holds the counts `getDashboardStats` used to derive by whole-org `.collect()`
 * + JS counting — so the native dashboard reads them O(1) instead of scanning the
 * asset registry / line-item table (the top Convex-limit risk in the migration).
 *
 * Maintenance (§3.6): the six counters are kept fresh IN-TRANSACTION on every
 * counted write by `convex/lib/counters.ts` (`bumpCountersForTable` for the
 * generated CRUD + per-entity `bump*Counters` for the custom / native / warehouseOps
 * sites) — a signed delta applied in the same mutation as the data change, so the
 * native dashboard never has to scan the whole-org registry on view. `reconcile`
 * recomputes all six from source (backfill + a PERIODIC DRIFT BACKSTOP, no longer
 * the primary freshness mechanism — the client now throttles `reconcileIfStale` to a
 * long window). `bump` (this file) is the legacy single-field public entry point,
 * retained for the reconcile parity test + any future service hook. The date-derived
 * metrics (maintenanceDue, overdueReturns) are NOT stored — `dashboardStats.bundle`
 * computes them at read from bounded indexed queries.
 */

export const COUNTER_FIELDS = [
  "activeAssets",
  "checkedOutAssets",
  "bulkQuantity",
  "activeProjects",
  "activeCrew",
  "pendingCrewOffers",
] as const;
export type CounterField = (typeof COUNTER_FIELDS)[number];

const ACTIVE_PROJECT_STATUSES = new Set(["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"]);
const PENDING_OFFER_STATUSES = new Set(["OFFERED", "PENDING"]);

export interface CounterValues {
  activeAssets: number;
  checkedOutAssets: number;
  bulkQuantity: number;
  activeProjects: number;
  activeCrew: number;
  pendingCrewOffers: number;
}

/**
 * Authoritative recompute of the six counters from source — the SAME predicates
 * getDashboardStats applies (parity-by-construction). Reads are org-scoped via
 * by_organizationId. Used by reconcile + the parity test.
 */
export async function computeCounters(ctx: QueryCtx, orgId: string): Promise<CounterValues> {
  const [assets, bulkAssets, projects, crewMembers, crewAssignments] = await Promise.all([
    ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
    ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(),
  ]);

  const activeAssetDocs = assets.filter((a) => a.isActive !== false);
  const activeBulk = bulkAssets.filter((b) => b.isActive !== false);

  return {
    activeAssets: activeAssetDocs.length,
    checkedOutAssets: activeAssetDocs.filter((a) => a.status === "CHECKED_OUT").length,
    bulkQuantity: activeBulk.reduce((sum, b) => sum + (b.totalQuantity ?? 0), 0),
    activeProjects: projects.filter((p) => p.isTemplate !== true && ACTIVE_PROJECT_STATUSES.has(p.status ?? "")).length,
    activeCrew: crewMembers.filter((m) => m.status === "ACTIVE").length,
    pendingCrewOffers: crewAssignments.filter((a) => a.status != null && PENDING_OFFER_STATUSES.has(a.status)).length,
  };
}

async function reconcileOrg(ctx: MutationCtx, orgId: string, now: number): Promise<CounterValues> {
  const values = await computeCounters(ctx, orgId);
  const existing = await ctx.db
    .query("dashboardCounters")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { ...values, updatedAt: now });
  } else {
    await ctx.db.insert("dashboardCounters", { organizationId: orgId, ...values, updatedAt: now });
  }
  return values;
}

/** Recompute + persist all six counters for an org (backfill + drift correction). */
export const reconcile = mutation({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, { orgId, now }) => {
    await requireService(ctx);
    return await reconcileOrg(ctx, orgId, now);
  },
});

/**
 * DRIFT BACKSTOP — throttled reconcile triggered by the native dashboard on view:
 * recompute only when the row is missing or its last reconcile (`updatedAt`) is
 * older than `maxAgeMs`. Counters are now primarily maintained per-write
 * (convex/lib/counters.ts); this catches any residual drift (a missed write site, a
 * clamp) and creates the row for a brand-new org on first view. Because it's
 * throttled to a long window (client passes ~1h) a populated row is a cheap no-op —
 * no whole-org scan on the hot path. Gated on requireOrgRead so an org member can
 * only refresh their own org's counters. `now` is passed (Convex mutations can't
 * read the clock).
 */
export const reconcileIfStale = mutation({
  args: { orgId: v.string(), now: v.number(), maxAgeMs: v.number() },
  handler: async (ctx, { orgId, now, maxAgeMs }) => {
    await requireOrgRead(ctx, orgId);
    const existing = await ctx.db
      .query("dashboardCounters")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .first();
    if (existing && existing.updatedAt > now - maxAgeMs) {
      return { reconciled: false }; // still fresh — cheap no-op
    }
    await reconcileOrg(ctx, orgId, now);
    return { reconciled: true };
  },
});

/**
 * Incremental adjust of a single counter field by `delta` (the write-path hook).
 * Idempotency is NOT guaranteed (it's additive) — `reconcile` is the drift
 * backstop. Clamps at 0 so a double-decrement can't go negative. Creates the row
 * (zeroed) on first bump so a fresh org still tracks.
 */
export const bump = mutation({
  args: { orgId: v.string(), field: v.string(), delta: v.number(), now: v.number() },
  handler: async (ctx, { orgId, field, delta, now }) => {
    await requireService(ctx);
    if (!(COUNTER_FIELDS as readonly string[]).includes(field)) {
      return; // unknown field — ignore (forward-compat)
    }
    const existing = await ctx.db
      .query("dashboardCounters")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .first();
    if (existing) {
      const current = (existing as unknown as Record<string, number>)[field] ?? 0;
      await ctx.db.patch(existing._id, { [field]: Math.max(0, current + delta), updatedAt: now });
    } else {
      // Seed a zeroed row, then apply the delta to the one field.
      const zero: CounterValues = {
        activeAssets: 0, checkedOutAssets: 0, bulkQuantity: 0,
        activeProjects: 0, activeCrew: 0, pendingCrewOffers: 0,
      };
      await ctx.db.insert("dashboardCounters", {
        organizationId: orgId,
        ...zero,
        [field]: Math.max(0, delta),
        updatedAt: now,
      });
    }
  },
});

/** Read the counter row for an org (browser-safe; org-scoped). */
export const getByOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    return await ctx.db
      .query("dashboardCounters")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .first();
  },
});
