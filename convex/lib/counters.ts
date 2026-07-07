import type { MutationCtx } from "../_generated/server";

/**
 * Write-path maintenance for the six denormalised dashboard counters
 * (convex/dashboardCounters.ts). §3.6 of the Convex-native design requires the
 * counts to be updated in the SAME transaction as the write that changes them, so
 * the native dashboard never has to scan the whole-org asset / project / crew
 * registry on view (the migration's top Convex doc/size-limit risk as tenants grow).
 *
 * Each counted write site computes its row's counter CONTRIBUTION before and after
 * the change and applies the difference here. The predicates below MUST stay
 * identical to `computeCounters` in dashboardCounters.ts — parity by construction:
 * the reconcile backstop re-derives from the same predicates, so a per-write miss
 * self-heals on the next reconcile rather than drifting forever.
 * `reconcile` / `reconcileIfStale` remain as a periodic drift backstop; they are no
 * longer the PRIMARY freshness mechanism (the client now throttles reconcile to a
 * long window — see src/hooks/use-native-dashboard.ts).
 *
 * The counter row is created + seeded ONLY by reconcile / backfill (an accurate
 * full recompute). A delta against a MISSING row is skipped: a delta can't
 * reconstruct the pre-existing population, so we let the next reconcile create it
 * correctly. In prod the backfill (`pnpm convex:backfill:dashboard-counters`) runs
 * before NEXT_PUBLIC_NATIVE_DASHBOARD is flipped, so the row exists; a brand-new
 * org's row is created on its first dashboard view (reconcileIfStale).
 */

const ACTIVE_PROJECT_STATUSES = new Set(["CONFIRMED", "PREPPING", "CHECKED_OUT", "ON_SITE"]);
const PENDING_OFFER_STATUSES = new Set(["OFFERED", "PENDING"]);

type CounterField =
  | "activeAssets"
  | "checkedOutAssets"
  | "bulkQuantity"
  | "activeProjects"
  | "activeCrew"
  | "pendingCrewOffers";

type Delta = Partial<Record<CounterField, number>>;

/**
 * Apply a signed delta to an org's counter row, clamped at 0 (a double-decrement
 * can't go negative). No-op when every field is 0, and when the row doesn't exist
 * yet (see the file header). Does NOT touch `updatedAt` — that field tracks the
 * last reconcile, which is what `reconcileIfStale` gates its drift-backstop on.
 */
async function applyDelta(ctx: MutationCtx, orgId: string, delta: Delta): Promise<void> {
  let changed = false;
  for (const key in delta) {
    if (delta[key as CounterField]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;

  const row = await ctx.db
    .query("dashboardCounters")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  if (!row) return; // not yet backfilled — reconcile will create it accurately

  const patch: Record<string, number> = {};
  for (const key in delta) {
    const d = delta[key as CounterField];
    if (!d) continue;
    const cur = (row as unknown as Record<string, number>)[key] ?? 0;
    patch[key] = Math.max(0, cur + d);
  }
  await ctx.db.patch(row._id, patch);
}

// ── Per-entity counter contribution (MUST match computeCounters predicates) ──

type AssetLike = { isActive?: boolean; status?: string } | null | undefined;
const assetActive = (a: AssetLike) => (a && a.isActive !== false ? 1 : 0);
const assetCheckedOut = (a: AssetLike) => (a && a.isActive !== false && a.status === "CHECKED_OUT" ? 1 : 0);

type BulkLike = { isActive?: boolean; totalQuantity?: number } | null | undefined;
const bulkQty = (b: BulkLike) => (b && b.isActive !== false ? b.totalQuantity ?? 0 : 0);

type ProjectLike = { isTemplate?: boolean; status?: string } | null | undefined;
const projectActive = (p: ProjectLike) =>
  p && p.isTemplate !== true && ACTIVE_PROJECT_STATUSES.has(p.status ?? "") ? 1 : 0;

type CrewLike = { status?: string } | null | undefined;
const crewActive = (m: CrewLike) => (m && m.status === "ACTIVE" ? 1 : 0);

type AssignLike = { status?: string | null } | null | undefined;
const offerPending = (a: AssignLike) => (a && a.status != null && PENDING_OFFER_STATUSES.has(a.status) ? 1 : 0);

// ── Typed bump helpers: pass the row BEFORE and AFTER the write (null = absent) ──
// Used by the hand-maintained CUSTOM + native (`*Writes.ts`) + warehouseOps sites,
// which already have the org id in scope.

export async function bumpAssetCounters(ctx: MutationCtx, orgId: string, before: AssetLike, after: AssetLike) {
  await applyDelta(ctx, orgId, {
    activeAssets: assetActive(after) - assetActive(before),
    checkedOutAssets: assetCheckedOut(after) - assetCheckedOut(before),
  });
}

export async function bumpBulkCounters(ctx: MutationCtx, orgId: string, before: BulkLike, after: BulkLike) {
  await applyDelta(ctx, orgId, { bulkQuantity: bulkQty(after) - bulkQty(before) });
}

export async function bumpProjectCounters(ctx: MutationCtx, orgId: string, before: ProjectLike, after: ProjectLike) {
  await applyDelta(ctx, orgId, { activeProjects: projectActive(after) - projectActive(before) });
}

export async function bumpCrewMemberCounters(ctx: MutationCtx, orgId: string, before: CrewLike, after: CrewLike) {
  await applyDelta(ctx, orgId, { activeCrew: crewActive(after) - crewActive(before) });
}

export async function bumpCrewAssignmentCounters(
  ctx: MutationCtx,
  orgId: string,
  before: AssignLike,
  after: AssignLike,
) {
  await applyDelta(ctx, orgId, { pendingCrewOffers: offerPending(after) - offerPending(before) });
}

// ── Generic dispatch for the GENERATED thin-CRUD mutations ──
// scripts/generate-convex-crud.cjs emits one uniform call per counted-table write
// (create / createIfMissing / update / remove). `before`/`after` are the row state
// around the write (null = row absent: insert has before:null, delete after:null);
// the org id is derived from whichever side is present (organizationId is immutable).

export type CountedTable = "assets" | "bulkAssets" | "projects" | "crewMembers" | "crewAssignments";

export async function bumpCountersForTable(
  ctx: MutationCtx,
  table: CountedTable,
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Promise<void> {
  const orgId = (after?.organizationId ?? before?.organizationId) as string | undefined;
  if (!orgId) return;
  switch (table) {
    case "assets":
      return bumpAssetCounters(ctx, orgId, before as AssetLike, after as AssetLike);
    case "bulkAssets":
      return bumpBulkCounters(ctx, orgId, before as BulkLike, after as BulkLike);
    case "projects":
      return bumpProjectCounters(ctx, orgId, before as ProjectLike, after as ProjectLike);
    case "crewMembers":
      return bumpCrewMemberCounters(ctx, orgId, before as CrewLike, after as CrewLike);
    case "crewAssignments":
      return bumpCrewAssignmentCounters(ctx, orgId, before as AssignLike, after as AssignLike);
  }
}
