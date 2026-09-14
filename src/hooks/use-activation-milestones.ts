"use client";

import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import { activeMilestoneKey, type ActivationMilestonesState, type MilestoneKey } from "@/lib/activation-milestones";

export type { ActivationMilestonesState, MilestoneKey };

/**
 * The four "Get started" activation milestones (D1, #1105) — reactive,
 * derived live from org state by `convex/activationMilestones.ts`. Pass
 * `orgId: undefined` to skip (e.g. before org context loads).
 */
export function useActivationMilestones(orgId: string | undefined): ActivationMilestonesState | undefined {
  return useAuthedQuery(api.activationMilestones.state, orgId ? { orgId } : "skip");
}

/**
 * The next not-yet-done milestone (D2, #1106's helper-rail coaching reads
 * this to decide whether "its" form should show coaching copy right now).
 * `undefined` while loading, `null` once every milestone is done.
 */
export function useActiveMilestoneKey(orgId: string | undefined): MilestoneKey | null | undefined {
  const state = useActivationMilestones(orgId);
  return state === undefined ? undefined : activeMilestoneKey(state);
}
