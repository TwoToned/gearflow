import type { MutationCtx } from "../_generated/server";

const round = (v: number): number => Math.round(v * 100) / 100;

/**
 * Recompute a ProjectService's `costTotal` from its own crewAssignments' resolved
 * `estimatedCost` — the single source of truth for a service's labour cost (issue
 * #796). Called after ANY write that can change a service-linked assignment's cost
 * (rate override, hours, add/remove crew) from EITHER side: the service's crew
 * reconcile (projectServicesWrites.ts) or a direct assignment edit (crewAssignmentsWrites.ts,
 * e.g. the crew-panel dialog). Both must call this so the two surfaces never disagree.
 *
 * A service with NO crew keeps whatever `costTotal` was last set manually (e.g. a
 * vehicle/transport-only service) — this only takes over once real labour is attached.
 * recalcProjectTotals's labourCostTotal deliberately EXCLUDES service-linked
 * assignments (convex/lib/recalc.ts) so this doesn't get double-counted there.
 */
export async function recalcServiceCostFromCrew(
  ctx: MutationCtx,
  serviceId: string,
  orgId: string,
  now: number,
): Promise<void> {
  const service = await ctx.db.query("projectServices").withIndex("by_cuid", (q) => q.eq("id", serviceId)).first();
  if (!service || service.organizationId !== orgId) return;

  const assignments = await ctx.db
    .query("crewAssignments")
    .withIndex("by_serviceId", (q) => q.eq("serviceId", serviceId))
    .collect();
  if (assignments.length === 0) return;

  const total = round(assignments.reduce((sum, a) => sum + (a.estimatedCost ?? 0), 0));
  if (service.costTotal !== total) {
    await ctx.db.patch(service._id, { costTotal: total, updatedAt: now });
  }
}
