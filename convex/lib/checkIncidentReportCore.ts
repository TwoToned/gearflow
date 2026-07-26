/**
 * Immediate incident-report trigger for check-item FAILs (FEATUREDOCS/62 — GitHub
 * #898 feature area 2: "Checks that actually do something"). Runs INSIDE the calling
 * check mutation's transaction, alongside (not replacing) `runFailPredictiveMaintenance`
 * / `runPredictiveMaintenance` (checkPredictiveMaintenanceCore.ts) — the existing
 * 2-of-3-fails trend signal is preserved unchanged. This trigger fires on EVERY FAIL,
 * immediately, creating a REPAIR maintenance record instead of only flipping
 * `prepStatus=FLAGGED_FAULTY` on the line.
 *
 * Deliberately does NOT touch `asset.status` — mirrors the predictive core's own
 * documented reasoning: a PREP/DE-PREP check happens at the warehouse counter, not
 * mid-deploy, so there's no "pull it from availability right now" urgency the way
 * there is for the mid-job "Report Issue" flow (convex/incidentWrites.ts). The line's
 * existing `prepStatus=FLAGGED_FAULTY` transition (set by the calling mutation) is
 * the operative signal here.
 *
 * Atomic like its sibling — an error here rolls the whole check back. All ids
 * (maintenanceId / link id / auditId) are CLIENT-minted, one bundle per DISTINCT
 * failed check item id. ConvexError only.
 */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import { writeActivityLog } from "./audit";

/** One client-minted id bundle per DISTINCT failed check item id. */
export interface IncidentPlanEntry {
  checkItemId: string;
  maintenanceId: string;
  maintenanceLinkId: string;
  auditId: string;
}

export async function runFailIncidentReport(
  ctx: MutationCtx,
  args: {
    orgId: string;
    userId: string;
    userName: string;
    assetId: string;
    projectId?: string;
    lineItemId?: string;
    checks: Array<{ checkItemId: string; result: string; notes?: string; photos?: string[] }>;
    plan: IncidentPlanEntry[];
    now: number;
  },
): Promise<void> {
  const { orgId, userId, userName, assetId, projectId, lineItemId, checks, plan, now } = args;
  if (!assetId || plan.length === 0) return;

  const failedChecks = checks.filter((c) => c.result === "FAIL");
  if (failedChecks.length === 0) return;
  const planByItem = new Map(plan.map((e) => [e.checkItemId, e]));

  const asset = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).unique();
  if (!asset || asset.organizationId !== orgId) return;

  for (const check of failedChecks) {
    const entry = planByItem.get(check.checkItemId);
    if (!entry) continue; // caller's plan is authoritative; a missing entry means no report for this item

    const checkItem = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", check.checkItemId)).unique();
    if (!checkItem || checkItem.organizationId !== orgId) continue;

    const mDup = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", entry.maintenanceId)).unique();
    if (mDup) throw new ConvexError("Maintenance record id already exists");

    const title = `${checkItem.label} failed — ${asset.assetTag}`;
    const description = check.notes
      ? `"${checkItem.label}" failed during a check: ${check.notes}`
      : `"${checkItem.label}" failed during a check.`;

    await ctx.db.insert("maintenanceRecords", {
      id: entry.maintenanceId,
      organizationId: orgId,
      ...(projectId ? { projectId } : {}),
      type: "REPAIR",
      status: "SCHEDULED",
      title,
      description,
      reportedById: userId,
      photos: check.photos && check.photos.length > 0 ? check.photos : [],
      incidentType: "NEEDS_SERVICE",
      ...(lineItemId ? { lineItemId } : {}),
      createdAt: now,
      updatedAt: now,
    });

    const pair = await ctx.db
      .query("maintenanceRecordAssets")
      .withIndex("by_maintenanceRecordId_assetId", (q) => q.eq("maintenanceRecordId", entry.maintenanceId).eq("assetId", assetId))
      .first();
    if (!pair) {
      const idDup = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", entry.maintenanceLinkId)).unique();
      if (idDup) throw new ConvexError("Maintenance link id collision");
      await ctx.db.insert("maintenanceRecordAssets", {
        id: entry.maintenanceLinkId,
        maintenanceRecordId: entry.maintenanceId,
        assetId,
      });
    }

    await writeActivityLog(ctx, {
      id: entry.auditId,
      organizationId: orgId,
      action: "CREATE",
      entityType: "maintenance",
      entityId: entry.maintenanceId,
      entityName: title,
      userId,
      userName,
      summary: "Check failure opened a maintenance record",
      assetId,
      ...(projectId ? { projectId } : {}),
      createdAt: now,
    });
  }
}
