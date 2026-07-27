import type { MutationCtx } from "../_generated/server";
import { applyProjectAllocation } from "./allocation";
import { deriveBillingSummary } from "./billingDerivation";

/**
 * In-mutation project-totals recalculation (Phase 5, Option A — write-latency fix).
 *
 * A BYTE-FOR-BYTE port of src/server/line-items.ts `recalculateProjectTotals`, moved
 * inside the native write mutations so a line-item write is ONE backend-local Convex
 * round-trip instead of ~5 server→Convex-Cloud HTTP hops (the 6–12s write tail). All
 * inputs are Convex-native (groups/lines/services/assignments/sub-hires) EXCEPT the
 * org default tax rate — that lives in Postgres (`organization.defaultTaxRate`, no
 * Convex mirror writer), so the caller passes it (authoritative) as `orgDefaultTaxRate`.
 *
 * A convex-test (writeParity / recalcParity) proves this produces the same totals as
 * the server-side function for the same inputs — the money gate.
 */

const round = (v: number): number => Math.round(v * 100) / 100;
const num = (v: unknown): number => (v != null ? Number(v) : 0);

/** Org default tax rate from the orgSettings mirror (Postgres-authoritative). Shared by
 *  every native write mutation that needs it for recalcProjectTotals (project-services,
 *  crew-assignments, line-items) — one lookup, not a copy per write file. */
export async function orgDefaultTaxRate(ctx: MutationCtx, orgId: string): Promise<number | null> {
  const row = await ctx.db
    .query("orgSettings")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", orgId))
    .first();
  return row?.defaultTaxRate ?? null;
}

export async function recalcProjectTotals(
  ctx: MutationCtx,
  projectId: string,
  orgId: string,
  orgDefaultTaxRate: number | null,
  now: number,
): Promise<void> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  // Project gone (e.g. a delete that also removed it) — nothing to recalc.
  if (!project || project.organizationId !== orgId) return;

  const [groups, projectLines, allServices, assignments, allSubHires] = await Promise.all([
    ctx.db.query("projectGroups").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectLineItems").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("projectServices").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("crewAssignments").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    ctx.db.query("subHires").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
  ]);

  // 1. Equipment revenue from groups. A priced group's flat price is the WHOLE
  // total for everything inside it — custom items included — so they are NOT added
  // on top. Only when a group has no flat price do its custom items bill on their
  // own (a group used purely as an organiser), otherwise they'd vanish from the
  // invoice. Grouped GEAR never bills its own lineTotal either way.
  const groupRevenue = groups.reduce((sum, g) => {
    const bundlePrice = num(g.price);
    const customExtras =
      bundlePrice > 0
        ? 0
        : projectLines
            .filter(
              (li) =>
                li.groupId === g.id &&
                li.isCustomItem === true &&
                !li.isOptional &&
                !li.isKitChild &&
                li.status !== "CANCELLED",
            )
            .reduce((s, li) => s + num(li.lineTotal), 0);
    // Discount is a flat $ amount off the bundle total (#883) — same shape as
    // projectLineItems.discount, subtracted once (not per-unit), clamped at 0.
    const bundleTotal = Math.max(0, bundlePrice * (g.quantity ?? 0) - num(g.discount));
    return sum + bundleTotal + customExtras;
  }, 0);

  // 2. Standalone (ungrouped) line items — includes ungrouped custom items.
  const standaloneRevenue = projectLines
    .filter(
      (li) =>
        li.groupId == null && !li.isOptional && !li.isKitChild && li.status !== "CANCELLED",
    )
    .reduce((sum, li) => sum + num(li.lineTotal), 0);

  // 2b. Sub-hire line items placed INTO a project group. A sub-hire carries its
  // OWN client charge, independent of the host group's bundle price — but the
  // group revenue in (1) only counts isCustomItem extras (and a priced group
  // zeroes them entirely), so a grouped sub-hire's charge would silently vanish.
  // Count each grouped sub-hire line's charge individually, mirroring how the
  // SAME line bills when ungrouped in (2). Kit-style children (isKitChild) are
  // excluded to avoid double-counting against their group parent's charge — the
  // identical exclusion (2) applies to ungrouped sub-hire groups. Kept
  // byte-for-byte in sync with src/server/line-items.ts.
  const subHireGroupedRevenue = projectLines
    .filter(
      (li) =>
        li.groupId != null &&
        li.subHireId != null &&
        !li.isOptional &&
        !li.isKitChild &&
        li.status !== "CANCELLED",
    )
    .reduce((sum, li) => sum + num(li.lineTotal), 0);

  const equipmentRevenue = round(groupRevenue + standaloneRevenue + subHireGroupedRevenue);

  // 3. Service financials (this project's non-CANCELLED rows).
  const services = allServices.filter(
    (s) => s.organizationId === orgId && s.status !== "CANCELLED",
  );
  const serviceCostTotal = round(services.reduce((sum, s) => sum + num(s.costTotal), 0));
  const serviceRevenue = round(
    services.filter((s) => s.showOnDocuments === true).reduce((sum, s) => sum + num(s.lineTotal), 0),
  );

  // 4. Labour costs from crew assignments NOT already linked to a service — a
  // service-linked assignment's cost is rolled into its service's costTotal instead
  // (convex/lib/serviceCost.ts recalcServiceCostFromCrew, folded into serviceCostTotal
  // just above), so counting it again here would double it in `margin`. Only
  // standalone assignments (no serviceId — legacy or added outside any service) land
  // in labourCostTotal. See FEATUREDOCS/31 Rate Cascade / issue #796.
  const labourCostTotal = round(
    assignments.filter((a) => a.serviceId == null).reduce((sum, a) => sum + num(a.estimatedCost), 0),
  );

  // 5. Sub-hire costs (exclude CANCELLED/DRAFT).
  const subHires = allSubHires.filter((sh) => sh.status !== "CANCELLED" && sh.status !== "DRAFT");
  const subHireCostTotal = round(subHires.reduce((sum, sh) => sum + num(sh.totalCost), 0));

  // 6. Totals (equipment + billable services).
  const subtotal = round(equipmentRevenue + serviceRevenue);
  const discountPercent = num(project.discountPercent);
  const discountAmount = round(subtotal * (discountPercent / 100));
  const taxableAmount = round(subtotal - discountAmount);

  // Tax rate: project override → org default (Postgres, passed in) → 10%.
  let taxRate = 10;
  if (project.taxRate != null) taxRate = Number(project.taxRate);
  else if (orgDefaultTaxRate != null) taxRate = Number(orgDefaultTaxRate);

  const taxAmount = round(taxableAmount * (taxRate / 100));
  const total = round(taxableAmount + taxAmount);
  const margin = round(total - (serviceCostTotal + labourCostTotal + subHireCostTotal));

  await ctx.db.patch(project._id, {
    equipmentRevenue,
    serviceCostTotal,
    labourCostTotal,
    subHireCostTotal,
    subtotal,
    discountAmount,
    taxAmount,
    total,
    margin,
    updatedAt: now,
  });

  // 7. Push the revenue we just booked down onto the gear that earned it, so
  // per-model ROI is answerable. Deliberately hung off recalc rather than given
  // its own trigger list: every line-item / group / service / sub-hire write in
  // the app already funnels through here, so there is no write path that can
  // forget to allocate. Reuses the groups/lines already read above; line patches
  // are diffed, so an edit that moves no allocation costs no writes.
  // See convex/lib/allocation.ts + docs/revenue-allocation-design.md.
  // #943: allocation's weekly-vs-daily rate-scale choice now reads the project's
  // DERIVED billing weeks (rentalStartDate/rentalEndDate, or the manual override)
  // instead of the retired `defaultRentalPeriod` field — same "> 0 means weekly
  // scale" role the old `rentalPeriod === "WEEKLY"` check played.
  const billingSummary = deriveBillingSummary({
    rentalStartMs: project.rentalStartDate,
    rentalEndMs: project.rentalEndDate,
    weeksOverride: project.billingWeeksOverride,
    daysOverride: project.billingDaysOverride,
  });
  await applyProjectAllocation(ctx, {
    projectId,
    orgId,
    billingWeeks: billingSummary.weeks,
    // Allocate what was BILLED, not what was listed: the project discount above
    // never reached the group/line prices the allocation pass reads.
    discountPercent,
    groups,
    lines: projectLines,
    now,
  });
}
