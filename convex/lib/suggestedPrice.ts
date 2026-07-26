import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { inclusiveCalendarDays, computeBlendedCharge } from "./billing-derivation";

/**
 * Shared native port of the project-group suggested-price calculation (#943 —
 * derived billing weeks/days + best-price capping).
 *
 * SINGLE canonical Convex-side implementation of "suggested group price" —
 * collapses what were THREE independently-maintained copies of this formula
 * (src/lib/project-groups-pricing.ts `calculateSuggestedPrice` used the OLD
 * `rate × quantity × rentalQuantity` model; convex/groupTemplatesWrites.ts
 * `applyNative` hand-duplicated its own inline loop instead of calling this
 * function). All three now derive the chargeable window from the PROJECT's
 * rentalStartDate/rentalEndDate (not a per-group rentalPeriod/rentalQuantity
 * override — those fields are retired) and price each line via the shared
 * best-price-capped `computeBlendedCharge`. `src/lib/project-groups-pricing.ts`
 * is the src-side twin (uses `src/lib/billing-derivation.ts` directly since it
 * runs outside a Convex mutation, not this file).
 *
 * Equipment-only bundle price: custom items are excluded (the suggested price
 * covers the equipment bundle only). Kit-child lines are excluded (their
 * parent line carries the price).
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
    rentalStartDate?: number | null;
    rentalEndDate?: number | null;
  },
): Promise<number> {
  const chargeableDays = inclusiveCalendarDays(args.rentalStartDate, args.rentalEndDate);

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
    // A custom-priced (no model) line has no weekly/daily rate to derive from —
    // fall back to its own manual unitPrice as a flat daily-equivalent rate,
    // same fallback the old formula used.
    const dailyRate = model?.dailyRate ?? (li.modelId ? null : (li.unitPrice ?? null));
    const weeklyRate = model?.weeklyRate ?? null;
    const { perUnitCharge } = computeBlendedCharge({ chargeableDays, dailyRate, weeklyRate });
    total += perUnitCharge * (li.quantity ?? 0);
  }

  return round(total);
}
