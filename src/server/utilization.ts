"use server";

/**
 * Asset utilization server actions (Wave 3).
 *
 * Thin wrappers around the pure helpers in `src/lib/utilization.ts`.
 * Permission: piggybacks on `asset` read — anyone who can see assets
 * can see utilization. We're not exposing financial-only data; revenue
 * is the same per-line-item lineTotal already visible on project pages.
 */

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { requirePermission } from "@/lib/org-context";
import {
  computeAssetUtilization,
  computeUtilizationSummary,
  type UtilizationSummaryRow,
} from "@/lib/utilization";
import { prisma } from "@/lib/prisma";

/** One asset's utilization — for the asset detail page tab. */
export async function getAssetUtilization(
  assetId: string,
  options?: { periodDays?: number },
) {
  const { organizationId } = await requirePermission("asset", "read");
  const period =
    options?.periodDays != null
      ? {
          start: new Date(Date.now() - options.periodDays * 86_400_000),
          end: new Date(),
        }
      : undefined;
  const result = await computeAssetUtilization(assetId, organizationId, period);
  if (!result) return null;
  return serialize(result);
}

/** Roll-up list for the /utilization page. Joins each row back with the
 *  asset's tag / model / category for display. */
/** Hard cap on assets scored per request. computeAssetUtilization fires
 *  ~4 queries each; without a cap a 500-asset catalog issues 2000
 *  sequential queries and times the request out. The dashboard surfaces
 *  the highest-signal slice — a deeper view can paginate later. */
const UTILIZATION_SUMMARY_CAP = 250;

export async function getUtilizationSummary(options?: {
  periodDays?: number;
  modelId?: string;
  categoryId?: string;
}): Promise<UtilizationSummaryRow[]> {
  const { organizationId } = await getOrgContext();

  const period =
    options?.periodDays != null
      ? {
          start: new Date(Date.now() - options.periodDays * 86_400_000),
          end: new Date(),
        }
      : undefined;

  const rows = await computeUtilizationSummary(organizationId, {
    period,
    modelId: options?.modelId,
    categoryId: options?.categoryId,
    limit: UTILIZATION_SUMMARY_CAP,
  });

  if (rows.length === 0) return [];

  // Fan out a single bulk lookup for the display columns rather than
  // hitting prisma per row.
  const assets = await prisma.asset.findMany({
    where: {
      id: { in: rows.map((r) => r.assetId) },
      organizationId,
    },
    select: {
      id: true,
      assetTag: true,
      customName: true,
      status: true,
      model: { select: { id: true, name: true, category: { select: { name: true } } } },
    },
  });
  const byId = new Map(assets.map((a) => [a.id, a]));

  const enriched: UtilizationSummaryRow[] = rows.map((r) => {
    const a = byId.get(r.assetId);
    return {
      ...r,
      assetTag: a?.assetTag ?? "—",
      customName: a?.customName ?? null,
      modelName: a?.model?.name ?? "—",
      modelId: a?.model?.id ?? "",
      categoryName: a?.model?.category?.name ?? null,
      status: a?.status ?? "—",
    };
  });

  return serialize(enriched);
}
