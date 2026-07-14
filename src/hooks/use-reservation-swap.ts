"use client";

import { useMutation } from "convex/react";
import { createId } from "@paralleldrive/cuid2";
import { useSession, useActiveOrganization } from "@/lib/auth-client";
import { api } from "../../convex/_generated/api";

/**
 * Browser-direct reservation-conflict swap (Phase 3 — replaces the swapLineItemAsset
 * server action). Reassigns a conflicting line item onto a free same-model asset via the
 * guarded `api.projectLineItems.swapLineItemAsset` mutation, whose authoritative
 * double-booking guard + write stay atomic (OCC re-check + patch). RBAC:
 * project:manage_line_items.
 */
export function useReservationSwap() {
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const orgId = activeOrg?.id;
  const swapM = useMutation(api.projectLineItems.swapLineItemAsset);

  return async (
    lineItemId: string,
    newAssetId: string,
  ): Promise<{ lineItemId: string; assetId: string }> => {
    if (!orgId) throw new Error("No active organization");
    return await swapM({
      organizationId: orgId,
      lineItemId,
      newAssetId,
      now: Date.now(),
      actor: {
        userId: session?.user.id ?? "",
        userName: session?.user.name ?? "",
      },
      auditId: createId(),
    });
  };
}
