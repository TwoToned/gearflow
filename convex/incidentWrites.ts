import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOrgPermission, resolveActor } from "./lib/auth";
import { assertWritesEnabled } from "./lib/writeGuard";
import { enforceBrowserWriteLimit } from "./lib/rateLimiter";
import { writeActivityLog } from "./lib/audit";
import type { AgentOpsAnnotations } from "./lib/agentOps";
import { assertStrLen, assertArrayMax } from "./lib/fieldGuards";
import * as enums from "./lib/validators";

/**
 * Browser-direct "Report Issue" write (FEATUREDOCS/64-incident-reporting.md — GitHub
 * #898). The in-app successor to the deleted Discord `/fault` command: creates a
 * `maintenanceRecords` row (type=REPAIR, incidentType/incidentSeverity set) AND flips
 * the reported asset's status IMMEDIATELY (product decision — no triage delay):
 * BROKEN_DAMAGED / NEEDS_SERVICE -> IN_MAINTENANCE, LOST_MISSING -> LOST.
 *
 * Deliberately NOT built on `maintenanceWrites.createNative`: that mutation's
 * `holdAssets` helper only transitions AVAILABLE -> IN_MAINTENANCE, so it silently
 * no-ops on the CHECKED_OUT assets this flow targets. This mutation instead
 * unconditionally patches the resolved asset's status once report-worthiness is
 * established (mirrors `warehouseWrites.forceReturnAsset`'s single-guard-then-patch
 * shape), independent of the maintenance hold/release state machine.
 *
 * Security bar (exact order): assertWritesEnabled(maintenance) ->
 * enforceBrowserWriteLimit -> requireOrgPermission(maintenance, create) ->
 * resolveActor. Every doc fetched by a GLOBAL by_cuid index is org-re-checked.
 * ConvexError only.
 */

const actorValidator = v.object({ userId: v.string(), userName: v.string() });

/** Statuses reported issues fall out of the available pool onto. */
function targetAssetStatus(incidentType: "BROKEN_DAMAGED" | "LOST_MISSING" | "NEEDS_SERVICE"): "IN_MAINTENANCE" | "LOST" {
  return incidentType === "LOST_MISSING" ? "LOST" : "IN_MAINTENANCE";
}

const INCIDENT_TYPE_LABEL: Record<string, string> = {
  BROKEN_DAMAGED: "Broken/damaged",
  LOST_MISSING: "Lost/missing",
  NEEDS_SERVICE: "Needs service",
};

async function requireLineInProject(
  ctx: MutationCtx,
  lineItemId: string,
  orgId: string,
  projectId: string,
): Promise<Doc<"projectLineItems">> {
  const l = await ctx.db.query("projectLineItems").withIndex("by_cuid", (q) => q.eq("id", lineItemId)).unique();
  if (!l || l.organizationId !== orgId || l.projectId !== projectId) {
    throw new ConvexError("Line item not found in project");
  }
  return l;
}

async function requireAssetInOrg(ctx: MutationCtx, assetId: string, orgId: string): Promise<Doc<"assets">> {
  const a = await ctx.db.query("assets").withIndex("by_cuid", (q) => q.eq("id", assetId)).unique();
  if (!a || a.organizationId !== orgId) throw new ConvexError("Asset not found in organization: " + assetId);
  return a;
}

/**
 * Resolve the reported asset: an explicit assetId (asset detail page — no line
 * item in play), or via the reported line item (project / warehouse tabs),
 * falling back to the line's bulk asset for pooled items. Throws unless a
 * reportable (non-RETIRED) asset was found.
 */
async function resolveReportedAsset(
  ctx: MutationCtx,
  a: { orgId: string; assetId?: string; lineItemId?: string; projectId?: string },
): Promise<Doc<"assets">> {
  let resolvedAssetId = a.assetId || "";
  if (a.lineItemId) {
    if (!a.projectId) throw new ConvexError("projectId is required when reporting against a line item");
    const line = await requireLineInProject(ctx, a.lineItemId, a.orgId, a.projectId);
    resolvedAssetId = resolvedAssetId || line.assetId || line.bulkAssetId || "";
  }
  if (!resolvedAssetId) throw new ConvexError("An asset is required to report an issue");

  const asset = await requireAssetInOrg(ctx, resolvedAssetId, a.orgId);
  if (asset.status === "RETIRED") throw new ConvexError("Cannot report an issue on a retired asset");
  return asset;
}

/** Idempotent per (recordId, assetId) pair; rejects a link-id collision (mirrors maintenanceWrites.insertLink). */
async function linkIncidentAsset(ctx: MutationCtx, recordId: string, linkId: string, assetId: string): Promise<void> {
  const pair = await ctx.db
    .query("maintenanceRecordAssets")
    .withIndex("by_maintenanceRecordId_assetId", (q) => q.eq("maintenanceRecordId", recordId).eq("assetId", assetId))
    .first();
  if (pair) return;
  const idDup = await ctx.db.query("maintenanceRecordAssets").withIndex("by_cuid", (q) => q.eq("id", linkId)).unique();
  if (idDup) throw new ConvexError("Maintenance link id collision");
  await ctx.db.insert("maintenanceRecordAssets", { id: linkId, maintenanceRecordId: recordId, assetId });
}

// ─── reportIssueNative ─── maintenance:create
export const reportIssueNative = mutation({
  returns: v.object({ id: v.string() }),
  args: {
    orgId: v.string(),
    recordId: v.string(),
    linkId: v.string(),
    projectId: v.optional(v.string()),
    lineItemId: v.optional(v.string()),
    assetId: v.optional(v.string()),
    incidentType: enums.IncidentType,
    incidentSeverity: enums.IncidentSeverity,
    description: v.string(),
    photos: v.array(v.string()),
    now: v.number(),
    actor: actorValidator,
    auditId: v.string(),
  },
  handler: async (ctx, a) => {
    await assertWritesEnabled(ctx, "maintenance");
    await enforceBrowserWriteLimit(ctx);
    await requireOrgPermission(ctx, a.orgId, "maintenance", "create");
    const actor = await resolveActor(ctx, a.actor);

    assertStrLen(a.description, "description", { min: 1, max: 5000 });
    assertArrayMax(a.photos, "photos", 20);
    if (a.photos.length === 0) {
      throw new ConvexError("At least one photo is required to report an issue");
    }

    const asset = await resolveReportedAsset(ctx, a);

    // Dup-guard by_cuid (GLOBAL): reject a cross-org collision, treat a same-org
    // collision as an idempotent retry.
    const dup = await ctx.db.query("maintenanceRecords").withIndex("by_cuid", (q) => q.eq("id", a.recordId)).unique();
    if (dup && dup.organizationId !== a.orgId) throw new ConvexError("Maintenance record id already exists");
    if (dup) return { id: a.recordId };

    const title = `${INCIDENT_TYPE_LABEL[a.incidentType]} — ${asset.assetTag}`;

    await ctx.db.insert("maintenanceRecords", {
      id: a.recordId,
      organizationId: a.orgId,
      ...(a.projectId ? { projectId: a.projectId } : {}),
      type: "REPAIR",
      status: "SCHEDULED",
      title,
      description: a.description,
      reportedById: actor.userId,
      photos: a.photos,
      incidentType: a.incidentType,
      incidentSeverity: a.incidentSeverity,
      ...(a.lineItemId ? { lineItemId: a.lineItemId } : {}),
      createdAt: a.now,
      updatedAt: a.now,
    });

    await linkIncidentAsset(ctx, a.recordId, a.linkId, asset.id);

    // Flip the asset's status immediately — product decision: no triage delay.
    // Unconditional aside from the RETIRED guard in resolveReportedAsset (unlike
    // maintenanceWrites' holdAssets, which only transitions FROM AVAILABLE).
    await ctx.db.patch(asset._id, { status: targetAssetStatus(a.incidentType), updatedAt: a.now });

    await writeActivityLog(ctx, {
      id: a.auditId,
      organizationId: a.orgId,
      action: "REPORT_ISSUE",
      entityType: "asset",
      entityId: asset.id,
      entityName: asset.assetTag,
      userId: actor.userId,
      userName: actor.userName,
      summary: `Reported issue: ${title}`,
      ...(a.projectId ? { projectId: a.projectId } : {}),
      assetId: asset.id,
      createdAt: a.now,
    });

    return { id: a.recordId };
  },
});

/**
 * Phase 4 danger classification (docs/designs/api-mcp-reimplementation.md §9).
 * Creates a maintenance record and flips the reported asset's status
 * (AVAILABLE/CHECKED_OUT -> IN_MAINTENANCE/LOST) — an ordinary, recoverable
 * report-an-issue create, not a warehouse movement or irreversible action.
 */
export const agentOps: AgentOpsAnnotations = {
  reportIssueNative: { danger: "medium" },
};
