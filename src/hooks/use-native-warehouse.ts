"use client";

import { useMemo } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import {
  reconstructWarehouseProject,
  type NativeWarehouseProject,
} from "@/lib/warehouse-detail-reconstruct";

/**
 * Native warehouse LANDING list (Phase 4 — the last surface off the version-vector
 * + getProjects server-action path). ONE `warehouseList.bundle` subscription
 * returns the warehouse-pipeline projects with thin line items + client, reactive
 * over the WebSocket. Not flag-gated — it directly replaces the retired server path
 * (a bounded, proven list-composite pattern; see convex/dashboardLists.ts). Returns
 * `{ projects, isLoading }`; skips until orgId resolves.
 */
export function useNativeWarehouseList(orgId: string | undefined): {
  projects:
    | Array<{
        id: string;
        name: string;
        projectNumber: string;
        status: string;
        rentalStartDate: number | null;
        rentalEndDate: number | null;
        client: { name: string } | null;
        lineItems: Array<{ status: string; type: string; isKitChild: boolean }>;
      }>
    | undefined;
  isLoading: boolean;
} {
  const bundle = useAuthedQuery(api.warehouseList.bundle, orgId ? { orgId } : "skip");
  return { projects: bundle?.projects, isLoading: !!orgId && bundle === undefined };
}

/**
 * Native warehouse detail: ONE `warehouseDetail.bundle` subscription reconstructs
 * the full getProjectForWarehouse shape (`{ ...project, lineItems, client,
 * location }`) client-side — reactive over the WebSocket (the warehouseOps
 * mutations write line items + units in Convex, so edits push to the
 * subscription). Skips entirely unless the flag is on and ids are present.
 *
 * `notFound` distinguishes "project missing / not permitted / template" (bundle
 * === null) from "still loading" so the page surfaces not-found only when definitive.
 */
export function useNativeWarehouseProject(
  projectId: string | undefined,
  orgId: string | undefined,
): { data: NativeWarehouseProject | undefined; isLoading: boolean; notFound: boolean } {
  const enabled = !!projectId && !!orgId;
  const bundle = useAuthedQuery(
    api.warehouseDetail.bundle,
    enabled ? { projectId: projectId!, orgId: orgId! } : "skip",
  );

  const data = useMemo(() => {
    if (!enabled || bundle === undefined) return undefined;
    if (bundle === null) return undefined; // not found / not permitted / template
    return reconstructWarehouseProject(bundle);
  }, [enabled, bundle]);

  return {
    data,
    isLoading: enabled && bundle === undefined,
    notFound: enabled && bundle === null,
  };
}
