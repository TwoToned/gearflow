import { type FunctionReference } from "convex/server";
import { getConvexClient, toConvexDoc } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";

/**
 * `savedReport` dual-write (Phase 4 — reactive). Saved reports can be shared
 * across the org (`isShared`), so mirroring them lets the reports page subscribe:
 * a teammate creating, editing, pinning, or deleting a shared report shows up
 * live for everyone.
 *
 * Clear-to-null caveat applies (toConvexDoc drops null→absent); heals on the
 * convex-backfill-saved-reports run. See FEATUREDOCS/54.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRef = FunctionReference<"mutation", "public", any, any>;

const RELATION_KEYS = new Set([
  "createdBy", "organization", "_count",
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
async function patch(fn: AnyRef, id: string, row: Record<string, unknown>) {
  const { id: _id, ...rest } = toConvexDoc(strip(row));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id, patch: rest } as any);
}
async function remove(fn: AnyRef, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (await getConvexClient()).mutation(fn, { id } as any);
}

export const mirrorSavedReportCreate = (row: Record<string, unknown>) => create(api.savedReports.create, row);
export const patchSavedReportInConvex = (id: string, row: Record<string, unknown>) => patch(api.savedReports.update, id, row);
export const removeSavedReportFromConvex = (id: string) => remove(api.savedReports.remove, id);
