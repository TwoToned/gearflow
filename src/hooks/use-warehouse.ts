"use client";

import { useQuery } from "convex/react";
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
  return useQuery(api.warehouseDetail.listVersion, orgId ? { orgId } : "skip");
}
