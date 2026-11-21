"use client";

import { useActivationMilestones } from "@/hooks/use-activation-milestones";
import { useActivationDismissal } from "@/hooks/use-activation-dismissal";
import { MILESTONE_ORDER, milestoneDone, type ActivationMilestonesState, type MilestoneKey } from "@/lib/activation-milestones";
import type { SetupPanelHalf, SetupPanelItem } from "@/components/dashboard/setup-panel-types";

const LABELS: Record<MilestoneKey, { label: string; where: string }> = {
  model: { label: "Add a piece of gear you own", where: "Models" },
  asset: { label: "Add a real unit of it", where: "Assets" },
  project: { label: "Create your first job", where: "New job" },
  lineItem: { label: "Put that gear on the job", where: "Equipment" },
};

function hrefFor(key: MilestoneKey, state: ActivationMilestonesState): string {
  switch (key) {
    case "model":
      return "/assets/models/new";
    case "asset":
      return state.firstModelId ? `/assets/registry/new?modelId=${state.firstModelId}` : "/assets/models/new";
    case "project":
      return "/projects/new";
    case "lineItem":
      return state.firstProjectId ? `/projects/${state.firstProjectId}?tab=equipment` : "/projects/new";
  }
}

function metaFor(key: MilestoneKey, state: ActivationMilestonesState): string | undefined {
  if (key === "model") return state.firstModelName ?? undefined;
  if (key === "project") return state.firstProjectName ?? undefined;
  return undefined;
}

/** Every milestone is computed live from the org's models, assets, jobs and line
 *  items: nothing tracks "step N done" (D1, #1105). `milestoneDone` and
 *  `MILESTONE_ORDER` are shared with the D2 (#1106) helper-rail coaching, so
 *  "which milestone, in what order" has one definition. */
function buildItems(state: ActivationMilestonesState): SetupPanelItem[] {
  return MILESTONE_ORDER.map((key) => {
    const done = milestoneDone(state, key);
    return { key, ...LABELS[key], href: hrefFor(key, state), done, meta: done ? metaFor(key, state) : undefined };
  });
}

/**
 * The "Get started" half of Home's setup panel (D1, #1105; merged with "Finish
 * setup" into ONE panel in UX Phase 11, §6c.2). The only stored bit is the
 * per-(org, user) dismissal (`useActivationDismissal`, its own Convex table).
 * `visible` = loaded, not dismissed, at least one milestone left.
 */
export function useActivationState(orgId: string | undefined): SetupPanelHalf & { doneCount: number } {
  const state = useActivationMilestones(orgId);
  const { dismissedAt, dismiss, undismiss } = useActivationDismissal();
  const items = state ? buildItems(state) : [];
  const loading = state === undefined || dismissedAt === undefined;
  const visible = !loading && dismissedAt == null && items.some((i) => !i.done);
  return { items, visible, dismiss, undismiss, doneCount: items.filter((i) => i.done).length };
}
