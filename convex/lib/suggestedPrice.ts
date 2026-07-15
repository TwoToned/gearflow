import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

/**
 * Shared native port of the project-group suggested-price calculation.
 *
 * Byte-parity with src/lib/project-groups-pricing.ts `calculateSuggestedPrice`
 * (the relocated server helper) AND the inline recompute in
 * groupTemplatesWrites.applyNative (L546-566): equipment-only bundle price using
 * the simple `rate × quantity × rentalQuantity` model. Custom items are excluded
 * (the suggested price covers the equipment bundle only). Kit-child lines are
 * excluded (their parent line carries the price).
 *
 * `by_projectId` is a GLOBAL index — every line fetched here is org-filtered.
 * Models are resolved by_cuid (also global) with a per-row org re-check.
 */

const round = (n: number): number => Math.round(n * 100) / 100;

export async function computeGroupSuggestedPrice(
  ctx: MutationCtx,
  args: {
    projectId: string;
    groupId: string;
    orgId: string;
    defaultRentalPeriod?: string;
    defaultRentalQuantity?: number;
    groupRentalPeriod?: string;
    groupRentalQuantity?: number;
  },
): Promise<number> {
  const rentalPeriod = args.groupRentalPeriod ?? args.defaultRentalPeriod ?? "DAILY";
  const rentalQuantity = args.groupRentalQuantity ?? args.defaultRentalQuantity ?? 1;

  const lines = (
    await ctx.db
      .query("projectLineItems")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect()
  ).filter(
    (li) => li.organizationId === args.orgId && li.groupId === args.groupId && !li.isKitChild,
  );

  // Resolve each model once (org-checked); cache across lines in this group.
  const modelCache = new Map<string, Doc<"models"> | null>();
  const getModel = async (modelId: string): Promise<Doc<"models"> | null> => {
    const cached = modelCache.get(modelId);
    if (cached !== undefined) return cached;
    const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
    const resolved = m && m.organizationId === args.orgId ? m : null;
    modelCache.set(modelId, resolved);
    return resolved;
  };

  let total = 0;
  for (const li of lines) {
    if (li.isCustomItem) continue;
    const model = li.modelId ? await getModel(li.modelId) : null;
    const rate =
      rentalPeriod === "WEEKLY"
        ? Number(model?.weeklyRate ?? model?.dailyRate ?? li.unitPrice ?? 0)
        : Number(model?.dailyRate ?? li.unitPrice ?? 0);
    total += rate * (li.quantity ?? 0) * rentalQuantity;
  }

  return round(total);
}
