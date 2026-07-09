import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { requireOrgRead, requireService } from "./lib/auth";
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
async function kitModelQuantities(
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

/**
 * Replace a kit's allocation wholesale. Percentages are validated in the server
 * action (which owns RBAC + audit); this enforces the invariants that must hold no
 * matter who calls: every model is in the kit, and the split sums to 100.
 */
export const replaceKitAllocation = mutation({
  args: {
    kitId: v.string(),
    orgId: v.string(),
    rows: v.array(v.object({ id: v.string(), modelId: v.string(), allocationPercent: v.number() })),
    now: v.number(),
  },
  handler: async (ctx, { kitId, orgId, rows, now }) => {
    await requireService(ctx);

    const kit = await ctx.db.query("kits").withIndex("by_cuid", (q) => q.eq("id", kitId)).first();
    if (!kit || kit.organizationId !== orgId) throw new ConvexError(`kit not found: ${kitId}`);

    if (rows.length > 0) {
      const quantities = await kitModelQuantities(ctx, kitId);
      for (const r of rows) {
        if (!quantities.has(r.modelId)) {
          throw new ConvexError(`model ${r.modelId} is not in kit ${kitId}`);
        }
        if (r.allocationPercent < 0 || r.allocationPercent > 100) {
          throw new ConvexError(`allocationPercent out of range for model ${r.modelId}`);
        }
      }
      if (new Set(rows.map((r) => r.modelId)).size !== rows.length) {
        throw new ConvexError(`duplicate model in allocation for kit ${kitId}`);
      }
      const sum = rows.reduce((s, r) => s + r.allocationPercent, 0);
      if (Math.abs(sum - 100) > 0.01) {
        throw new ConvexError(`allocation must sum to 100%, got ${sum.toFixed(2)}%`);
      }
    }

    const existing = await ctx.db
      .query("kitRevenueAllocations")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    for (const r of rows) {
      await ctx.db.insert("kitRevenueAllocations", {
        id: r.id,
        organizationId: orgId,
        kitId,
        modelId: r.modelId,
        allocationPercent: r.allocationPercent,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { ok: true as const, count: rows.length };
  },
});

/** Drop a kit's allocation entirely; bookings revert to the weight chain. */
export const clearKitAllocation = mutation({
  args: { kitId: v.string(), orgId: v.string() },
  handler: async (ctx, { kitId, orgId }) => {
    await requireService(ctx);
    const rows = await ctx.db
      .query("kitRevenueAllocations")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    for (const row of rows) {
      if (row.organizationId !== orgId) continue;
      await ctx.db.delete(row._id);
    }
    return { ok: true as const, count: rows.length };
  },
});
