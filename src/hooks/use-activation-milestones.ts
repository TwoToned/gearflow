"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";

/**
 * The four "Get started" activation milestones (D1, #1105) — reactive,
 * derived live from org state by `convex/activationMilestones.ts`. Pass
 * `orgId: undefined` to skip (e.g. before org context loads).
 */
export type ActivationMilestonesState = {
  firstModelId: string | null;
  firstModelName: string | null;
  hasModel: boolean;
  hasAssetOnFirstModel: boolean;
  firstProjectId: string | null;
  firstProjectName: string | null;
  hasProject: boolean;
  hasModelLineItemOnFirstProject: boolean;
};

export function useActivationMilestones(orgId: string | undefined): ActivationMilestonesState | undefined {
  return useAuthedQuery(api.activationMilestones.state, orgId ? { orgId } : "skip");
}
