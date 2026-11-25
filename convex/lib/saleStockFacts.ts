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
    const perLineage = new Map<string, number>();
    for (const line of rows) {
      if (line.organizationId !== orgId || !isReservedSaleLine(line)) continue;
      const key = line.lineageId ?? line.id;
      perLineage.set(key, Math.max(perLineage.get(key) ?? 0, line.quantity ?? 0));
    }
    reserved.set(modelId, [...perLineage.values()].reduce((n, q) => n + q, 0));
  }
  return { reserved, truncated: budget.truncated };
}
