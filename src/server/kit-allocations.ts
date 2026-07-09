"use server";

import { createId } from "@paralleldrive/cuid2";
import { requirePermission, getOrgContext } from "@/lib/org-context";
import { serialize } from "@/lib/serialize";
import { logActivity } from "@/lib/activity-log";
import { getConvexClient } from "@/lib/convex-client";
import { kitAllocationSchema } from "@/lib/validations/kit-allocation";
import { api } from "../../convex/_generated/api";

/**
 * Kit revenue allocation — the one-time setup that lets a kit's price be split
 * across the models inside it. See docs/revenue-allocation-design.md.
 *
 * Saving an allocation does NOT restate past projects. Allocation is only ever
 * recomputed when a project itself is mutated, which is exactly what makes historic
 * bookings stable. The UI says so out loud rather than leaving it to be discovered.
 */

export async function getKitAllocation(kitId: string) {
  const { organizationId } = await getOrgContext();
  const client = await getConvexClient();
  const view = await client.query(api.kitAllocations.getKitAllocation, {
    kitId,
    orgId: organizationId,
  });
  return serialize(view);
}

export async function saveKitAllocation(
  kitId: string,
  rows: { modelId: string; allocationPercent: number }[],
) {
  const { organizationId, userId, userName } = await requirePermission("kit", "update");
  const parsed = kitAllocationSchema.parse({ kitId, rows });

  const client = await getConvexClient();
  const result = await client.mutation(api.kitAllocations.replaceKitAllocation, {
    kitId: parsed.kitId,
    orgId: organizationId,
    rows: parsed.rows.map((r) => ({
      id: createId(),
      modelId: r.modelId,
      allocationPercent: r.allocationPercent,
    })),
    now: Date.now(),
  });

  const kit = await client.query(api.kits.getById, { id: kitId });
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "kit",
    entityId: kitId,
    entityName: kit?.name ?? kitId,
    summary: `Set revenue allocation across ${result.count} model(s)`,
  });

  return serialize(result);
}

/** Drop the allocation; future bookings fall back to cost/rate weighting. */
export async function clearKitAllocation(kitId: string) {
  const { organizationId, userId, userName } = await requirePermission("kit", "update");
  const client = await getConvexClient();

  const result = await client.mutation(api.kitAllocations.clearKitAllocation, {
    kitId,
    orgId: organizationId,
  });

  const kit = await client.query(api.kits.getById, { id: kitId });
  await logActivity({
    organizationId,
    userId,
    userName,
    action: "updated",
    entityType: "kit",
    entityId: kitId,
    entityName: kit?.name ?? kitId,
    summary: "Cleared revenue allocation",
  });

  return serialize(result);
}
