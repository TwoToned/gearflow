"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * Reactive supplier hooks (Phase 4 of the Convex migration).
 *
 * Thin wrappers over Convex's useQuery — the browser subscribes directly to the
 * `suppliers` table over a WebSocket, so any supplier create/update/delete (via
 * the dual-write server actions) pushes a live update to every subscriber. No
 * staleTime, no manual invalidation. Pass `undefined` to skip (e.g. before org
 * context loads).
 *
 * Lives in src/hooks (NOT convex/) so the Convex function bundler never tries to
 * bundle this React module. See FEATUREDOCS/54 and convex/README.md.
 */
export type SupplierDoc = Doc<"suppliers">;

export function useSuppliers(orgId: string | undefined): SupplierDoc[] | undefined {
  return useAuthedQuery(api.suppliers.list, orgId ? { orgId } : "skip");
}

export function useSupplier(id: string | undefined): SupplierDoc | null | undefined {
  return useAuthedQuery(api.suppliers.getById, id ? { id } : "skip");
}
