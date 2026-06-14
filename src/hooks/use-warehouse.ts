"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * Reactive "version vector" for the warehouse LANDING list
 * (`warehouse/page.tsx`). The cheap Convex value that `useReactiveServerQuery`
 * watches to re-run the unchanged `getProjects` server action whenever any
 * warehouse-pipeline project changes (status / dates / client) — cross-user over
 * the WebSocket. See convex/warehouseDetail.ts for the scope contract. Pass
 * `undefined` to skip (before org context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex bundler never tries to bundle
 * this React module. See FEATUREDOCS/54.
 */
export function useWarehouseListVersion(orgId: string | undefined) {
  return useAuthedQuery(api.warehouseDetail.listVersion, orgId ? { orgId } : "skip");
}

/**
 * Reactive "version vector" for the per-project WAREHOUSE DETAIL page
 * (`warehouse/[projectId]/page.tsx`). The cheap Convex value that
 * `useReactiveServerQuery` watches to re-run the unchanged
 * `getProjectForWarehouse` server action whenever the project or any of its line
 * items changes — cross-user over the WebSocket. See convex/warehouseDetail.ts
 * `version` for the scope contract. `projectId` is always defined (route param),
 * so this never needs the "skip" sentinel in practice, but guard anyway.
 */
export function useWarehouseProjectVersion(projectId: string | undefined) {
  return useAuthedQuery(api.warehouseDetail.version, projectId ? { projectId } : "skip");
}
