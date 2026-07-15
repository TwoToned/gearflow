import { mapLineItemDoc } from "@/lib/project-line-item-read";
import { roundCurrency } from "@/lib/formatters";
import { getModelMap } from "@/lib/models-read";
import { getProjectByIdMapped } from "@/lib/projects-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * Calculate the suggested price for a group based on its line items' rates.
 *
 * Uses the simple `rate × quantity × rentalQuantity` model from the group's
 * (or project's) default rental period/quantity.
 *
 * Relocated verbatim out of src/server/project-groups.ts (a "use server" module)
 * so the remaining server-action consumers (line-items.ts, sub-hires.ts) and the
 * int tests can import this pure helper directly without pulling in the deleted
 * project-groups server actions. Zero behaviour change. The Convex-native writes
 * carry their own byte-parity port in convex/lib/suggestedPrice.ts.
 */
export async function calculateSuggestedPrice(groupId: string): Promise<number> {
  const client = await getConvexClient();
  const group = await client.query(api.projectGroups.getById, { id: groupId });
  if (!group) return 0;

  // project is Convex-only — read the scalars (org-scoped via the group's org).
  const project = await getProjectByIdMapped(group.projectId, group.organizationId);

  const allLineItems = await client.query(api.projectLineItems.listByProject, {
    projectId: group.projectId,
    orgId: group.organizationId,
  });
  const lineItems = allLineItems
    .map(mapLineItemDoc)
    .filter((li) => li.groupId === groupId && !li.isKitChild);

  let total = 0;
  const modelMap = await getModelMap(group.organizationId);

  // Custom items intentionally excluded: the suggested price covers the
  // *equipment bundle* only.
  const rentalPeriod = group.rentalPeriod ?? project?.defaultRentalPeriod ?? "DAILY";
  const rentalQuantity = group.rentalQuantity ?? project?.defaultRentalQuantity ?? 1;
  for (const item of lineItems) {
    if (item.isCustomItem) continue;
    const model = item.modelId ? modelMap.get(item.modelId) ?? null : null;

    const rate =
      rentalPeriod === "WEEKLY"
        ? Number(model?.weeklyRate ?? model?.dailyRate ?? item.unitPrice ?? 0)
        : Number(model?.dailyRate ?? item.unitPrice ?? 0);
    total += rate * item.quantity * rentalQuantity;
  }

  return roundCurrency(total);
}
