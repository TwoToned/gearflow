"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvex } from "convex/react";
import { useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";
import { computeRoi, statusesForScope, type RoiScope } from "@/lib/roi";

/**
 * Browser-direct ROI reads (Phase 3 — replaces the `getFleetRoi`/`getModelRoi`
 * server actions in `src/server/roi.ts`, now deleted).
 *
 * `api.roi.fleetRevenue` / `fleetInventory` / `getModelRoi` are browser-callable
 * (`requireOrgRead`). The Map-join + `computeRoi` + sort/totals that the server action
 * did in Node moves here verbatim.
 *
 * These fetch ONE-SHOT (`useConvex().query` on mount + when the scope/window changes),
 * NOT a reactive `useAuthedQuery` subscription: a ROI *report* has no liveness
 * requirement, and `fleetInventory` reads up to ~13k org-wide docs — holding that as a
 * live subscription would re-scan on every asset/model write for zero benefit
 * (Appendix B #4). Matches the old server-action's non-reactive behaviour.
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
  const convex = useConvex();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { scope, from, to } = opts;
  const key = `${orgId ?? ""}|${scope}|${from ?? ""}|${to ?? ""}`;

  const [raw, setRaw] = useState<
    | { key: string; revenue: (typeof api.roi.fleetRevenue)["_returnType"]; inventory: (typeof api.roi.fleetInventory)["_returnType"] }
    | undefined
  >(undefined);

  useEffect(() => {
    if (!orgId) {
      setRaw(undefined);
      return;
    }
    let cancelled = false;
    const statuses = statusesForScope(scope);
    Promise.all([
      convex.query(api.roi.fleetRevenue, { orgId, statuses, from, to }),
      convex.query(api.roi.fleetInventory, { orgId }),
    ])
      .then(([revenue, inventory]) => {
        if (!cancelled) setRaw({ key, revenue, inventory });
      })
      .catch(() => {
        /* report read is best-effort; leave loading state */
      });
    return () => {
      cancelled = true;
    };
  }, [convex, orgId, scope, from, to, key]);

  const data = useMemo<FleetRoiData | undefined>(() => {
    // Gate on the request key so a scope/window change shows loading immediately,
    // never the previous scope's data for a render before the refetch lands.
    if (!raw || raw.key !== key) return undefined;
    const { revenue, inventory } = raw;

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
      scope,
      projectsCounted: revenue.projectsCounted,
      truncated: revenue.truncated || inventory.truncated,
      totalRevenue: rows.reduce((s, r) => s + r.revenue, 0),
      totalFleetCost: rows.reduce((s, r) => s + (r.fleetCost ?? 0), 0),
    };
  }, [raw, key, scope]);

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
  const convex = useConvex();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const { scope, from, to } = opts;
  const key = `${orgId ?? ""}|${modelId}|${scope}|${from ?? ""}|${to ?? ""}`;

  const [raw, setRaw] = useState<{ key: string; value: ModelRoiQuery } | undefined>(undefined);

  useEffect(() => {
    if (!orgId) {
      setRaw(undefined);
      return;
    }
    let cancelled = false;
    const statuses = statusesForScope(scope);
    convex
      .query(api.roi.getModelRoi, { orgId, modelId, statuses, from, to })
      .then((value) => {
        if (!cancelled) setRaw({ key, value });
      })
      .catch(() => {
        /* report read is best-effort; leave loading state */
      });
    return () => {
      cancelled = true;
    };
  }, [convex, orgId, modelId, scope, from, to, key]);

  const data = useMemo<ModelRoiData | undefined>(() => {
    if (!raw || raw.key !== key) return undefined; // gate on request key (no stale-scope render)
    return {
      ...raw.value,
      scope,
      ...computeRoi(raw.value.revenue, raw.value.unitsOwned, raw.value.replacementCost),
    };
  }, [raw, key, scope]);

  return { data, isLoading: data === undefined };
}
