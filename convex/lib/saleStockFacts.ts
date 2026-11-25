import type { QueryCtx } from "../_generated/server";
import { collectCapped } from "./pagination";
import type { ReadBudget } from "./readBudget";

/**
 * The ONE definition of the Sales stock list's stock terms (UX Phase 14, D41).
 *
 * `models.saleStockQuantity` is the new-stock pool NET of every sale line: adding
 * a NEW_STOCK sale line decrements it (convex/lib/saleStock.ts), whatever the
 * job's status or version, and it stays down (nothing restores it on cancel). So:
 *
 *   available = pool                       (what can still be sold)
 *   reserved  = qty on sale lines whose quantity was taken from the pool and have not gone out
 *               (`takesFromPool`: the SAME predicate the write path decrements by; still in the building)
 *   onHand    = pool + reserved            (physical stock in the building)
 *
 * which makes `onHand - reserved === available` by construction: a sale line is
 * counted once, in `reserved`, and never in the pool as well. Nothing here is stored.
 */

export const SALE_STOCK_SEGMENT_KEYS = ["all", "low", "out"] as const;
export type SaleStockSegmentKey = (typeof SALE_STOCK_SEGMENT_KEYS)[number];

export function parseSaleStockSegment(raw: string | undefined): SaleStockSegmentKey {
  return SALE_STOCK_SEGMENT_KEYS.find((k) => k === raw) ?? "all";
}

/** A sale line in one of these states has left the building. */
const OUT_LINE_STATUSES = new Set(["CHECKED_OUT", "RETURNED"]);

interface LineLike {
  type?: string | null;
  saleMode?: string | null;
  status?: string | null;
  quantity?: number | null;
  modelId?: string | null;
}

/**
 * THE predicate (review ruling): "this line's quantity was taken out of the new-stock pool". The write path
 * (`applySaleStockOnAdd`) decrements the pool exactly when this is true, and Reserved counts exactly the
 * lines for which it is true and which have not gone out, so the two cannot drift. It is deliberately
 * independent of the job's status and the line's version: the decrement was applied at add time whatever
 * they were, and nothing restores it on cancel (a known write-path gap, logged as a follow-up), so a
 * cancelled job's held stock honestly reads as reserved. An UNSET `saleMode` is not decremented today, so
 * it is not counted either.
 */
export function takesFromPool(line: Pick<LineLike, "type" | "saleMode" | "modelId">): boolean {
  return line.type === "SALE" && line.saleMode === "NEW_STOCK" && !!line.modelId;
}

/** Pure: is this line's taken-from-pool quantity still physically in the building (counted in `reserved`)? */
export function isReservedSaleLine(line: LineLike): boolean {
  return takesFromPool(line) && !OUT_LINE_STATUSES.has(line.status ?? "");
}

/** The fields of a sale row the pool is accounted by. */
export type PoolRow = LineLike;

/**
 * Pure: what a lineage takes from the pool, per model: the MAX quantity over its rows for which `takesFromPool`
 * holds (a copy in another version is the same add, so it adds nothing). Out rows count here: the stock left
 * the pool when it was added, whether or not it has since left the building.
 */
export function poolTakeByModel(rows: readonly PoolRow[]): Map<string, number> {
  const take = new Map<string, number>();
  for (const r of rows) {
    if (!takesFromPool(r)) continue;
    take.set(r.modelId!, Math.max(take.get(r.modelId!) ?? 0, r.quantity ?? 0));
  }
  return take;
}

/**
 * Pure: the change in the pool when one lineage's rows go from `before` to `after`, per model, nonzero entries
 * only. Positive = stock restored to the pool, negative = more taken. THE one helper every write path applies,
 * so the pool and Reserved (which reads the same per-lineage maximum) cannot drift.
 */
export function lineagePoolDelta(before: readonly PoolRow[], after: readonly PoolRow[]): Map<string, number> {
  const b = poolTakeByModel(before);
  const a = poolTakeByModel(after);
  const delta = new Map<string, number>();
  for (const model of new Set([...b.keys(), ...a.keys()])) {
    const d = (b.get(model) ?? 0) - (a.get(model) ?? 0);
    if (d !== 0) delta.set(model, d);
  }
  return delta;
}

export type SaleStockState = "OK" | "LOW" | "OUT";

export interface SaleStockFacts {
  onHand: number;
  reserved: number;
  /** The pool: on hand minus reserved. */
  available: number;
  state: SaleStockState;
}

/** Pure: the three figures and the state from the stored pool, the derived reserved qty and the reorder level. */
export function saleStockFacts(a: { pool: number | null | undefined; reserved: number; reorderLevel?: number | null }): SaleStockFacts {
  const available = a.pool ?? 0;
  const reserved = Math.max(0, a.reserved);
  const onHand = available + reserved;
  // OUT: nothing left to sell (a negative pool is oversold). LOW: at or under a SET reorder level.
  const state: SaleStockState = available <= 0 ? "OUT" : a.reorderLevel != null && available <= a.reorderLevel ? "LOW" : "OK";
  return { onHand, reserved, available, state };
}

/** Pure: does the model belong in the strip segment? `low` = LOW only; `out` = OUT. */
export function saleStockInSegment(state: SaleStockState, segment: SaleStockSegmentKey): boolean {
  if (segment === "all") return true;
  return segment === "out" ? state === "OUT" : state === "LOW";
}

/** Lines one model's read may take (the per-model ceiling; the call's budget can lower it). */
const RESERVED_LINE_CAP = 5000;

/**
 * modelId -> reserved qty for the org: the NEW_STOCK sale lines whose quantity was taken from the pool and
 * that have not gone out (`isReservedSaleLine`, any version, any job status). A line copied into another
 * version is one add, so it counts ONCE per lineage.
 *
 * Reads `by_modelId` (GLOBAL index) per model, re-checks the org on every row, and draws every document
 * read from the call's ONE budget. A model the budget could not cover is ABSENT from the map (its figure
 * is unknown, never a guess) and `truncated` is set.
 */
export async function loadReservedByModel(
  ctx: QueryCtx,
  orgId: string,
  modelIds: readonly string[],
  budget: ReadBudget,
): Promise<{ reserved: Map<string, number>; truncated: boolean }> {
  const reserved = new Map<string, number>();
  for (const modelId of modelIds) {
    if (!budget.hasRoom) {
      budget.truncated = true;
      break;
    }
    const room = Math.min(RESERVED_LINE_CAP, budget.left);
    const { rows, truncated } = await collectCapped(ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", modelId)), room);
    budget.take(rows.length);
    if (truncated) {
      budget.truncated = true;
      continue;
    }
    // Per lineage: the pool-taking maximum, and whether any of its rows has left the building (then none of it is here).
    const perLineage = new Map<string, { qty: number; out: boolean }>();
    for (const line of rows) {
      if (line.organizationId !== orgId || !takesFromPool(line)) continue;
      const key = line.lineageId ?? line.id;
      const cur = perLineage.get(key) ?? { qty: 0, out: false };
      perLineage.set(key, { qty: Math.max(cur.qty, line.quantity ?? 0), out: cur.out || !isReservedSaleLine(line) });
    }
    reserved.set(modelId, [...perLineage.values()].reduce((n, l) => n + (l.out ? 0 : l.qty), 0));
  }
  return { reserved, truncated: budget.truncated };
}
