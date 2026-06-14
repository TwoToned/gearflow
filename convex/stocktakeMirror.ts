import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireService } from "./lib/auth";
import * as enums from "./lib/validators";

/**
 * Dual-write sink for the STOCKTAKE domain (Phase 6 — Convex migration). A
 * stocktake + its items are written from a single server file
 * (`src/server/stocktake.ts`) via many patterns (createMany / updateMany /
 * deleteMany / single-row scan writes). Rather than mirror each site, the server
 * mirror (`src/lib/stocktake-mirror.ts`) re-reads the parent + ALL items from
 * Prisma after every commit and pushes them here in ONE round-trip; this function
 * reconciles the Convex copy authoritatively.
 *
 * WHY a custom mutation instead of the generated per-row CRUD:
 *   • ONE round-trip for the whole stocktake — a full-warehouse stocktake can have
 *     hundreds of items; N generated `create`/`update` HTTP calls per scan would be
 *     unacceptable. The reconcile diff runs server-side in a single Convex tx.
 *   • `ctx.db.replace` (NOT `patch`) for the parent and each item — the server
 *     mirror sends `toConvexDoc(row)`, which DROPS null→absent. A patch would leave
 *     a field that was reset to null (e.g. `scannedAt`/`scannedById` on
 *     unmark-found) at its STALE value; replace overwrites the whole doc so absent
 *     fields clear. This is the silent-staleness guard for the eventual reactive
 *     scanner.
 *   • Authoritative item set — items present only in Convex (a regenerate /
 *     deleteMany on the Prisma side) are deleted, so the two never drift.
 *
 * Service-only (Convex writes are never browser-callable). Org scoping is enforced
 * by the trusted server action before it calls this; `stocktakeItems` carries no
 * organizationId of its own (scoped via its parent stocktake).
 */

// Arg validators mirror the table schema exactly (same enum validators) so the
// args validate AND the values type-check against ctx.db.insert/replace, which
// require the precise enum unions (not a loose string).
const stocktakeArg = v.object({
  id: v.string(),
  organizationId: v.string(),
  name: v.string(),
  locationId: v.string(),
  scope: enums.StocktakeScope,
  categoryId: v.optional(v.string()),
  status: v.optional(enums.StocktakeStatus),
  startedAt: v.optional(v.number()),
  startedById: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  reviewedById: v.optional(v.string()),
  expectedCount: v.optional(v.number()),
  foundCount: v.optional(v.number()),
  missingCount: v.optional(v.number()),
  unexpectedCount: v.optional(v.number()),
  discrepancyCount: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
});

const itemArg = v.object({
  id: v.string(),
  stocktakeId: v.string(),
  assetId: v.optional(v.string()),
  bulkAssetId: v.optional(v.string()),
  expectedAtLocation: v.optional(v.boolean()),
  expectedQuantity: v.optional(v.number()),
  found: v.optional(v.boolean()),
  foundQuantity: v.optional(v.number()),
  scannedAt: v.optional(v.number()),
  scannedById: v.optional(v.string()),
  result: v.optional(enums.StocktakeItemResult),
  conditionNote: v.optional(v.string()),
  actionTaken: v.optional(v.string()),
});

export const sync = mutation({
  args: { stocktake: stocktakeArg, items: v.array(itemArg) },
  handler: async (ctx, { stocktake, items }) => {
    await requireService(ctx);

    // Upsert the parent (replace = full overwrite, so cleared fields clear).
    const existing = await ctx.db
      .query("stocktakes")
      .withIndex("by_cuid", (q) => q.eq("id", stocktake.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, stocktake);
    else await ctx.db.insert("stocktakes", stocktake);

    // Reconcile items: delete the ones no longer in Prisma, replace/insert the rest.
    const existingItems = await ctx.db
      .query("stocktakeItems")
      .withIndex("by_stocktakeId", (q) => q.eq("stocktakeId", stocktake.id))
      .collect();
    const byId = new Map(existingItems.map((e) => [e.id, e]));
    const incomingIds = new Set(items.map((i) => i.id));
    for (const ex of existingItems) {
      if (!incomingIds.has(ex.id)) await ctx.db.delete(ex._id);
    }
    for (const item of items) {
      const ex = byId.get(item.id);
      if (ex) await ctx.db.replace(ex._id, item);
      else await ctx.db.insert("stocktakeItems", item);
    }
  },
});

/** Hard-delete a stocktake + all its items from Convex. The app never hard-deletes
 *  a stocktake (cancel = a status flip), so this exists only for backfill/round-trip
 *  cleanup. */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireService(ctx);
    const st = await ctx.db
      .query("stocktakes")
      .withIndex("by_cuid", (q) => q.eq("id", id))
      .unique();
    if (st) await ctx.db.delete(st._id);
    const items = await ctx.db
      .query("stocktakeItems")
      .withIndex("by_stocktakeId", (q) => q.eq("stocktakeId", id))
      .collect();
    for (const it of items) await ctx.db.delete(it._id);
  },
});
