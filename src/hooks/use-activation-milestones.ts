"use client";

import { useEffect, useRef } from "react";
import { useAuthedQuery } from "@/hooks/use-authed-query";
import { api } from "../../convex/_generated/api";
import {
  activeMilestoneKey,
  milestoneDone,
  MILESTONE_ORDER,
  type ActivationMilestonesState,
  type MilestoneKey,
} from "@/lib/activation-milestones";
import { capture, AnalyticsEvent, type ActivationMilestoneId } from "@/lib/analytics";

export type { ActivationMilestonesState, MilestoneKey };

/** D4 (#1108) — maps the app-internal camelCase key to the design doc's own
 *  snake_case analytics property value (see the identical note on
 *  `ActivationMilestoneId` in analytics.ts). */
const MILESTONE_EVENT_ID: Record<MilestoneKey, ActivationMilestoneId> = {
  model: "model",
  asset: "asset",
  project: "project",
  lineItem: "line_item",
};

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

/**
 * D4 (#1108) — fires `activation_milestone` the first time each of the four
 * milestones flips from not-done to done, for as long as this hook stays
 * mounted (Home's `SetupPanel` is the one call site — it calls this ahead of
 * its own early return, so a completion witnessed while the panel is mounted
 * still gets reported).
 *
 * Never fires for a milestone that was ALREADY done the first time this
 * hook observes state in a given mount — that would report a historical
 * completion as if it just happened, on every fresh page load. Only a
 * genuine false -> true transition witnessed during this session counts.
 */
export function useActivationMilestoneAnalytics(orgId: string | undefined): void {
  const state = useActivationMilestones(orgId);
  const prevRef = useRef<ActivationMilestonesState | undefined>(undefined);
  const reportedRef = useRef<Set<MilestoneKey>>(new Set());

  useEffect(() => {
    if (state === undefined) return;
    const prev = prevRef.current;
    if (prev) {
      for (const key of MILESTONE_ORDER) {
        if (!milestoneDone(prev, key) && milestoneDone(state, key) && !reportedRef.current.has(key)) {
          reportedRef.current.add(key);
          capture(AnalyticsEvent.ActivationMilestone, { milestone: MILESTONE_EVENT_ID[key] });
        }
      }
    }
    prevRef.current = state;
  }, [state]);
}
