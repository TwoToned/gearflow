/**
 * Confirm-time gate (spec decision, WS3 #942, non-blocking) — "if I confirm
 * THIS project right now, how many models would go hard-overbooked, and how
 * much crew is still unconfirmed?" Split out of `overbookingBoard.ts` (which
 * builds the org-wide board) purely to keep that file under the line-count
 * lint budget — this reuses its exported aggregation core directly.
 */
import { EXCLUDED_ASSIGNMENT_STATUSES } from "./crewConflicts";
import {
  computeGearShortageBoard,
  type DateRange,
  type BoardProject,
  type BoardLineItem,
  type BoardModel,
  type BoardAsset,
  type BoardBulkAsset,
  type BoardAssignment,
} from "./overbookingBoard";

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
  const ownModelIds = new Set(
    lineItems
      .filter((li) => li.projectId === projectId && li.modelId && (li.status ?? "") !== "CANCELLED" && li.subHireId == null && li.isOptional !== true)
      .map((li) => li.modelId!),
  );
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
