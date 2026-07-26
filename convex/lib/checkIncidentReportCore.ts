/**
 * Immediate incident-report trigger for check-item FAILs (FEATUREDOCS/64 — GitHub
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
import type { Doc } from "../_generated/dataModel";
import { writeActivityLog } from "./audit";

/** One client-minted id bundle per DISTINCT failed check item id. */
export interface IncidentPlanEntry {
  checkItemId: string;
  maintenanceId: string;
  maintenanceLinkId: string;
  auditId: string;
}

type FailedCheck = { checkItemId: string; result: string; notes?: string; photos?: string[] };

/** Org-scoped check-item lookup (by_cuid is a GLOBAL index — must org-re-check). */
async function loadOrgCheckItem(ctx: MutationCtx, orgId: string, checkItemId: string) {
  const checkItem = await ctx.db.query("checkItems").withIndex("by_cuid", (q) => q.eq("id", checkItemId)).unique();
  return checkItem && checkItem.organizationId === orgId ? checkItem : null;
}

function buildIncidentDescription(label: string, notes: string | undefined): string {
  return notes ? `"${label}" failed during a check: ${notes}` : `"${label}" failed during a check.`;
}

async function insertIncidentRecord(
  ctx: MutationCtx,
  entry: IncidentPlanEntry,
  args: {
    orgId: string;
    projectId?: string;
    lineItemId?: string;
    userId: string;
    title: string;
    description: string;
    photos?: string[];
    now: number;
  },
): Promise<void> {
  await ctx.db.insert("maintenanceRecords", {
    id: entry.maintenanceId,
    organizationId: args.orgId,
    ...(args.projectId ? { projectId: args.projectId } : {}),
    type: "REPAIR",
    status: "SCHEDULED",
    title: args.title,
    description: args.description,
    reportedById: args.userId,
    photos: args.photos ?? [],
    incidentType: "NEEDS_SERVICE",
    ...(args.lineItemId ? { lineItemId: args.lineItemId } : {}),
    createdAt: args.now,
    updatedAt: args.now,
  });
}

/** Idempotent per (recordId, assetId) pair; rejects a link-id collision (mirrors maintenanceWrites.insertLink). */
async function linkIncidentAsset(ctx: MutationCtx, entry: IncidentPlanEntry, assetId: string): Promise<void> {
  const pair = await ctx.db
    .query("maintenanceRecordAssets")
    .withIndex("by_maintenanceRecordId_assetId", (q) => q.eq("maintenanceRecordId", entry.maintenanceId).eq("assetId", assetId))
    .first();
  if (pair) return;
  const idDup = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", entry.maintenanceLinkId)).unique();
  if (idDup) throw new ConvexError("Maintenance link id collision");
  await ctx.db.insert("maintenanceRecordAssets", {
    id: entry.maintenanceLinkId,
    maintenanceRecordId: entry.maintenanceId,
    assetId,
  });
}

/** One failed check item -> one immediate REPAIR maintenance record + link + audit. */
async function reportOneFailedCheck(
  ctx: MutationCtx,
  check: FailedCheck,
  entry: IncidentPlanEntry,
  asset: Doc<"assets">,
  args: { orgId: string; userId: string; userName: string; projectId?: string; lineItemId?: string; now: number },
): Promise<void> {
  const checkItem = await loadOrgCheckItem(ctx, args.orgId, check.checkItemId);
  if (!checkItem) return;

  const mDup = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", entry.maintenanceId)).unique();
  if (mDup) throw new ConvexError("Maintenance record id already exists");

  const title = `${checkItem.label} failed — ${asset.assetTag}`;
  const description = buildIncidentDescription(checkItem.label, check.notes);

  await insertIncidentRecord(ctx, entry, {
    orgId: args.orgId, projectId: args.projectId, lineItemId: args.lineItemId,
    userId: args.userId, title, description, photos: check.photos, now: args.now,
  });
  await linkIncidentAsset(ctx, entry, asset.id);

  await writeActivityLog(ctx, {
    id: entry.auditId,
    organizationId: args.orgId,
    action: "CREATE",
    entityType: "maintenance",
    entityId: entry.maintenanceId,
    entityName: title,
    userId: args.userId,
    userName: args.userName,
    summary: "Check failure opened a maintenance record",
    assetId: asset.id,
    ...(args.projectId ? { projectId: args.projectId } : {}),
    createdAt: args.now,
  });
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
    checks: FailedCheck[];
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
    await reportOneFailedCheck(ctx, check, entry, asset, { orgId, userId, userName, projectId, lineItemId, now });
  }
}
