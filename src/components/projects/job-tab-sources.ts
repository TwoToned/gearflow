"use client";

import type * as React from "react";

import { useProjectTaskList } from "@/hooks/use-project-task-list";
import { useProjectVersion } from "@/components/projects/project-version-context";
import { usePackingTab } from "@/hooks/use-packing-tab";
import { useTaskDueClock } from "@/hooks/use-task-due-clock";
import { isTaskOverdue } from "../../../convex/lib/taskDue";
import { packingCounts } from "@/lib/packing-tab";
import { PackingTabPrimary } from "@/components/projects/packing/packing-tab-primary";
import { VersionsTabPrimary } from "@/components/projects/versions/versions-tab-primary";
import type { JobTabCounts, JobTabKey } from "@/lib/job-tabs";

/**
 * Where each job tab's label count and tab-row primary come from (UX Phase 7).
 * The tab OWNER feeds these, not the page, so Phase 8 (Packing + Versions)
 * fills its slots by editing this file alone.
 *
 * Phase 8 filled both slots:
 * - `usePackingTabCount` returns `Packing n/m` (planned / total) from
 *   `packingCounts()`; its one caller is `useJobTabCounts` below.
 * - `Versions n` is `versions.length` from the version context.
 * - `JOB_TAB_PRIMARY` maps a tab to its one primary (`+ Add case`, `Save as new
 *   version`), rendered at the right of the tab row on desktop. Agreed rule
 *   (Q7): outline style on desktop; the red sticky bar is phone-only (each tab
 *   body renders its own). One red primary per screen, and the header's
 *   `Advance to …` is it.
 */

export interface JobTabPrimaryProps {
  projectId: string;
  orgId: string | undefined;
}

/** `+ Add case` (Packing) and `Save as new version` (Versions), outline on desktop (Q7). */
export const JOB_TAB_PRIMARY: Partial<Record<JobTabKey, React.ComponentType<JobTabPrimaryProps>>> = {
  packing: PackingTabPrimary,
  versions: VersionsTabPrimary,
};

/**
 * `Packing n/m` from `packingCounts()` (the ONE derivation, shared with the
 * tab's own footer) over the VIEWED version's plannable lines. It reads the same
 * Equipment-tree subscription the Packing tab does, so the count and the tab
 * cannot disagree. While loading it shows the bare word.
 */
function usePackingTabCount(projectId: string): JobTabCounts["packing"] {
  const { orgId, viewingVersion } = useProjectVersion();
  const { lines, isLoading } = usePackingTab(projectId, orgId, viewingVersion?.id);
  return isLoading || lines.length === 0 ? undefined : packingCounts(lines);
}

/** Every count the strip shows. Must render inside `ProjectVersionProvider`. */
export function useJobTabCounts(projectId: string): JobTabCounts {
  const { tasks } = useProjectTaskList(projectId);
  const { timezone, now, ready } = useTaskDueClock();
  const { versions } = useProjectVersion();
  const packing = usePackingTabCount(projectId);
  return {
    tasks: {
      done: tasks.filter((t) => t.status === "DONE").length,
      total: tasks.filter((t) => t.status !== "CANCELLED").length,
      // Unknown (absent) until the org's timezone has loaded: never a count read in the wrong zone.
      overdue: ready
        ? tasks.filter((t) => isTaskOverdue({ status: t.status, dueDate: t.dueDate ? new Date(t.dueDate).getTime() : null }, now, timezone)).length
        : undefined,
    },
    packing,
    versions: versions.length,
  };
}
