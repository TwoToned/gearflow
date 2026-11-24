import type { QueryCtx } from "../_generated/server";
import { collectCapped } from "./pagination";

/**
 * The ONE definition of the Sales stock list's stock terms (UX Phase 14, D41).
 *
 * `models.saleStockQuantity` is the new-stock pool NET of every sale line: adding
 * a NEW_STOCK sale line decrements it (convex/lib/saleStock.ts), whatever the
 * job's status, and it stays down while the line is out. So:
 *
 *   available = pool                       (what can still be sold)
 *   reserved  = qty on sale lines that are on a live job and have not gone out
 *               (already subtracted from the pool, still physically in the building)
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

/** Job statuses whose sale lines no longer hold stock aside (same set as the overbooking board's dead statuses). */
const DEAD_PROJECT_STATUSES = new Set(["CANCELLED", "RETURNED", "COMPLETED", "INVOICED"]);
/** A sale line in one of these states has left the building (or never will). */
const LEFT_LINE_STATUSES = new Set(["CHECKED_OUT", "RETURNED", "CANCELLED"]);

interface LineLike {
  type?: string | null;
  saleMode?: string | null;
  status?: string | null;
  quantity?: number | null;
  versionId?: string | null;
  projectId: string;
}
interface ProjectLike {
  status?: string | null;
  isTemplate?: boolean | null;
  liveVersionId?: string | null;
}

/** Pure: does this line hold stock aside (counted in `reserved`)? */
export function isReservedSaleLine(line: LineLike, project: ProjectLike | undefined): boolean {
  if (!project || project.isTemplate) return false;
  if (line.type !== "SALE") return false;
  if ((line.saleMode ?? "NEW_STOCK") !== "NEW_STOCK") return false;
  if (DEAD_PROJECT_STATUSES.has(project.status ?? "")) return false;
  if (LEFT_LINE_STATUSES.has(line.status ?? "")) return false;
  // Lines are versioned: only the live version's lines are real.
  return line.versionId != null && line.versionId === project.liveVersionId;
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

/** Lines read per call: sale lines are a tiny slice of an org's lines, but the read must still be bounded. */
const RESERVED_LINE_CAP = 5000;

/**
 * modelId -> reserved qty for the org (live-version NEW_STOCK sale lines not yet out).
 * Reads `by_modelId` (GLOBAL index) per model and re-checks the org on every row.
 */
export async function loadReservedByModel(
  ctx: QueryCtx,
  orgId: string,
  modelIds: readonly string[],
): Promise<{ reserved: Map<string, number>; truncated: boolean }> {
  const reserved = new Map<string, number>();
  let truncated = false;
  const projectCache = new Map<string, ProjectLike | undefined>();
  for (const modelId of modelIds) {
    const { rows, truncated: t } = await collectCapped(
      ctx.db.query("projectLineItems").withIndex("by_modelId", (q) => q.eq("modelId", modelId)),
      RESERVED_LINE_CAP,
    );
    if (t) truncated = true;
    let sum = 0;
    for (const line of rows) {
      if (line.organizationId !== orgId || line.type !== "SALE") continue;
      if (!projectCache.has(line.projectId)) {
        const p = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", line.projectId)).first();
        projectCache.set(line.projectId, p && p.organizationId === orgId ? p : undefined);
      }
      if (isReservedSaleLine(line, projectCache.get(line.projectId))) sum += line.quantity ?? 0;
    }
    if (sum > 0) reserved.set(modelId, sum);
  }
  return { reserved, truncated };
}
