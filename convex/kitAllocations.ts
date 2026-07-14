import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead } from "./lib/auth";
import { suggestKitAllocation, allocationCoversKit } from "./lib/allocation";

/**
 * Per-MODEL revenue allocation for a kit (see docs/revenue-allocation-design.md).
 *
 * Kit contents are per-ASSET rows (kitSerializedItems) and per-bulk-asset rows
 * (kitBulkItems). Allocation is stored per model instead, because that is the grain
 * ROI reports on and because a per-asset percentage would break every time an asset
 * is swapped in or out of the kit.
 *
 * The percentages here are ADVISORY. `convex/lib/allocation.ts` applies them only if
 * they still exactly cover the kit's current models; otherwise it falls back to the
 * weight chain. A kit's contents can change from the warehouse or a CSV import
 * without ever touching this table, so nothing downstream may assume it is fresh.
 */

/** Collapse a kit's asset/bulk member rows into (modelId → units in the kit). */
export async function kitModelQuantities(
  ctx: QueryCtx,
  kitId: string,
): Promise<Map<string, number>> {
  const [serialized, bulk] = await Promise.all([
    ctx.db.query("kitSerializedItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect(),
    ctx.db.query("kitBulkItems").withIndex("by_kitId", (q) => q.eq("kitId", kitId)).collect(),
  ]);

  const qty = new Map<string, number>();
  const bump = (modelId: string, n: number) => qty.set(modelId, (qty.get(modelId) ?? 0) + n);

  for (const s of serialized) {
    const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", s.assetId)).first();
    if (asset?.modelId) bump(asset.modelId, 1);
  }
  for (const b of bulk) {
    const ba = await ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", b.bulkAssetId)).first();
    if (ba?.modelId) bump(ba.modelId, b.quantity ?? 1);
  }
  return qty;
}

/**
 * Everything the kit's allocation panel needs, in one round trip: the kit's model
 * composition, the saved percentages, the cost-weighted suggestion, and whether the
 * saved split still describes the kit.
 */
export const getKitAllocation = query({
  args: { kitId: v.string(), orgId: v.string() },
  handler: async (ctx, { kitId, orgId }) => {
    await requireOrgRead(ctx, orgId);

    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).first();
    if (!kit || kit.organizationId !== orgId) throw new ConvexError(`kit not found: ${kitId}`);

    const quantities = await kitModelQuantities(ctx, kitId);
    const saved = await ctx.db
      .query("kitRevenueAllocations")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    const savedByModel = new Map(saved.map((r) => [r.modelId, r.allocationPercent]));

    const models = new Map<string, { name: string; replacementCost: number | null }>();
    for (const modelId of quantities.keys()) {
      const m = await ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", modelId)).first();
      models.set(modelId, {
        name: m?.name ?? "Unknown model",
        replacementCost: m?.replacementCost ?? null,
      });
    }

    const suggested = suggestKitAllocation(
      [...quantities].map(([modelId, quantity]) => ({
        modelId,
        quantity,
        replacementCost: models.get(modelId)?.replacementCost ?? null,
      })),
    );

    const rows = [...quantities]
      .map(([modelId, quantity]) => ({
        modelId,
        modelName: models.get(modelId)!.name,
        replacementCost: models.get(modelId)!.replacementCost,
        quantity,
        allocationPercent: savedByModel.get(modelId) ?? null,
        suggestedPercent: suggested.get(modelId) ?? 0,
      }))
      .sort((a, b) => b.suggestedPercent - a.suggestedPercent || a.modelName.localeCompare(b.modelName));

    return {
      kitId,
      kitName: kit.name,
      rows,
      hasAllocation: saved.length > 0,
      // "Saved, but no longer describes this kit" — the panel warns, and bookings
      // silently fall back to the weight chain rather than misapplying it.
      isStale: saved.length > 0 && !allocationCoversKit(savedByModel, [...quantities.keys()]),
      // Models the allocation names that the kit no longer contains. Surfaced so the
      // UI can say WHY it went stale instead of just that it did.
      orphanedModelIds: saved.map((r) => r.modelId).filter((m) => !quantities.has(m)),
    };
  },
});

// Kit allocation WRITES (browser-direct) live in convex/kitAllocationsWrites.ts;
// they reuse kitModelQuantities (exported above) for the money invariants.
