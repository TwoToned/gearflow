"use server";

import { getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { getConvexClient } from "@/lib/convex-client";
import { computeRoi, statusesForScope, type RoiScope } from "@/lib/roi";
import { api } from "../../convex/_generated/api";

/**
 * ROI reporting. Reads what the allocation pass wrote; never recomputes.
 *
 * Fleet revenue and fleet inventory are two Convex queries (each with its own read
 * budget) joined here. The join is a Map lookup, so it costs nothing, and it lets a
 * model with zero revenue still appear — dead capital is the whole point of the
 * report, and it doesn't show up in a revenue-driven query.
 */

export async function getFleetRoi(opts: {
  scope?: RoiScope;
  from?: number;
  to?: number;
} = {}) {
  const { organizationId } = await getOrgContext();
  const client = await getConvexClient();
  const scope = opts.scope ?? "earned";

  const [revenue, inventory] = await Promise.all([
    client.query(api.roi.fleetRevenue, {
      orgId: organizationId,
      statuses: statusesForScope(scope),
      from: opts.from,
      to: opts.to,
    }),
    client.query(api.roi.fleetInventory, { orgId: organizationId }),
  ]);

  const revenueByModel = new Map(revenue.rows.map((r) => [r.modelId, r]));

  const rows = inventory.rows.map((m) => {
    const earned = revenueByModel.get(m.modelId);
    return {
      modelId: m.modelId,
      modelName: m.modelName,
      manufacturer: m.manufacturer,
      categoryId: m.categoryId,
      projectCount: earned?.projectCount ?? 0,
      ...computeRoi(earned?.revenue ?? 0, m.unitsOwned, m.replacementCost),
    };
  });

  // A model that earned inside the window but is no longer in the fleet (all units
  // sold, or deactivated). Its revenue is real and must not vanish from the totals
  // just because the capital is gone — it simply has no ROI to report.
  for (const [modelId, earned] of revenueByModel) {
    if (rows.some((r) => r.modelId === modelId)) continue;
    rows.push({
      modelId,
      modelName: "Retired model",
      manufacturer: null,
      categoryId: null,
      projectCount: earned.projectCount,
      ...computeRoi(earned.revenue, 0, null),
    });
  }

  rows.sort((a, b) => b.revenue - a.revenue);

  return serialize({
    rows,
    scope,
    projectsCounted: revenue.projectsCounted,
    // Surfaced in the UI rather than swallowed: a capped scan that reports a low
    // number looks exactly like a fleet that isn't earning.
    truncated: revenue.truncated || inventory.truncated,
    totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
    totalFleetCost: rows.reduce((s, r) => s + (r.fleetCost ?? 0), 0),
  });
}

export async function getModelRoi(
  modelId: string,
  opts: { scope?: RoiScope; from?: number; to?: number } = {},
) {
  const { organizationId } = await getOrgContext();
  const client = await getConvexClient();
  const scope = opts.scope ?? "earned";

  const data = await client.query(api.roi.getModelRoi, {
    orgId: organizationId,
    modelId,
    statuses: statusesForScope(scope),
    from: opts.from,
    to: opts.to,
  });

  return serialize({
    ...data,
    scope,
    ...computeRoi(data.revenue, data.unitsOwned, data.replacementCost),
  });
}
