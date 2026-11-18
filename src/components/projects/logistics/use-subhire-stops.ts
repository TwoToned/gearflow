"use client";

/**
 * The job's derived sub-hire transport stops. Both reads are org-checked
 * server-side (`subHires.listByProject` filters the global by_projectId index to
 * the caller's org); gated on the caller's read rights so a role without them
 * skips instead of erroring the tab.
 */
import * as React from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { useSuppliers } from "@/hooks/use-suppliers";
import { subHireStops, type SubHireOrderLite, type TransportStop } from "@/lib/logistics-transport";
import { useCanDo } from "@/lib/use-permissions";
import { api } from "../../../../convex/_generated/api";

export function useSubHireStops(projectId: string, orgId: string | undefined): TransportStop[] {
  const canSubHire = useCanDo("subHire", "read");
  const canSupplier = useCanDo("supplier", "read");
  const enabled = !!orgId && canSubHire && canSupplier;
  const orders = useAuthedQuery(api.subHires.listByProject, enabled ? { projectId, orgId } : "skip") as
    | SubHireOrderLite[]
    | undefined;
  const suppliers = useSuppliers(enabled ? orgId : undefined);
  return React.useMemo(() => {
    const names = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
    return subHireStops(orders ?? [], (id) => names.get(id) ?? "");
  }, [orders, suppliers]);
}
