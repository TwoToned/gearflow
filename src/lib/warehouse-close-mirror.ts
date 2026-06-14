import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * `warehouseClose` dual-write (Phase 4 — reactive). End-of-day close-out
 * summaries are append-only; mirroring them lets the warehouse views subscribe
 * so a close created by one staffer shows up live for everyone watching.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent); heals on the
 * convex-backfill-warehouse-close run. See FEATUREDOCS/54.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

const RELATION_KEYS = new Set([
  "project", "closedBy", "organization", "_count",
]);
function strip(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!RELATION_KEYS.has(k)) out[k] = v;
  return out;
}

async function create(fn: AnyRef, row: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, toConvexDoc(strip(row)) as any);
}
async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id } as any);
}

export const mirrorWarehouseCloseCreate = (row: Record<string, unknown>) => create(api.warehouseCloses.create, row);
export const removeWarehouseCloseFromConvex = (id: string) => remove(api.warehouseCloses.remove, id);
