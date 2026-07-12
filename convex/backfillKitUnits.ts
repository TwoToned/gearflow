import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import { ensureBulkUnit, ensureSerialisedUnit } from "./lib/fulfillment";

/**
 * Kit per-unit fulfillment — Phase 2 backfill.
 * See docs/designs/kit-per-unit-fulfillment.md.
 *
 * Kits added AFTER Phase 1 seed their member units at kit-add (createKitLineItemCore);
 * kits added before it have none. This pages the projectLineItems table and, for every
 * unit-less kit MEMBER child line — a serialised or bulk member, NOT a nested-kit parent
 * (no own units) and NOT an accessory (already unit-backed) — creates the unit carrying
 * the line's CURRENT lifecycle, so a deployed / returned / prepped member backfills at
 * the right stage rather than bare CONFIRMED (codex #8).
 *
 * SERVICE-only. Idempotent: a member that already has its unit (Phase-1 seed or a prior
 * run) is skipped, so re-runs are safe and never clobber live state. `apply=false` is a
 * dry-run that only counts. Paginated because one query can't scan a large table.
 *
 * NB: NO `ANALYZE` — projectLineItemUnits is a Convex table (ANALYZE is Postgres-only;
 * the CLAUDE.md ANALYZE rule is for Prisma bulk migrations).
 *
 * Driver: scripts/convex-backfill-kit-units.ts (pages the cursor until isDone).
 */
export const backfillKitUnitsPage = mutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    apply: v.boolean(),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, { cursor, apply, numItems }) => {
    await requireService(ctx);
    const res = await ctx.db.query("projectLineItems").paginate({ cursor, numItems: numItems ?? 300 });

    let scanned = 0;
    let created = 0;
    for (const line of res.page) {
      if (!line.isKitChild || line.childKind === "ACCESSORY" || line.kitId) continue;
      const isBulk = !!line.bulkAssetId;
      if (!line.assetId && !isBulk) continue;
      // Already seeded (Phase 1) or backfilled by a prior run? Skip — never clobber
      // live state. A kit member line carries exactly one unit, so any unit = done.
      const already = await ctx.db.query("projectLineItemUnits").withIndex("by_lineItemId", (q) => q.eq("lineItemId", line.id)).first();
      if (already) continue;
      scanned++; // a member that NEEDS a unit
      if (!apply) continue;

      const ensured = isBulk
        ? await ensureBulkUnit(ctx, { organizationId: line.organizationId, lineItemId: line.id, bulkAssetId: line.bulkAssetId!, quantity: line.quantity ?? 1 })
        : await ensureSerialisedUnit(ctx, { organizationId: line.organizationId, lineItemId: line.id, assetId: line.assetId! });
      // Idempotent guard against a concurrent writer that seeded since the check.
      if (!ensured.created) continue;

      const u = await ctx.db.query("projectLineItemUnits").withIndex("by_cuid", (q) => q.eq("id", ensured.id)).unique();
      if (!u) continue;
      await ctx.db.patch(u._id, {
        status: line.status ?? "CONFIRMED",
        returnedQuantity: isBulk ? (line.returnedQuantity ?? 0) : line.status === "RETURNED" ? 1 : 0,
        ...(line.prepStatus !== undefined ? { prepStatus: line.prepStatus } : {}),
        ...(line.prepContainer !== undefined ? { prepContainer: line.prepContainer } : {}),
        ...(line.checkedOutAt !== undefined ? { checkedOutAt: line.checkedOutAt } : {}),
        ...(line.checkedOutById !== undefined ? { checkedOutById: line.checkedOutById } : {}),
        ...(line.returnedAt !== undefined ? { returnedAt: line.returnedAt } : {}),
        ...(line.returnedById !== undefined ? { returnedById: line.returnedById } : {}),
        ...(line.returnCondition !== undefined ? { returnCondition: line.returnCondition } : {}),
        ...(line.returnStatus !== undefined ? { returnStatus: line.returnStatus } : {}),
        ...(line.returnNotes !== undefined ? { returnNotes: line.returnNotes } : {}),
        updatedAt: line.updatedAt ?? Date.now(),
      });
      created++;
    }
    return { scanned, created, isDone: res.isDone, continueCursor: res.continueCursor };
  },
});
