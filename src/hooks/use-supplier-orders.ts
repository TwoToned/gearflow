"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * Reactive supplier-order hooks (issue #789 — order-number combobox on the asset
 * form + the order detail page). Thin wrappers over Convex's useQuery, mirroring
 * src/hooks/use-suppliers.ts. Pass `undefined` args to skip (e.g. before org
 * context / a selected supplier loads).
 */

/** A supplier's orders (newest first), for the asset-form combobox + supplier tab. */
export function useSupplierOrdersBySupplier(orgId: string | undefined, supplierId: string | undefined) {
  return useAuthedQuery(
    api.supplierOrders.listBySupplier,
    orgId && supplierId ? { orgId, supplierId } : "skip",
  );
}

/** The order-detail composite (header + supplier + items + linked assets + invoice). */
export function useSupplierOrderDetail(orgId: string | undefined, id: string | undefined) {
  return useAuthedQuery(
    api.supplierOrders.getDetail,
    orgId && id ? { orgId, id } : "skip",
  );
}
