import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import { kitModelQuantities } from "./kitAllocations";
import { getKitByCuid } from "./lib/kits";

/**
 * Native KIT-REVENUE-ALLOCATION write mutations (Phase 3 browser-direct — replaces the
 * saveKitAllocation/clearKitAllocation server actions in src/server/kit-allocations.ts).
 * Gates on `kit:update`. Standard shape: 4 guards (assertWritesEnabled +
 * enforceBrowserWriteLimit + requireOrgPermission + resolveActor) + per-row org re-check
 * on the kit + atomic audit. The money invariants (every model in the kit, split sums
 * to 100, in range, no dup, 2-decimal precision) are enforced at the mutation boundary
 * — no matter who calls, a split the allocation engine would later reject can't be
 * persisted. A direct-mutation caller bypassing the panel's `kitAllocationSchema`
 * (R-8.6.2) would otherwise be able to save e.g. `33.333%` rows that individually pass
 * the 0-100 range + sum-to-100 checks but silently round differently than the column
 * (numeric(5,2)) stores them, drifting the persisted split from what summed to 100.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/**
 * Reject a percent with more than 2 decimal places — mirrors `kitAllocationRowSchema`'s
 * refine in src/lib/validations/kit-allocation.ts (epsilon-compared, not
 * `Number.isInteger(Math.round(...))`, which is unconditionally true and never fires).
 */
function assertTwoDecimalPercent(value: number, field: string): void {
  if (Math.abs(value * 100 - Math.round(value * 100)) >= 1e-9) {
    throw new ConvexError({ code: "INVALID_FIELD", message: `${field} may have at most 2 decimal places.` });
  }
}

export const replaceNative = mutation({
  returns: v.object({ ok: v.boolean(), count: v.number() }),
  args: {
    kitId: v.string(),
    orgId: v.string(),
    rows: v.array(v.object({ id: v.string(), modelId: v.string(), allocationPercent: v.number() })),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { kitId, orgId, rows, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "kitAllocation");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const kit = await getKitByCuid(ctx, kitId);
    if (!kit || kit.organizationId !== orgId) throw new ConvexError(`kit not found: ${kitId}`);

    if (rows.length > 0) {
      const quantities = await kitModelQuantities(ctx, kitId);
      for (const r of rows) {
        if (!quantities.has(r.modelId)) {
          throw new ConvexError(`model ${r.modelId} is not in kit ${kitId}`);
        }
        if (!Number.isFinite(r.allocationPercent) || r.allocationPercent < 0 || r.allocationPercent > 100) {
          // Number.isFinite rejects NaN/±Infinity, which would slip past the range +
          // sum checks (every comparison against NaN is false) and persist junk.
          throw new ConvexError(`allocationPercent out of range for model ${r.modelId}`);
        }
        assertTwoDecimalPercent(r.allocationPercent, `allocationPercent for model ${r.modelId}`);
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
    // Only sweep THIS org's rows (defense-in-depth, matches clearNative): a kitId maps
    // to one org in prod, but never delete another org's rows on a shared kitId.
    for (const row of existing) {
      if (row.organizationId !== orgId) continue;
      await ctx.db.delete(row._id);
    }

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

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "updated",
      entityType: "kit",
      entityId: kitId,
      entityName: kit.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Set revenue allocation across ${rows.length} model(s)`,
      createdAt: now,
    });

    return { ok: true, count: rows.length };
  },
});

export const clearNative = mutation({
  returns: v.object({ ok: v.boolean(), count: v.number() }),
  args: {
    kitId: v.string(),
    orgId: v.string(),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, { kitId, orgId, now, actor: suppliedActor, auditId }) => {
    await assertWritesEnabled(ctx, "kitAllocation");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, orgId, "kit", "update");
    const actor = await resolveActor(ctx, suppliedActor);

    const kit = await getKitByCuid(ctx, kitId);
    if (!kit || kit.organizationId !== orgId) throw new ConvexError(`kit not found: ${kitId}`);

    const rows = await ctx.db
      .query("kitRevenueAllocations")
      .withIndex("by_kitId", (q) => q.eq("kitId", kitId))
      .collect();
    let count = 0;
    for (const row of rows) {
      if (row.organizationId !== orgId) continue; // never touch another org's rows on a shared kitId
      await ctx.db.delete(row._id);
      count += 1;
    }

    await writeActivityLog(ctx, {
      id: auditId,
      organizationId: orgId,
      action: "updated",
      entityType: "kit",
      entityId: kitId,
      entityName: kit.name,
      userId: actor.userId,
      userName: actor.userName,
      summary: "Cleared revenue allocation",
      createdAt: now,
    });

    return { ok: true, count };
  },
});
