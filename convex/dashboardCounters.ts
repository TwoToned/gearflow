import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireService, requireOrgRead } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { setCounter, addToCounter, readCounter } from "./lib/shardedCounter";

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
    ctx.db.query("assets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: counter reconcile/recompute, not the hot path
    ctx.db.query("bulkAssets").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: counter reconcile/recompute, not the hot path
    ctx.db.query("projects").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: counter reconcile/recompute, not the hot path
    ctx.db.query("crewMembers").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: counter reconcile/recompute, not the hot path
    ctx.db.query("crewAssignments").withIndex("by_organizationId", (q) => q.eq("organizationId", orgId)).collect(), // r9.8-ok: counter reconcile/recompute, not the hot path
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

export const ZERO_COUNTERS: CounterValues = {
  activeAssets: 0, checkedOutAssets: 0, bulkQuantity: 0,
  activeProjects: 0, activeCrew: 0, pendingCrewOffers: 0,
};

async function reconcileOrg(ctx: MutationCtx, orgId: string, now: number): Promise<CounterValues> {
  const values = await computeCounters(ctx, orgId);
  // SET each sharded counter to the absolute source recompute (the live truth).
  for (const field of COUNTER_FIELDS) {
    await setCounter(ctx, orgId, field, values[field]);
  }
  // The row is the reconcile snapshot + `updatedAt` freshness marker + `shardsSeededAt`
  // ready marker (set here, once shards are seeded). The LIVE counts are the sharded
  // sums above — the row's snapshot is only for parity/debug.
  const existing = await ctx.db
    .query("dashboardCounters")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { ...values, updatedAt: now, shardsSeededAt: now });
  } else {
    await ctx.db.insert("dashboardCounters", { organizationId: orgId, ...values, updatedAt: now, shardsSeededAt: now });
  }
  return values;
}

/**
 * Read the six LIVE counter values for an org from the sharded counters (each summed
 * across its shards, clamped ≥0). This is the source of truth between reconciles.
 */
export async function readCounterValues(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<CounterValues> {
  const entries = await Promise.all(
    COUNTER_FIELDS.map(async (f) => [f, await readCounter(ctx, orgId, f)] as const),
  );
  return Object.fromEntries(entries) as unknown as CounterValues;
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
    await assertWritesEnabled(ctx, "dashboard"); // browser-direct kill-switch
    await enforceBrowserWriteLimit(ctx); // per-user browser-direct budget
    await requireOrgRead(ctx, orgId);
    const existing = await ctx.db
      .query("dashboardCounters")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .first();
    // Reconcile when missing, stale, OR the sharded counters were never seeded (a
    // legacy pre-migration row: fresh `updatedAt` but no `shardsSeededAt`). The last
    // case makes the migration self-heal on first dashboard view — no manual backfill
    // required — and until it runs the org reads as not-ready (client shows a loading state).
    if (existing && existing.shardsSeededAt && existing.updatedAt > now - maxAgeMs) {
      return { reconciled: false }; // still fresh + seeded — cheap no-op
    }
    await reconcileOrg(ctx, orgId, now);
    return { reconciled: true };
  },
});

/**
 * Legacy single-field delta entry point (service-only), retained for the reconcile
 * parity test + any future service hook. A PURE sharded increment — clamping moves to
 * the read (`readCounter`) and `reconcile` sets the absolute value. bump does NOT touch
 * the row's `updatedAt` / `shardsSeededAt` markers: marking ready here would expose
 * partial counts, and advancing freshness would indefinitely postpone reconcile's
 * drift-correction (reconcile is the ONLY writer that seeds shards + sets shardsSeededAt).
 * `now` is accepted for the stable public contract but unused.
 */
export const bump = mutation({
  args: { orgId: v.string(), field: v.string(), delta: v.number(), now: v.number() },
  handler: async (ctx, { orgId, field, delta }) => {
    await requireService(ctx);
    if (!(COUNTER_FIELDS as readonly string[]).includes(field)) {
      return; // unknown field — ignore (forward-compat)
    }
    await addToCounter(ctx, orgId, field, delta);
  },
});

/**
 * Read an org's counters (browser-safe; org-scoped). Returns the LIVE sharded sums
 * plus the row's `updatedAt`; returns null when the org has never been reconciled
 * (no row / unseeded shards = not ready → the client shows a loading state).
 */
export const getByOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireOrgRead(ctx, orgId);
    const row = await ctx.db
      .query("dashboardCounters")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
      .first();
    // Not ready until the shards are seeded (a legacy row exists but has unseeded
    // shards → its sharded sums would be wrong-zeros). Client treats null as loading.
    if (!row?.shardsSeededAt) return null;
    const values = await readCounterValues(ctx, orgId);
    return { organizationId: orgId, ...values, updatedAt: row.updatedAt };
  },
});
