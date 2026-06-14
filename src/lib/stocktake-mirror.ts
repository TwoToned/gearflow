import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { prisma } from "@/lib/prisma";
import { api } from "../../convex/_generated/api";

/**
 * `stocktake` + `stocktake_item` are DUAL-WRITTEN (Phase 6 — Convex migration) so
 * the warehouse stocktake scanner can go reactive (replace its 3–5s polling of
 * progress / recent-scans with a Convex subscription). Dual-write, not hard
 * cutover: the tables stay in Prisma (the scanner/review/resolve business logic
 * lives in `src/server/stocktake.ts`, and `stocktake_item` carries asset/bulkAsset
 * FKs and resolution side-effects that mutate inventory).
 *
 * STRATEGY — one workhorse, called after every write commits. The server file
 * mutates stocktakes/items through createMany / updateMany / deleteMany AND
 * single-row scan writes; rather than mirror each site, `syncStocktakeToConvex`
 * re-reads the parent + ALL its items from Prisma (authoritative) and pushes them
 * to `api.stocktakeMirror.sync` in ONE round-trip, which reconciles the Convex copy
 * (replace, not patch — so fields reset to null clear; delete items gone from
 * Prisma). Bounded cost: one indexed `findMany` + one Convex mutation per call,
 * independent of item count — never N HTTP round-trips. The backfill doubles as the
 * heal path.
 *
 * Idempotent: re-running on an unchanged stocktake is a no-op reconcile.
 *
 * CONCURRENCY — each call reconciles a FULL snapshot, so two concurrent scans on
 * the SAME stocktake could race: an older snapshot's `sync` landing after a newer
 * one would revert Convex to stale state (caught in codex review). The app runs as
 * a single Node process (one pm2 instance), so we serialize syncs per `stocktakeId`
 * via a promise chain: each sync reads its Prisma snapshot only AFTER the previous
 * send has fully completed, so the last write's sync always applies last with the
 * freshest data. (Horizontal scaling would instead need a server-stamped monotonic
 * guard inside `stocktakeMirror.sync`.)
 */
async function doSyncStocktake(stocktakeId: string) {
  const [stocktake, items] = await Promise.all([
    prisma.stocktake.findUnique({ where: { id: stocktakeId } }),
    prisma.stocktakeItem.findMany({ where: { stocktakeId } }),
  ]);
  if (!stocktake) return;
  const client = await getConvexClient();
  await client.mutation(api.stocktakeMirror.sync, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stocktake: toConvexDoc(stocktake as unknown as Record<string, unknown>) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: items.map((i) => toConvexDoc(i as unknown as Record<string, unknown>)) as any,
  });
}

// tail of the in-flight sync chain per stocktakeId (single-process serialization).
const syncChains = new Map<string, Promise<unknown>>();

export async function syncStocktakeToConvex(stocktakeId: string | null | undefined) {
  if (!stocktakeId) return;
  const id = stocktakeId;
  const prev = syncChains.get(id) ?? Promise.resolve();
  // Chain after the previous sync (swallow its error so one failure can't wedge
  // the chain); the snapshot read inside doSyncStocktake therefore runs only once
  // the prior send is done.
  const next = prev.then(() => doSyncStocktake(id), () => doSyncStocktake(id));
  syncChains.set(id, next);
  try {
    await next;
  } finally {
    // Drop the entry once this run is the settled tail (no newer sync queued).
    if (syncChains.get(id) === next) syncChains.delete(id);
  }
}

/** Hard-delete a stocktake + items from Convex. Unused by the app (cancel is a
 *  status flip, never a delete) — for backfill/round-trip cleanup only. */
export async function removeStocktakeFromConvex(id: string) {
  await (await getConvexClient()).mutation(api.stocktakeMirror.remove, { id });
}
