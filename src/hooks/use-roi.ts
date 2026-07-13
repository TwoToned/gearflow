"use client";

import { useMemo } from "react";
import { useActiveOrganization } from "@/lib/auth-client";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import { computeRoi, statusesForScope, type RoiScope } from "@/lib/roi";

/**
 * Browser-direct ROI reads (Phase 3 — replaces the `getFleetRoi`/`getModelRoi`
 * server actions in `src/server/roi.ts`, now deleted).
 *
 * `api.roi.fleetRevenue` / `fleetInventory` / `getModelRoi` are already
 * browser-callable (`requireOrgRead`). The Map-join + `computeRoi` + sort/totals that
 * the server action did in Node moves here verbatim — it's a pure client composition
 * over the two live subscriptions. The report reads what the allocation pass wrote;
 * it never recomputes revenue.
 */

export type FleetRoiRow = {
  modelId: string;
  modelName: string;
  manufacturer: string | null;
  categoryId: string | null;
  projectCount: number;
} & ReturnType<typeof computeRoi>;

export interface FleetRoiData {
  rows: FleetRoiRow[];
  scope: RoiScope;
  projectsCounted: number;
  truncated: boolean;
  totalRevenue: number;
  totalFleetCost: number;
}

export function useFleetRoi(opts: {
  scope: RoiScope;
  from?: number;
  to?: number;
}): { data: FleetRoiData | undefined; isLoading: boolean } {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const statuses = statusesForScope(opts.scope);

  const revenue = useAuthedQuery(
    api.roi.fleetRevenue,
    orgId ? { orgId, statuses, from: opts.from, to: opts.to } : "skip",
  );
  const inventory = useAuthedQuery(
    api.roi.fleetInventory,
    orgId ? { orgId } : "skip",
  );

  const data = useMemo<FleetRoiData | undefined>(() => {
    if (!revenue || !inventory) return undefined;

    const revenueByModel = new Map(revenue.rows.map((r) => [r.modelId, r]));

    const rows: FleetRoiRow[] = inventory.rows.map((m) => {
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
    // sold / deactivated): its revenue is real and must stay in the totals.
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

    return {
      rows,
      scope: opts.scope,
      projectsCounted: revenue.projectsCounted,
      truncated: revenue.truncated || inventory.truncated,
      totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
      totalFleetCost: rows.reduce((s, r) => s + (r.fleetCost ?? 0), 0),
    };
  }, [revenue, inventory, opts.scope]);

  return { data, isLoading: data === undefined };
}

type ModelRoiQuery = (typeof api.roi.getModelRoi)["_returnType"];

export type ModelRoiData = ModelRoiQuery & {
  scope: RoiScope;
} & ReturnType<typeof computeRoi>;

export function useModelRoi(
  modelId: string,
  opts: { scope: RoiScope; from?: number; to?: number },
): { data: ModelRoiData | undefined; isLoading: boolean } {
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const statuses = statusesForScope(opts.scope);

  const raw = useAuthedQuery(
    api.roi.getModelRoi,
    orgId ? { orgId, modelId, statuses, from: opts.from, to: opts.to } : "skip",
  );

  const data = useMemo<ModelRoiData | undefined>(() => {
    if (!raw) return undefined;
    return {
      ...raw,
      scope: opts.scope,
      ...computeRoi(raw.revenue, raw.unitsOwned, raw.replacementCost),
    };
  }, [raw, opts.scope]);

  return { data, isLoading: data === undefined };
}
