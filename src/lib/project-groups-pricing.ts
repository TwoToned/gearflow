import { mapLineItemDoc } from "@/lib/project-line-item-read";
import { roundCurrency } from "@/lib/formatters";
import { getModelMap } from "@/lib/models-read";
import { getProjectByIdMapped } from "@/lib/projects-read";
import { getConvexClient } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { inclusiveCalendarDays, computeBlendedCharge } from "@/lib/billing-derivation";

/**
 * Calculate the suggested price for a group based on its line items' rates.
 *
 * #943: derived billing weeks/days + best-price capping — the chargeable
 * window comes from the PROJECT's rentalStartDate/rentalEndDate (the old
 * per-group/per-project rentalPeriod/rentalQuantity override fields are
 * retired), and each line's rate is best-price-capped via the shared
 * `computeBlendedCharge` (src/lib/billing-derivation.ts).
 *
 * Relocated verbatim out of src/server/project-groups.ts (a "use server" module)
 * so the remaining server-action consumers (line-items.ts, sub-hires.ts) and the
 * int tests can import this pure helper directly without pulling in the deleted
 * project-groups server actions. The Convex-native writes carry their own
 * byte-parity port in convex/lib/suggestedPrice.ts — this was one of THREE
 * hand-duplicated copies of the formula before #943; all three now derive from
 * the single billing-derivation module (this file's src-side twin lives at
 * convex/lib/billing-derivation.ts for code that runs inside a mutation).
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

  const chargeableDays = inclusiveCalendarDays(
    project?.rentalStartDate?.getTime(),
    project?.rentalEndDate?.getTime(),
  );

  let total = 0;
  const modelMap = await getModelMap(group.organizationId);

  // Custom items intentionally excluded: the suggested price covers the
  // *equipment bundle* only.
  for (const item of lineItems) {
    if (item.isCustomItem) continue;
    const model = item.modelId ? modelMap.get(item.modelId) ?? null : null;
    // A custom-priced (no model) line has no weekly/daily rate to derive from —
    // fall back to its own manual unitPrice as a flat daily-equivalent rate,
    // same fallback the old formula used.
    const dailyRate = model?.dailyRate ?? (item.modelId ? null : (item.unitPrice ?? null));
    const weeklyRate = model?.weeklyRate ?? null;
    const { perUnitCharge } = computeBlendedCharge({ chargeableDays, dailyRate, weeklyRate });
    total += perUnitCharge * item.quantity;
  }

  return roundCurrency(total);
}
