/**
 * "Which jobs is this tag on right now?" — shared by `scanLookup.resolve` (the floor's
 * Look up) and the Scan page's `scanLookup.checkCard` / `testCard` (Phase 16, moved
 * here from `convex/scanLookup.ts`). Bounded: at most {@link MAX_UNITS_PER_STATUS}
 * units per active status. Every line / project read on the GLOBAL `by_cuid` index is
 * org-checked, and templates and cancelled lines never count.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const MAX_UNITS_PER_STATUS = 10;
export const ACTIVE_UNIT_STATUSES = ["CONFIRMED", "PREPPED", "CHECKED_OUT"] as const;

export type ActivityState = "to_pick" | "packed" | "out";
export type Activity = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  lineItemId: string;
  state: ActivityState;
  quantity: number;
};

export function stateOf(status: string | undefined, prepStatus: string | undefined): ActivityState {
  if (status === "CHECKED_OUT") return "out";
  if (status === "PREPPED" || prepStatus === "PACKED") return "packed";
  return "to_pick";
}

/** The project, if it is ours and not a template (`by_cuid` is global). */
export async function projectFor(ctx: QueryCtx, orgId: string, projectId: string): Promise<Doc<"projects"> | null> {
  const project = await ctx.db.query("projects").withIndex("by_cuid", (q) => q.eq("id", projectId)).first();
  return project && project.organizationId === orgId && !project.isTemplate ? project : null;
}

/** The unit's line and job, if both are ours and the line is live work. */
async function jobOf(ctx: QueryCtx, orgId: string, lineItemId: string) {
  const line = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).first();
  if (!line || line.organizationId !== orgId || line.status === "CANCELLED") return null;
  const project = await projectFor(ctx, orgId, line.projectId);
  return project ? { line, project } : null;
}

type UnitRow = { lineItemId: string; status?: string; prepStatus?: string; quantity?: number; returnedQuantity?: number };

export async function activityFromUnits(ctx: QueryCtx, orgId: string, units: UnitRow[]): Promise<Activity[]> {
  const out: Activity[] = [];
  for (const u of units) {
    const quantity = Math.max(0, (u.quantity ?? 1) - (u.returnedQuantity ?? 0));
    if (quantity === 0) continue;
    const job = await jobOf(ctx, orgId, u.lineItemId);
    if (!job) continue;
    out.push({
      projectId: job.project.id,
      projectNumber: job.project.projectNumber,
      projectName: job.project.name,
      lineItemId: job.line.id,
      state: stateOf(u.status, u.prepStatus),
      quantity,
    });
  }
  return out;
}

export async function unitsFor(ctx: QueryCtx, orgId: string, field: "assetId" | "bulkAssetId", id: string): Promise<UnitRow[]> {
  const perStatus = await Promise.all(
    ACTIVE_UNIT_STATUSES.map((status) =>
      field === "assetId"
        ? ctx.db
            .query("projectLineItemUnits")
            .withIndex("by_organizationId_assetId_status", (q) => q.eq("organizationId", orgId).eq("assetId", id).eq("status", status))
            .take(MAX_UNITS_PER_STATUS)
        : ctx.db
            .query("projectLineItemUnits")
            .withIndex("by_organizationId_bulkAssetId_status", (q) => q.eq("organizationId", orgId).eq("bulkAssetId", id).eq("status", status))
            .take(MAX_UNITS_PER_STATUS),
    ),
  );
  return perStatus.flat();
}
