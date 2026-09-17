/**
 * Confirm-time gate (spec decision, WS3 #942, non-blocking) — "if I confirm
 * THIS project right now, how many models would go hard-overbooked, and how
 * much crew is still unconfirmed?" Split out of `overbookingBoard.ts` (which
 * builds the org-wide board) purely to keep that file under the line-count
 * lint budget — this reuses its exported aggregation core directly.
 */
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { EXCLUDED_ASSIGNMENT_STATUSES } from "./crewConflicts";
import {
  candidateBoardProjects,
  computeGearShortageBoard,
  type DateRange,
  type BoardProject,
  type BoardLineItem,
  type BoardModel,
  type BoardAsset,
  type BoardBulkAsset,
  type BoardAssignment,
} from "./overbookingBoard";
import { fetchCandidateProjects, fetchGearData } from "../overbookingBoard";
import { ownGearModelIds } from "./projectReadiness";

export interface ConfirmImpactModels {
  modelCount: number;
  qty: number;
}

/**
 * "If `projectId` were CONFIRMED right now, would any model it books go hard-
 * overbooked?" — reuses `computeGearShortageBoard` unchanged: the caller
 * passes `projects` with `projectId`'s own status ALREADY simulated as
 * `"CONFIRMED"` (so its non-optional lines count as hard demand for this
 * calculation only — nothing is actually written), and `window` is that
 * project's own resolved window. Only models the project's own (non-optional,
 * non-cancelled, non-sub-hire) lines reference count toward the result — a
 * hard shortage on some unrelated model this project doesn't touch isn't this
 * project's problem to warn about.
 */
export function computeConfirmImpactModels(
  projectId: string,
  window: DateRange,
  projects: BoardProject[],
  lineItems: BoardLineItem[],
  models: BoardModel[],
  assets: BoardAsset[],
  bulkAssets: BoardBulkAsset[],
): ConfirmImpactModels {
  const ownModelIds = ownGearModelIds(projectId, lineItems);
  if (ownModelIds.size === 0) return { modelCount: 0, qty: 0 };

  const { hard } = computeGearShortageBoard(window, projects, lineItems, models, assets, bulkAssets);
  const relevant = hard.filter((r) => ownModelIds.has(r.modelId));
  return { modelCount: relevant.length, qty: relevant.reduce((sum, r) => sum + r.qty, 0) };
}

/** Count of a project's OWN crew assignments that aren't CONFIRMED yet (and
 *  aren't already settled-no via DECLINED/CANCELLED). */
export function countUnconfirmedCrewForProject(assignments: BoardAssignment[]): number {
  return assignments.filter((a) => {
    const status = a.status ?? "PENDING";
    return status !== "CONFIRMED" && !EXCLUDED_ASSIGNMENT_STATUSES.has(status);
  }).length;
}

export interface PromoteOverbookingRow {
  modelId: string;
  modelName: string;
  qty: number;
  projectNumbers: string[];
}

/**
 * "Given `projectId`'s date-restored window and its REAL current status (no
 * CONFIRMED simulation — unlike `computeConfirmImpactModels`), did the move
 * create a hard shortage on any model this project actually books?" — the
 * #1089 (Phase 2 promote) rule that rolling the rental window back "can create
 * or clear overbookings on other jobs" (design §5.2) surfaces in the
 * post-promote conflict list, using this same aggregation core rather than a
 * new check.
 */
export function computePromoteOverbookingConflicts(
  projectId: string,
  window: DateRange,
  projects: BoardProject[],
  lineItems: BoardLineItem[],
  models: BoardModel[],
  assets: BoardAsset[],
  bulkAssets: BoardBulkAsset[],
): PromoteOverbookingRow[] {
  const ownModelIds = ownGearModelIds(projectId, lineItems);
  if (ownModelIds.size === 0) return [];

  const { hard } = computeGearShortageBoard(window, projects, lineItems, models, assets, bulkAssets);
  return hard
    .filter((r) => ownModelIds.has(r.modelId))
    .map((r) => ({ modelId: r.modelId, modelName: r.modelName, qty: r.qty, projectNumbers: r.projects.map((p) => p.projectNumber) }));
}

/**
 * The fetch-and-compute core behind BOTH `makeLiveCore.ts`'s post-promote
 * `deriveDateMoveConflicts` and `overbookingBoard.dateMoveImpact` (#1227,
 * Q3's pre-save preview) — factored out so the two can never disagree about
 * what a date move did to other jobs' gear (R-3.1). `projectWithWindow` must
 * be the target project's own doc with its date fields already reflecting
 * the window being checked (the post-promote caller passes the just-patched
 * row; the pre-save preview passes a copy with the PROPOSED dates spliced
 * in) — everything else about it (status included) stays real, so a
 * dateless-to-dated move on an already-CONFIRMED job is checked exactly as
 * it will actually land.
 */
export async function computeDateMoveOverbookingRows(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  projectId: string,
  window: DateRange,
  projectWithWindow: Doc<"projects">,
): Promise<PromoteOverbookingRow[]> {
  const projectDocsById = await fetchCandidateProjects(ctx, organizationId, window.end);
  projectDocsById.set(projectWithWindow.id, projectWithWindow);
  const candidateProjects = candidateBoardProjects([...projectDocsById.values()], window);
  const candidateProjectIds = candidateProjects.map((p) => p.id);
  const { lineItems, models, assets, bulkAssetsForModels } = await fetchGearData(ctx, organizationId, candidateProjectIds, projectDocsById);
  return computePromoteOverbookingConflicts(projectId, window, candidateProjects, lineItems, models, assets, bulkAssetsForModels);
}
