/**
 * The four "Get started" activation milestones (D1, #1105) — shared shape +
 * pure derivation helpers. This is the SINGLE place that knows the milestone
 * order and "which one is next" (R-3.1): `ActivationChecklist`
 * (src/components/dashboard/activation-checklist.tsx) and the D2 (#1106)
 * helper-rail coaching both import from here rather than each re-deriving
 * "the active milestone" their own way.
 */

export type MilestoneKey = "model" | "asset" | "project" | "lineItem";

export const MILESTONE_ORDER: readonly MilestoneKey[] = ["model", "asset", "project", "lineItem"];

/** Mirrors the shape `convex/activationMilestones.ts`'s `state` query returns. */
export interface ActivationMilestonesState {
  firstModelId: string | null;
  firstModelName: string | null;
  hasModel: boolean;
  hasAssetOnFirstModel: boolean;
  firstProjectId: string | null;
  firstProjectName: string | null;
  hasProject: boolean;
  hasModelLineItemOnFirstProject: boolean;
}

export function milestoneDone(state: ActivationMilestonesState, key: MilestoneKey): boolean {
  switch (key) {
    case "model":
      return state.hasModel;
    case "asset":
      return state.hasAssetOnFirstModel;
    case "project":
      return state.hasProject;
    case "lineItem":
      return state.hasModelLineItemOnFirstProject;
  }
}

/** The next not-yet-done milestone, in order — `null` once all four are done. */
export function activeMilestoneKey(state: ActivationMilestonesState): MilestoneKey | null {
  return MILESTONE_ORDER.find((key) => !milestoneDone(state, key)) ?? null;
}
