/**
 * Asset utilization computation (Wave 3).
 *
 * Goal: answer "is this specific asset paying for itself?" for the operator.
 *
 * Lives outside `"use server"` so integration tests can drive it with a
 * known orgId. The server-action wrapper in `src/server/utilization.ts`
 * resolves orgId via the session.
 *
 * Revenue model — pragmatic v1:
 *   Only count line items where assetId is set (specific asset assigned).
 *   Model-only line items pre-checkout don't attribute revenue yet — they
 *   will once an asset is assigned at checkout. This avoids fabricating
 *   allocations that the operator can't verify.
 *
 * Booking-days model:
 *   Sum (effective rentalEnd - effective rentalStart + 1) for every line
 *   item with assetId = X. Clamp to the requested period bounds when one
 *   is supplied. Exclude CANCELLED.
 *
 * Cost model:
 *   maintenanceCost = SUM(MaintenanceRecord.cost) via MaintenanceRecordAsset
 *     where assetId = X and the record's createdAt is in the period.
 *   damageCost = SUM(actualCost ?? estimatedCost) per DamageEvent where
 *     assetId = X, minus charged-back damage (client paid for it).
 *
 * Net contribution = revenue − maintenanceCost − ourDamageCost.
 *
 * Period:
 *   Defaults to "since asset was created". Pass periodStart / periodEnd
 *   to scope (e.g. last 90 days). periodDays is the span of the period
 *   used for the utilization-rate denominator.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export interface UtilizationPeriod {
  /** Inclusive start. Defaults to asset.createdAt. */
  start: Date;
  /** Inclusive end. Defaults to now. */
  end: Date;
}

export interface AssetUtilization {
  assetId: string;
  bookingDays: number;
  periodDays: number;
  utilizationRate: number; // 0..1
  revenue: number;
  maintenanceCost: number;
  damageCost: number;
  damageChargedBackTotal: number;
  netContribution: number;
  projectCount: number;
  lastBookingEnd: Date | null;
}

/** One row of the /utilization roll-up — an AssetUtilization joined with
 *  the asset's tag / model / category for display. */
export interface UtilizationSummaryRow extends AssetUtilization {
  assetTag: string;
  customName: string | null;
  modelName: string;
  modelId: string;
  categoryName: string | null;
  status: string;
}

/** Inclusive day span between two dates (whole days). */
function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000) + 1);
}

/** Clamp a booking window to the requested period. Returns null if no overlap. */
function clampWindow(
  bookingStart: Date,
  bookingEnd: Date,
  period: UtilizationPeriod,
): { start: Date; end: Date } | null {
  if (bookingEnd < period.start) return null;
  if (bookingStart > period.end) return null;
  return {
    start: bookingStart < period.start ? period.start : bookingStart,
    end: bookingEnd > period.end ? period.end : bookingEnd,
  };
}

export async function computeAssetUtilization(
  assetId: string,
  organizationId: string,
  periodOverride?: Partial<UtilizationPeriod>,
): Promise<AssetUtilization | null> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId, organizationId },
    select: { id: true, createdAt: true, purchaseDate: true },
  });
  if (!asset) return null;

  const now = new Date();
  const periodStart =
    periodOverride?.start ?? asset.purchaseDate ?? asset.createdAt;
  const periodEnd = periodOverride?.end ?? now;
  const period: UtilizationPeriod = { start: periodStart, end: periodEnd };
  const periodDays = daysBetween(period.start, period.end);

  // Bookings: this exact asset assigned, not cancelled, on non-template
  // projects. Assignments live on legacy line.assetId rows AND on
  // ProjectLineItemUnit rows (the fulfillment model) — both tables count.
  const projectFilter: Prisma.ProjectWhereInput = {
    isTemplate: false,
    status: { notIn: ["CANCELLED"] },
    rentalStartDate: { not: null },
    rentalEndDate: { not: null },
  };
  const [bookingLines, bookingUnits] = await Promise.all([
    prisma.projectLineItem.findMany({
      where: {
        assetId,
        organizationId,
        status: { not: "CANCELLED" },
        project: projectFilter,
      },
      select: {
        id: true,
        lineTotal: true,
        project: {
          select: { id: true, rentalStartDate: true, rentalEndDate: true },
        },
      },
    }),
    prisma.projectLineItemUnit.findMany({
      where: {
        assetId,
        organizationId,
        status: { not: "CANCELLED" },
        lineItem: { status: { not: "CANCELLED" }, project: projectFilter },
      },
      select: {
        lineItemId: true,
        lineItem: {
          select: {
            lineTotal: true,
            quantity: true,
            project: {
              select: { id: true, rentalStartDate: true, rentalEndDate: true },
            },
          },
        },
      },
    }),
  ]);

  // Unify both sources into one booking shape. A line either carries
  // line.assetId (legacy) or has units (fulfillment model) — disjoint in
  // practice, but dedup by lineItemId guards against a row in both. Unit
  // revenue is pro-rated by line quantity so an N-unit line isn't counted
  // N times; legacy single-asset lines keep their full-lineTotal behaviour.
  interface Booking {
    rentalStartDate: Date | null;
    rentalEndDate: Date | null;
    revenue: number;
    projectId: string;
  }
  const bookings: Booking[] = [];
  const seenLineIds = new Set<string>();
  for (const l of bookingLines) {
    seenLineIds.add(l.id);
    bookings.push({
      rentalStartDate: l.project.rentalStartDate,
      rentalEndDate: l.project.rentalEndDate,
      revenue: l.lineTotal != null ? Number(l.lineTotal) : 0,
      projectId: l.project.id,
    });
  }
  for (const u of bookingUnits) {
    if (seenLineIds.has(u.lineItemId)) continue;
    const qty = u.lineItem.quantity > 0 ? u.lineItem.quantity : 1;
    bookings.push({
      rentalStartDate: u.lineItem.project.rentalStartDate,
      rentalEndDate: u.lineItem.project.rentalEndDate,
      revenue:
        u.lineItem.lineTotal != null ? Number(u.lineItem.lineTotal) / qty : 0,
      projectId: u.lineItem.project.id,
    });
  }

  let bookingDays = 0;
  let revenue = 0;
  let lastBookingEnd: Date | null = null;
  const projectIds = new Set<string>();

  for (const b of bookings) {
    if (!b.rentalStartDate || !b.rentalEndDate) continue;
    const window = clampWindow(b.rentalStartDate, b.rentalEndDate, period);
    if (!window) continue;
    bookingDays += daysBetween(window.start, window.end);
    // Revenue attribution: count this asset's (pro-rated) line total in
    // full if any part of the booking overlaps the period. This avoids
    // pro-rating a bundle price across days, which the operator never
    // sees in their numbers anyway. For period reporting, a booking that
    // straddles the period boundary lands fully in whichever period
    // you're looking at — acceptable; the operator can shorten the window
    // if precision matters.
    revenue += b.revenue;
    projectIds.add(b.projectId);
    if (!lastBookingEnd || b.rentalEndDate > lastBookingEnd) {
      lastBookingEnd = b.rentalEndDate;
    }
  }

  // Maintenance cost: sum of MaintenanceRecord.cost via the join table.
  // Filter by createdAt in period.
  const maintenanceAgg = await prisma.maintenanceRecord.aggregate({
    where: {
      organizationId,
      status: { notIn: ["CANCELLED"] },
      createdAt: { gte: period.start, lte: period.end },
      assets: { some: { assetId } },
    },
    _sum: { cost: true },
  });
  const maintenanceCost = Number(maintenanceAgg._sum.cost ?? 0);

  // Damage cost: prefer actualCost, fall back to estimatedCost.
  const damageRows = await prisma.damageEvent.findMany({
    where: {
      assetId,
      organizationId,
      createdAt: { gte: period.start, lte: period.end },
    },
    select: { actualCost: true, estimatedCost: true, chargedBack: true },
  });
  let damageCost = 0;
  let damageChargedBackTotal = 0;
  for (const d of damageRows) {
    const cost = d.actualCost != null
      ? Number(d.actualCost)
      : d.estimatedCost != null
        ? Number(d.estimatedCost)
        : 0;
    damageCost += cost;
    if (d.chargedBack) damageChargedBackTotal += cost;
  }

  const ourDamageCost = damageCost - damageChargedBackTotal;
  const netContribution = revenue - maintenanceCost - ourDamageCost;

  const utilizationRate = periodDays > 0
    ? Math.max(0, Math.min(1, bookingDays / periodDays))
    : 0;

  return {
    assetId,
    bookingDays,
    periodDays,
    utilizationRate,
    revenue,
    maintenanceCost,
    damageCost,
    damageChargedBackTotal,
    netContribution,
    projectCount: projectIds.size,
    lastBookingEnd,
  };
}

/** Roll-up summary: utilization for every active asset in the org,
 *  optionally filtered by model / category. Used by the /utilization page. */
export async function computeUtilizationSummary(
  organizationId: string,
  options?: {
    period?: Partial<UtilizationPeriod>;
    modelId?: string;
    categoryId?: string;
    limit?: number;
  },
): Promise<AssetUtilization[]> {
  const assets = await prisma.asset.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(options?.modelId && { modelId: options.modelId }),
      ...(options?.categoryId && { model: { categoryId: options.categoryId } }),
    },
    select: { id: true },
    take: options?.limit,
  });

  const results: AssetUtilization[] = [];
  for (const a of assets) {
    const u = await computeAssetUtilization(a.id, organizationId, options?.period);
    if (u) results.push(u);
  }
  return results;
}
