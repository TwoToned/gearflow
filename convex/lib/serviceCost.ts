import type { MutationCtx } from "../_generated/server";
import { resolveChargeRate, calculateEstimatedCost } from "./crewRate";

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

/**
 * Charge-side twin of `recalcServiceCostFromCrew` (WS10 #949 — labour charge rates
 * & margin). Recomputes a ProjectService's `crewChargeTotal` from its crew
 * assignments' resolved charge rate (`resolveChargeRate` — role-first, NO member
 * level, per-service `chargeRateOverride` -> `role.chargeRate` -> null), reusing
 * the SAME pure duration math (`calculateEstimatedCost`) the cost side uses. Same
 * trigger as the cost twin: >=1 crew assignment on the service, type-agnostic —
 * this is deliberate symmetry with `recalcServiceCostFromCrew` (serviceCost.ts:31),
 * not a labour-only special case.
 *
 * Manual-price protection (the `costTotal` clobber lesson, #796, applied to the
 * charge side): a typed `unitPrice` is an explicit manual override and is NEVER
 * touched here. Only when `unitPrice` is unset does this recompute `lineTotal` from
 * the resolved `crewChargeTotal` (minus discount, clamped >= 0) — so a manually-typed
 * client price always survives a crew edit, exactly like `costTotal`'s crew-less
 * carve-out survives a crew-less service.
 *
 * "No auto-pricing figure anywhere" (every assignment's `resolveChargeRate` returns
 * null — no override, no role charge rate configured) intentionally CLEARS
 * `crewChargeTotal` (and any auto-priced `lineTotal`) rather than writing a fake
 * $0 — margin stays hidden until a real charge rate exists (spec: no backfill).
 */
export async function recalcServiceChargeFromCrew(
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

  let anyResolved = false;
  let sum = 0;
  for (const a of assignments) {
    let role: { chargeRate?: number | null; rateType?: string | null } | null = null;
    if (a.crewRoleId) {
      const r = await ctx.db.query("crewRoles").withIndex("by_cuid", (q) => q.eq("id", a.crewRoleId!)).first();
      if (r && r.organizationId === orgId) role = { chargeRate: r.chargeRate ?? null, rateType: r.rateType ?? null };
    }
    const resolved = resolveChargeRate(service.chargeRateOverride, role);
    if (resolved) {
      anyResolved = true;
      sum += calculateEstimatedCost(resolved.rate, resolved.rateType, a.startDate ?? null, a.endDate ?? null, a.estimatedHours ?? null);
    }
  }
  const crewChargeTotal = anyResolved ? round(sum) : null;

  const patch: Record<string, unknown> = {};
  if (service.crewChargeTotal !== (crewChargeTotal ?? undefined)) {
    patch.crewChargeTotal = crewChargeTotal ?? undefined; // undefined clears the optional field
  }

  // Manual-price protection: unitPrice set = manual override, never touched here.
  if (service.unitPrice == null) {
    const autoLineTotal = crewChargeTotal != null ? Math.max(0, round(crewChargeTotal - (service.discount ?? 0))) : null;
    if (service.lineTotal !== (autoLineTotal ?? undefined)) {
      patch.lineTotal = autoLineTotal ?? undefined;
    }
  }

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = now;
    await ctx.db.patch(service._id, patch);
  }
}
