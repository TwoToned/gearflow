import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { writeActivityLog } from "./audit";
import { requireLiveVersionId } from "./versionScope";
import { carryRealityByLineage } from "./versionReality";
import { pickPlanFields } from "./versionPlanFields";
import { recalcProjectTotals } from "./recalc";
import { resolveOrgDefaultTaxRate } from "./orgSettings";
import { candidateBoardProjects } from "./overbookingBoard";
import { computePromoteOverbookingConflicts } from "./overbookingConfirmImpact";
import { fetchCandidateProjects, fetchGearData } from "../overbookingBoard";
import { getProjectWindow } from "./projectWindow";
import { requireProjectInOrg } from "./quoteState";

/**
 * #1233 (Phase 6, "Project versioning v2") — the pointer-flip core of
 * `versions.makeLiveNative`, extracted so `quotesWrites.markAcceptedNative`
 * can compose "accept a non-live version's quote" = "accept + make that
 * version live" (D20) WITHOUT a second implementation of the flip (R-3.1).
 * Both callers already did their own permission/guard/actor resolution
 * before reaching this — this function is everything AFTER that: load the
 * incoming version, flip the pointer, carry reality, recalc, log.
 *
 * `versions.ts` still owns the mutation's own docstring/ASCII diagram (the
 * 6-step flow this function implements 1:1, steps 2-6 — step 1, the
 * permission check, stays with each caller since the two callers gate on
 * DIFFERENT things: `versions.makeLiveNative` on `project:update` alone,
 * `markAcceptedNative` on `invoice:publish` — accept's own audience).
 */
export async function loadVersionInOrgProject(
  ctx: MutationCtx,
  versionId: string,
  organizationId: string,
  projectId: string,
  fnName: string,
): Promise<Doc<"projectVersions">> {
  const version = await ctx.db.query("projectVersions").withIndex("by_cuid", (q) => q.eq("id", versionId)).first();
  if (!version || version.organizationId !== organizationId || version.projectId !== projectId) {
    throw new ConvexError(`${fnName}: version not found or cross-org/project: ${versionId}`);
  }
  return version;
}

/** Re-derive availability for `projectId`'s own gear when the rental window
 *  moved as part of a make-live (design §5.2) — ported unchanged from the
 *  original `versions.ts` `deriveDateMoveConflicts` (R-3.1: the "did the
 *  window move, and did that create a shortage" logic doesn't change just
 *  because a second caller can now trigger it). A no-op when the make-live
 *  didn't move either date. */
async function deriveDateMoveConflicts(
  ctx: MutationCtx,
  organizationId: string,
  projectId: string,
  before: Pick<Doc<"projects">, "rentalStartDate" | "rentalEndDate" | "projectStartDate" | "projectEndDate">,
  after: Doc<"projects">,
): Promise<string[]> {
  const beforeWindow = getProjectWindow(before);
  const afterWindow = getProjectWindow(after);
  const windowMoved = afterWindow.start !== beforeWindow.start || afterWindow.end !== beforeWindow.end;
  if (!windowMoved || afterWindow.start == null || afterWindow.end == null) return [];

  const window = { start: afterWindow.start, end: afterWindow.end };
  const projectDocsById = await fetchCandidateProjects(ctx, organizationId, window.end);
  projectDocsById.set(after.id, after);
  const candidateProjects = candidateBoardProjects([...projectDocsById.values()], window);
  const candidateProjectIds = candidateProjects.map((p) => p.id);
  const { lineItems, models, assets, bulkAssetsForModels } = await fetchGearData(ctx, organizationId, candidateProjectIds, projectDocsById);
  const overbookingRows = computePromoteOverbookingConflicts(
    projectId, window, candidateProjects, lineItems, models, assets, bulkAssetsForModels,
  );
  return overbookingRows.map(
    (row) => `Moving the rental window created a shortage of ${row.qty} × ${row.modelName} (also booked on ${row.projectNumbers.join(", ")}).`,
  );
}

export interface MakeLiveResult {
  liveVersionId: string;
  previousLiveVersionId: string;
  conflicts: string[];
  unplannedLineItemIds: string[];
  incomingNumber: number;
  outgoingNumber: number;
}

/**
 * Steps 2-6 of the make-live diagram (`versions.ts`'s own comment block).
 * `project` must be the CALLER's already-loaded, org-checked project doc.
 * Refuses (`VERSION_NOT_READY`/`VERSION_ALREADY_LIVE`) the same way the
 * standalone mutation does. Writes its OWN `PROJECT_VERSION_MADE_LIVE`
 * activity log entry (`auditId`/`actor` supplied by the caller — a fresh id
 * when this is called as a side effect of a DIFFERENT mutation, e.g.
 * `markAcceptedNative`, so it never collides with that mutation's own
 * primary audit entry) — callers do not need to log this themselves.
 */
export async function performMakeLive(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    projectId: string;
    project: Doc<"projects">;
    versionId: string;
    actor: { userId: string; userName: string };
    auditId: string;
    now: number;
    /** Prefixes the activity summary, e.g. "Accepted v3, making it live" vs
     *  the standalone mutation's own "Made v3 live". Defaults to the
     *  standalone phrasing. */
    summaryPrefix?: string;
  },
): Promise<MakeLiveResult> {
  const { organizationId, projectId, project, versionId, actor, auditId, now } = args;

  const incoming = await loadVersionInOrgProject(ctx, versionId, organizationId, projectId, "performMakeLive");
  if (incoming.contentState !== "ready") {
    throw new ConvexError({
      code: "VERSION_NOT_READY",
      message: `Version ${incoming.number} has no captured content — it can't be made live.`,
    });
  }

  const outgoingId = requireLiveVersionId(project);
  if (outgoingId === versionId) {
    throw new ConvexError({ code: "VERSION_ALREADY_LIVE", message: `Version ${incoming.number} is already live.` });
  }
  const outgoing = await loadVersionInOrgProject(ctx, outgoingId, organizationId, projectId, "performMakeLive");

  const { conflicts, unplannedLineItemIds } = await carryRealityByLineage(ctx, {
    organizationId, projectId, outgoingVersionId: outgoingId, incomingVersionId: versionId, now,
  });

  // Outgoing version's plan moves onto ITS OWN row (it was living on
  // `projects` by virtue of being live); `projects` picks up the incoming
  // version's plan, and the pointer flips.
  await ctx.db.patch(outgoing._id, pickPlanFields(project));
  await ctx.db.patch(project._id, { ...pickPlanFields(incoming), liveVersionId: versionId, updatedAt: now });

  const taxRate = await resolveOrgDefaultTaxRate(ctx, organizationId);
  await recalcProjectTotals(ctx, projectId, organizationId, taxRate, now);
  const afterProject = await requireProjectInOrg(ctx, projectId, organizationId);
  conflicts.push(...(await deriveDateMoveConflicts(ctx, organizationId, projectId, project, afterProject)));

  const prefix = args.summaryPrefix ?? "Made";
  await writeActivityLog(ctx, {
    id: auditId,
    organizationId,
    action: "PROJECT_VERSION_MADE_LIVE",
    entityType: "project",
    entityId: projectId,
    entityName: project.projectNumber,
    userId: actor.userId,
    userName: actor.userName,
    summary:
      `${prefix} v${incoming.number} live (was v${outgoing.number})` +
      (conflicts.length > 0 ? ` — ${conflicts.length} item(s) need manual review` : ""),
    details: { fromVersionId: outgoingId, fromNumber: outgoing.number, toVersionId: versionId, toNumber: incoming.number, conflicts, unplannedLineItemIds },
    projectId,
    createdAt: now,
  });

  return {
    liveVersionId: versionId,
    previousLiveVersionId: outgoingId,
    conflicts,
    unplannedLineItemIds,
    incomingNumber: incoming.number,
    outgoingNumber: outgoing.number,
  };
}
