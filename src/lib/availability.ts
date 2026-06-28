import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import {
  computeStockBreakdown,
  reconstructOverbookedStatus,
  type OverbookedInfo,
  type OverbookLineItem,
} from "@/lib/overbooking-core";

// Re-exported for back-compat: the pure stock-breakdown + overbooked types moved
// into the client-safe overbooking-core (so the native read layer can run the
// same math client-side); server callers keep importing them from here.
export { computeStockBreakdown };
export type { OverbookedInfo };

/**
 * Computes which line items on a project are overbooked.
 * Returns a Map of line item ID → overbooking details.
 *
 * IO-only wrapper: fetches the `overbooking.bundle` (ONE backend-local round trip
 * for line items + projects + models + assets + bulks across the referenced
 * models) and delegates the math to the client-safe
 * {@link reconstructOverbookedStatus} (parity-by-construction). The native read
 * layer subscribes to the same bundle and calls `reconstructOverbookedStatus`
 * directly in the browser.
 *
 * Kit children count toward model availability — if a kit contains 3 mics and 2
 * more are added individually, all 5 count against the model's stock. Assets in
 * IN_MAINTENANCE, LOST, or RETIRED status reduce effective stock.
 */
export async function computeOverbookedStatus(
  organizationId: string,
  lineItems: OverbookLineItem[],
  rentalStartDate: Date | null,
  rentalEndDate: Date | null,
  projectId: string,
): Promise<Map<string, OverbookedInfo>> {
  const relevantItems = lineItems.filter(
    (li) => li.modelId && li.status !== "CANCELLED" && li.subHireId == null,
  );
  if (relevantItems.length === 0) return new Map();

  const modelIds = [...new Set(relevantItems.map((li) => li.modelId!))];

  const convex = await getConvexClient();
  const ob = await convex.query(api.overbooking.bundle, { orgId: organizationId, modelIds });

  return reconstructOverbookedStatus(ob, lineItems, rentalStartDate, rentalEndDate, projectId);
}
