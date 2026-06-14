import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOrgReadDoc } from "./lib/auth";

/**
 * Reactive "version vector" for the warehouse STOCKTAKE SCANNER
 * (`stocktake-scanner.tsx`, status IN_PROGRESS). HAND-WRITTEN — follows the
 * convex/<table>Detail.ts convention (kitDetail/assetDetail/warehouseDetail).
 *
 * WHY a version vector and not reactive Convex composites. The scanner reads three
 * server actions — `getStocktakeProgress` (counts), `getRecentScans` and
 * `searchStocktakeAssets` (both join asset/bulkAsset → model for display). Rebuilding
 * those joined shapes in Convex would be a data-shape-drift footgun, so the server
 * actions stay byte-identical and `useReactiveServerQuery` re-runs them whenever this
 * cheap vector changes. It replaces the scanner's `refetchInterval` polling (progress
 * every 5s, recent every 3s) with a Convex push — and, for free, makes it cross-user
 * live (two pickers scanning the same stocktake see each other's counts).
 *
 * stocktake + stocktake_item are dual-written (src/lib/stocktake-mirror.ts), so this
 * is live. The signature folds every per-item field the three readers surface or
 * decide on — `found` / `foundQuantity` / `scannedAt` (recent-scans order + progress
 * count), `result`, `expectedQuantity`, and the asset/bulk assignment — so an
 * in-place scan (found flips, same row count) moves the vector. Parent
 * status/expectedCount/foundCount cover the progress header.
 *
 * ★ getRecentScans + searchStocktakeAssets JOIN asset/bulkAsset → model and
 * display/search `assetTag` / `customName` / `serialNumber` / `model.name`. Those
 * joins don't touch the stocktake_item row, so renaming an asset/model elsewhere
 * wouldn't move the vector — and with the 3s poll gone the scanner would show stale
 * tags/names. So fold the joined fields in too (assets/bulkAssets/models are all
 * dual-written), deduped by referenced id to bound the reads (same
 * cross-domain-join-freshness fix codex flagged on warehouseDetail.listVersion).
 *
 * Browser-readable: org scoping via requireOrgReadDoc on the parent stocktake
 * (stocktakeItems carry no organizationId of their own). Returns only
 * counts/ids/flags/timestamps/joined-labels — no secrets.
 */
export const version = query({
  args: { stocktakeId: v.string() },
  handler: async (ctx, { stocktakeId }) => {
    const stocktake = await ctx.db
      .query("stocktakes")
      .withIndex("by_cuid", (q) => q.eq("id", stocktakeId))
      .unique();
    await requireOrgReadDoc(ctx, stocktake);
    if (!stocktake) return null;

    const items = await ctx.db
      .query("stocktakeItems")
      .withIndex("by_stocktakeId", (q) => q.eq("stocktakeId", stocktakeId))
      .collect();

    // Resolve the distinct referenced asset / bulk / model docs once (explicit
    // per-table so each doc type narrows for field access).
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
    const assetDocs = await Promise.all(
      uniq(items.map((i) => i.assetId)).map((id) =>
        ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
      ),
    );
    const bulkDocs = await Promise.all(
      uniq(items.map((i) => i.bulkAssetId)).map((id) =>
        ctx.db.query("bulkAssets").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
      ),
    );
    const assetMap = new Map(assetDocs.filter(Boolean).map((a) => [a!.id, a!]));
    const bulkMap = new Map(bulkDocs.filter(Boolean).map((b) => [b!.id, b!]));
    const modelDocs = await Promise.all(
      uniq([
        ...assetDocs.filter(Boolean).map((a) => a!.modelId),
        ...bulkDocs.filter(Boolean).map((b) => b!.modelId),
      ]).map((id) =>
        ctx.db.query("models").withIndex("by_cuid", (q) => q.eq("id", id)).unique(),
      ),
    );
    const modelNameMap = new Map(modelDocs.filter(Boolean).map((m) => [m!.id, m!.name ?? ""]));
    const modelName = (modelId?: string) => (modelId ? (modelNameMap.get(modelId) ?? "") : "");

    const itemsSig = items
      .map((i) => {
        const a = i.assetId ? assetMap.get(i.assetId) : undefined;
        const b = i.bulkAssetId ? bulkMap.get(i.bulkAssetId) : undefined;
        // Folds the joined display/search labels: asset → tag/customName/serial/model,
        // bulk → tag/model.
        const joined = a
          ? `${a.assetTag ?? ""}/${a.customName ?? ""}/${a.serialNumber ?? ""}/${modelName(a.modelId)}`
          : b
            ? `${b.assetTag ?? ""}/${modelName(b.modelId)}`
            : "";
        return `${i.id}:${i.found ? 1 : 0}:${i.foundQuantity ?? ""}:${i.scannedAt ?? ""}:${i.result ?? ""}:${i.expectedQuantity ?? ""}:${i.assetId ?? ""}:${i.bulkAssetId ?? ""}:${joined}`;
      })
      .sort()
      .join("|");

    return {
      stocktake: stocktake.updatedAt ?? stocktake._creationTime,
      status: stocktake.status ?? "",
      expectedCount: stocktake.expectedCount ?? 0,
      foundCount: stocktake.foundCount ?? 0,
      items: itemsSig,
    };
  },
});
